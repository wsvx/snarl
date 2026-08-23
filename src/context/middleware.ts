/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import type { Context } from "./core.ts";

/** a route handler function */
export interface Handler<C> {
	(ctx: Context<C>): Response | void | Promise<Response | void>;
}

/** a middleware function */
export interface Middleware {
	(
		ctx: Context,
		next: () => Promise<MutableResponse>,
	): MutableResponse | Response | Promise<MutableResponse | Response>;
}

/** an error handler function for top-level error catching */
export interface ErrorHandler {
	(error: Error, ctx: Context): Response | Promise<Response>;
}

export class MutableResponse {
	status: number;
	statusText?: string;
	body: BodyInit | null;

	#headers?: Headers;
	#textCache: string | null = null;
	#bytesCache: Uint8Array<ArrayBuffer> | null = null;

	constructor(body: BodyInit | null, opts?: ResponseInit) {
		this.body = body;
		this.status = opts?.status ?? 200;
		this.statusText = opts?.statusText;
		this.#headers = opts?.headers ? new Headers(opts.headers) : undefined;
	}

	static from(response: Response): MutableResponse {
		const wrapped = new MutableResponse(response.body, {
			status: response.status,
			statusText: response.statusText,
		});
		wrapped.#headers = response.headers;
		return wrapped;
	}

	toResponse(): Response {
		const body = isFreshBody(this.body)
			? this.body
			: (this.#bytesCache ?? this.#textCache ?? this.body);
		return new Response(body, {
			status: this.status,
			statusText: this.statusText,
			headers: this.#headers,
		});
	}

	get headers(): Headers {
		return this.#headers ??= new Headers();
	}

	async text(): Promise<string | null> {
		if (this.body == null) return null;
		if (this.#textCache !== null) return this.#textCache;

		if (typeof this.body === "string") {
			return this.#textCache = this.body;
		}
		if (this.#bytesCache !== null) {
			return this.#textCache = new TextDecoder().decode(this.#bytesCache);
		}

		if (this.body instanceof Uint8Array || this.body instanceof ArrayBuffer) {
			const bytes = this.body instanceof Uint8Array ? this.body : new Uint8Array(this.body);
			this.#bytesCache = bytes as Uint8Array<ArrayBuffer>;

			return this.#textCache = new TextDecoder().decode(this.body);
		}

		if (typeof this.body === "string") return this.body;
		const text = await new Response(this.body).text();

		return this.body = this.#textCache = text;
	}

	async bytes(): Promise<Uint8Array<ArrayBuffer> | null> {
		if (this.body == null) return null;
		if (this.#bytesCache !== null) return this.#bytesCache;

		if (this.body instanceof Uint8Array) {
			return this.#bytesCache = this.body as Uint8Array<ArrayBuffer>;
		}
		if (this.#textCache !== null) {
			return this.#bytesCache = new TextEncoder().encode(this.#textCache);
		}
		if (typeof this.body === "string") {
			this.#textCache = this.body;
			return this.#bytesCache = new TextEncoder().encode(this.body);
		}

		const buffer = await new Response(this.body).arrayBuffer();
		return this.body = this.#bytesCache = new Uint8Array(buffer);
	}

	pipeThrough<T>(transform: TransformStream<Uint8Array, T>): this {
		if (this.body === null) return this;

		const stream = this.body instanceof ReadableStream ? this.body : new Response(this.body).body;

		if (stream) {
			this.body = stream.pipeThrough(transform);
			this.#headers?.delete("Content-Length");
		}
		return this;
	}
}

function isFreshBody(body: BodyInit | null): boolean {
	return body === null || typeof body === "string" || body instanceof ReadableStream ||
		body instanceof Uint8Array || body instanceof ArrayBuffer || body instanceof Blob ||
		body instanceof FormData || body instanceof URLSearchParams;
}

/**
 * composes an array of middleware functions with a final handler into a
 * single handler, where each middleware's `next()` invokes the next one
 * in sequence, and the last `next()` invokes `handler`
 */
export function compose(middlewares: Middleware[], handler: Handler<any>): Handler<any> {
	if (!middlewares.length) return handler;

	const chained = chain(...middlewares);

	return async (ctx) => {
		const result = await chained(ctx, async () => {
			const response = await handler(ctx) ?? new Response("", { status: 200 });
			return response instanceof MutableResponse ? response : MutableResponse.from(response);
		});
		return result instanceof MutableResponse ? result.toResponse() : result;
	};
}

/** chain multiple middleware into a single middleware */
export function chain(...middlewares: Middleware[]): Middleware {
	return (ctx, next) => {
		let i = 0;
		const dispatch = async (): Promise<MutableResponse> => {
			if (i < middlewares.length) {
				const mw = middlewares[i++];
				const result = await mw(ctx, dispatch);
				return result instanceof MutableResponse ? result : MutableResponse.from(result);
			}
			return next();
		};
		return dispatch();
	};
}
