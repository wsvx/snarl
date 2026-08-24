/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { dirname, resolve } from "@std/path";

interface ImportMap {
	baseDir: string;
	imports: Record<string, string>;
}

let cached: ImportMap | null | undefined;

async function findConfigFile(
	startDir: string,
	maxDepth = 10,
): Promise<string | null> {
	let dir = startDir;
	let depth = 0;
	const configNames = ["deno.json", "deno.jsonc"];

	while (depth < maxDepth) {
		const checks = configNames.map(async (name) => {
			const path = resolve(dir, name);
			await Deno.stat(path);
			return path;
		});

		try {
			return await Promise.any(checks);
		} catch {
			const parent = dirname(dir);
			if (parent === dir) return null;
			dir = parent, depth++;
		}
	}

	return null;
}

/** loads and caches the nearest deno.json's "imports" map, walking up from cwd */
export async function loadImportMap(): Promise<ImportMap | null> {
	if (cached !== undefined) return cached;

	const path = await findConfigFile(Deno.cwd());
	if (!path) return cached = null;

	try {
		const config = JSON.parse(await Deno.readTextFile(path));
		if (!config.imports || typeof config.imports !== "object") return cached = null;
		return cached = { baseDir: dirname(path), imports: config.imports };
	} catch {
		return cached = null;
	}
}

export function resolveThroughImportMap(map: ImportMap, specifier: string): string | null {
	if (specifier in map.imports) return applyMapping(map, map.imports[specifier], "");

	let bestPrefix: string | null = null;
	for (const key of Object.keys(map.imports)) {
		if (!key.endsWith("/")) continue;
		if (specifier.startsWith(key) && (bestPrefix === null || key.length > bestPrefix.length)) {
			bestPrefix = key;
		}
	}
	if (bestPrefix === null) return null;
	return applyMapping(map, map.imports[bestPrefix], specifier.slice(bestPrefix.length));
}

function applyMapping(map: ImportMap, target: string, remainder: string): string | null {
	if (/^(jsr|npm|https?):/.test(target)) return null;
	return resolve(map.baseDir, target, remainder);
}
