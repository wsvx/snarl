/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { type Context, type Middleware, MutableResponse, provideMiddleware } from "@july/snarl";
import {
	type AetherServeOptions,
	bundleIslands,
	decodeEntryKey,
	encodeEntryKey,
} from "./bundler.ts";
import { discoverAndRegisterIslands } from "./discover.ts";
import { getUsedIslands } from "./registry.ts";
import { log } from "@july/snarl/verbosity";
import { boring } from "@404/aether";

const BUNDLE_CACHE = new Map<string, string>();
const HASH_BY_NAMESET = new Map<string, string>();
const PENDING_BUNDLES = new Map<string, Promise<{ code: string; hash: string }>>();

export interface AetherOptions extends AetherServeOptions {
	/** directories or files to analyse for interactive components */
	entrypoints?: string[];
}

function resolveBundle(
	names: readonly string[],
	options: AetherOptions,
	cache: Map<string, string>,
): Promise<{ code: string; hash: string }> {
	const nameSetKey = names.join(",");

	const knownHash = HASH_BY_NAMESET.get(nameSetKey);
	if (knownHash) {
		const cached = cache.get(knownHash);
		if (cached !== undefined) return Promise.resolve({ code: cached, hash: knownHash });
	}

	return PENDING_BUNDLES.getOrInsertComputed(nameSetKey, async () => {
		try {
			const code = await bundleIslands(names, options);
			const hash = boring(code);

			cache.set(hash, code);
			HASH_BY_NAMESET.set(nameSetKey, hash);
			PENDING_BUNDLES.delete(nameSetKey);

			return { code, hash };
		} catch (err) {
			PENDING_BUNDLES.delete(nameSetKey);
			throw err;
		}
	});
}

async function injectIslandScript(
	response: MutableResponse,
	ctx: Context,
	options: AetherOptions,
	cache: Map<string, string>,
): Promise<MutableResponse> {
	const contentType = response.headers.get("Content-Type") ?? "";
	if (!contentType.includes("text/html")) return response;

	const used = getUsedIslands(ctx);
	if (!used || used.size === 0) return response;

	const names = [...new Set(used)].sort();

	let hash: string;
	try {
		({ hash } = await resolveBundle(names, options, cache));
	} catch (err) {
		log.error("aether", "failed to pre-bundle islands for script injection:", err);
		return response;
	}

	const src = `/_aether/entry/${encodeEntryKey(names)}.${hash}.js`;

	const html = await response.text();
	if (!html || html.includes(src)) return response;

	const script = `<script type="module" src="${src}"></script>`;

	let injected: string;
	if (html.includes("</body>")) {
		injected = html.replace("</body>", `${script}</body>`);
	} else if (html.includes("</html>")) {
		injected = html.replace("</html>", `${script}</html>`);
	} else {
		injected = html + script;
	}

	const headers = new Headers(response.headers);
	headers.delete("Content-Length");

	return new MutableResponse(injected, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";
const ENTRY_ROUTE_RE = /^\/_aether\/entry\/([A-Za-z0-9_-]+)\.([0-9a-z]+)\.js$/;

export function aether(options: AetherOptions = {}): Middleware {
	const cache = options.cache ?? BUNDLE_CACHE;

	if (options.entrypoints) {
		discoverAndRegisterIslands(options.entrypoints).catch(log.error);
	}

	return async (ctx, next) => {
		const match = ctx.url.pathname.match(ENTRY_ROUTE_RE);

		if (match) {
			const [, encodedNames, requestedHash] = match;

			const cached = cache.get(requestedHash);
			if (cached !== undefined) {
				return new Response(cached, {
					headers: {
						"Content-Type": "application/javascript; charset=utf-8",
						"Cache-Control": CACHE_CONTROL_IMMUTABLE,
					},
				});
			}

			let rebuilt: { code: string; hash: string };
			try {
				const names = decodeEntryKey(encodedNames);
				rebuilt = await resolveBundle(names, options, cache);
			} catch (err) {
				log.error("aether", `failed to bundle entry "${encodedNames}":`, err);
				return new Response("Failed to bundle island entry", { status: 500 });
			}

			if (rebuilt.hash !== requestedHash) {
				return new Response("stale island bundle; reload the page", {
					status: 409,
					headers: { "Cache-Control": "no-store" },
				});
			}

			return new Response(rebuilt.code, {
				headers: {
					"Content-Type": "application/javascript; charset=utf-8",
					"Cache-Control": CACHE_CONTROL_IMMUTABLE,
				},
			});
		}

		const response = await next();
		return injectIslandScript(response, ctx, options, cache);
	};
}

provideMiddleware({
	name: "aether",
	priority: 800,
	dependencies: ["context"],
	factory: () => aether({ entrypoints: ["./routes"] }),
	permissions: [
		{ descriptor: { name: "run", command: "esbuild" }, reason: "to bundle island components" },
		{
			descriptor: { name: "env", variable: "ESBUILD_BINARY_PATH" },
			reason: "to locate the esbuild binary",
		},
		{
			descriptor: { name: "read" } as Deno.PermissionDescriptor,
			reason: `to discover islands`,
		},
	],
});
