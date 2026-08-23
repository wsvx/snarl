/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { SEPARATOR, toFileUrl } from "@std/path";
import { dim } from "@std/fmt/colors";
import { applySpecialFile } from "./special-files.ts";
import { makeRoutePath } from "./paths.ts";
import type { RootRouteMetadata, ScanEntry } from "./types.ts";
import { walk } from "@std/fs";
import { log } from "@july/snarl/verbosity";

async function importRoute(base: string, file: string): Promise<ScanEntry | null> {
	const rel = file.slice(base.length + 1);
	const start = performance.now();

	try {
		const module = await import(toFileUrl(file).href);
		log.info("router", dim(`↓ imported ${rel} in ${(performance.now() - start).toFixed(2)}ms`));

		return {
			path: makeRoutePath(rel),
			fsPath: file,
			module,
			depth: rel.split(SEPARATOR).filter(Boolean).length - 1,
		};
	} catch (err) {
		log.error("router", `failed to import route ${dim(rel)}:`, err);
		return null;
	}
}

function isRouteFile(name: string): boolean {
	return name.endsWith(".ts") || name.endsWith(".tsx");
}

function isSpecialFile(name: string): boolean {
	return name.startsWith("_") && isRouteFile(name);
}

async function collectFiles(root: string): Promise<{ routes: string[]; special: string[] }> {
	const routes: string[] = [];
	const special: string[] = [];

	try {
		for await (
			const entry of walk(root, {
				includeDirs: false,
				followSymlinks: false,
				exts: [".ts", ".tsx"],
			})
		) {
			const name = entry.name;
			if (isSpecialFile(name)) {
				special.push(entry.path);
			} else if (isRouteFile(name)) {
				routes.push(entry.path);
			}
		}
	} catch (err) {
		if (err instanceof Deno.errors.NotFound) {
			log.warn("aether/discover", `Skipping directory, path does not exist: ${dim(root)}`);
		} else {
			throw err;
		}
	}

	return { routes, special };
}

export async function scanDir(
	base: string,
	root: string,
	entries: ScanEntry[],
	metas: Map<string, RootRouteMetadata>,
): Promise<void> {
	const meta: RootRouteMetadata = { middlewares: [] };
	metas.set(root, meta);

	const { routes, special } = await collectFiles(root);

	await Promise.all(special.map((file) => applySpecialFile(meta, file)));
	const importedRoutes = await Promise.all(
		routes.map((file) => importRoute(base, file)),
	);

	entries.push(...importedRoutes.filter(($): $ is ScanEntry => $ !== null));
}
