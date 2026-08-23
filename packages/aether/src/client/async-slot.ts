/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { isPromiseLike } from "../promise.ts";

export type MaybeAsync<T> = T | Promise<T>;

export interface AsyncSlotOptions {
	/** shown synchronously while the promise is pending */
	fallback?: Node | string;

	/**
	 * called if the promise rejects. return replacement content to show
	 * it in place of the failure, or return/leave `undefined` to let the
	 * rejection propagate as a genuine uncaught rejection.
	 */
	onError?: (err: unknown) => Node | string | void;

	signal?: AbortSignal;
}

/**
 * @example
 * ```ts
 * const slot = renderAsyncSlot(fetchUserCard(userId), {
 *   fallback: document.createTextNode("Loading..."),
 *   onError: (err) => document.createTextNode(`Failed to load: ${err}`),
 * });
 * container.appendChild(slot);
 * ```
 */
export function renderAsyncSlot(
	result: MaybeAsync<Node | Node[] | null>,
	options: AsyncSlotOptions = {},
): DocumentFragment {
	const startAnchor = document.createComment("async");
	const endAnchor = document.createComment("/async");

	const frag = document.createDocumentFragment();
	frag.append(startAnchor, endAnchor);

	const { signal, fallback, onError } = options;
	if (signal?.aborted) {
		return frag;
	}
	let isStale = false;

	function insertBetweenAnchors(nodes: (Node | string)[]) {
		if (isStale) return;

		const parent = endAnchor.parentNode ?? frag;

		let cursor = startAnchor.nextSibling;
		while (cursor && cursor !== endAnchor) {
			const next = cursor.nextSibling;
			parent.removeChild(cursor);
			cursor = next;
		}

		for (const node of nodes) {
			parent.insertBefore(
				typeof node === "string" ? document.createTextNode(node) : node,
				endAnchor,
			);
		}
	}

	function handleAbort() {
		isStale = true;
		insertBetweenAnchors([]);
	}
	if (signal) {
		signal.addEventListener("abort", handleAbort, { once: true });
	}

	if (!isPromiseLike(result)) {
		const nodes = result == null ? [] : Array.isArray(result) ? result : [result];
		insertBetweenAnchors(nodes);
		return frag;
	}

	if (fallback != null) {
		insertBetweenAnchors([fallback]);
	}

	result
		.then((resolved) => {
			if (isStale || signal?.aborted) return;
			const nodes = resolved == null ? [] : Array.isArray(resolved) ? resolved : [resolved];
			insertBetweenAnchors(nodes);
		})
		.catch((err) => {
			if (isStale || signal?.aborted) return;
			const recovered = onError?.(err);

			if (recovered !== undefined) {
				insertBetweenAnchors([recovered]);
			} else {
				if (typeof globalThis.reportError === "function") {
					globalThis.reportError(err);
				} else {
					queueMicrotask(() => {
						throw err;
					});
				}
			}
		}).finally(() => {
			if (signal && !isStale) {
				signal.removeEventListener("abort", handleAbort);
			}
		});

	return frag;
}
