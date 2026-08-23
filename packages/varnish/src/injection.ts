/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import type { Context, Middleware } from "@july/snarl";
import { HtmlInjector } from "./html.ts";

const INJECTIONS = Symbol("varnish.injections");

interface InjectionQueue {
	head: string[];
	body: string[];
}

function queueFor(ctx: Context): InjectionQueue {
	let queue = ctx.state.get(INJECTIONS) as InjectionQueue | undefined;
	if (!queue) ctx.state.set(INJECTIONS, queue = { head: [], body: [] });
	return queue;
}

/** queues `html` to be spliced in before `</head>` on this response */
export function injectIntoHead(ctx: Context, html: string): void {
	if (html) queueFor(ctx).head.push(html);
}

export function injectIntoBody(ctx: Context, html: string): void {
	if (html) queueFor(ctx).body.push(html);
}

function computePendingInjection(ctx: Context): { head?: string; body?: string } | undefined {
	const q = ctx.state.get(INJECTIONS) as InjectionQueue | undefined;
	if (!q || (q.head.length === 0 && q.body.length === 0)) return undefined;
	return {
		head: q.head.length ? q.head.join("") : undefined,
		body: q.body.length ? q.body.join("") : undefined,
	};
}

export function htmlInjection(): Middleware {
	return async (ctx, next) => {
		const response = await next();

		const src = computePendingInjection(ctx);
		if (!src) return response;

		const contentType = response.headers.get("Content-Type") ?? "";
		if (!contentType.includes("text/html")) return response;

		return response.pipeThrough(new HtmlInjector(src));
	};
}
