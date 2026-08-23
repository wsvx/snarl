/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { chain, Context, Middleware, MiddlewarePriority, provideMiddleware } from "@july/snarl";
import { injectIntoHead } from "./injection.ts";

const CSS_ROUTE_RE = /^\/_css\/([a-zA-Z0-9_-]+)\.css$/;
const CONTEXT = Symbol.for("varnish.context");

/** hash -> compiled scoped CSS content, populated at module load time */
export const styleRegistry: Map<string, string> = new Map();

/**
 * marks a style hash as used for the given request, so `styleScopeInjection()`
 * will emit a `<link>` for it
 */
export function markStyleUsed(ctx: Context<any>, hash: string): void {
	const set = ctx.state.getOrInsertComputed(CONTEXT, () => new Set()) as Set<string>;
	set.add(hash);
}

/**
 * serves compiled scoped stylesheets at `/css/<hash>.css` with long-lived
 * immutable caching, since the hash is content-derived
 *
 * register this before your route handlers.
 */
export function scopedCss(): Middleware {
	return (ctx, next) => {
		const match = CSS_ROUTE_RE.exec(ctx.url.pathname);
		if (!match) return next();

		const hash = match[1];
		const content = styleRegistry.get(hash);

		if (!content) return next();

		return new Response(content, {
			headers: {
				"Content-Type": "text/css; charset=utf-8",
				"Cache-Control": "public, max-age=31536000, immutable",
			},
		});
	};
}

/**
 * injects `<link rel="stylesheet">` tags for every scoped style marked
 * as used during this request (via `markStyleUsed`).
 *
 * register this after `scopedStyling()` and before your route handlers.
 */
export function styleScopeInjection(): Middleware {
	return async (ctx, next) => {
		const response = await next();

		const contentType = response.headers.get("Content-Type") ?? "";
		if (!response.body || !contentType.includes("text/html")) return response;

		const used = ctx.state.get(CONTEXT) as Set<string> | undefined;
		if (!used || used.size === 0) return response;

		let links = "";
		for (const hash of used) {
			links += `<link rel="stylesheet" href="/_css/${hash}.css">\n`;
		}
		return injectIntoHead(ctx, links), response;
	};
}

/**
 * convenience bundle of `scopedCss()` + `styleScopeInjection()`
 *
 * @example
 * ```js
 * app.use(scopedStyling());
 * // equivalent to:
 * app.use(scopedCss(), styleScopeInjection());
 * ```
 */
export function scopedStyling(): Middleware {
	return chain(scopedCss(), styleScopeInjection());
}

provideMiddleware({
	name: "scoped-css",
	priority: MiddlewarePriority.normal,
	factory: () => scopedStyling(),
});
