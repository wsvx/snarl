/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { effectScope } from "../reactivity/mod.ts";

export type IslandComponent<P = Record<string, unknown>> = (props: P) => Node | Node[] | null;

const islands = new Map<string, IslandComponent<any>>();
const scopes = new WeakMap<HTMLElement, () => void>();

export function registerIsland<P = Record<string, unknown>>(
	name: string,
	component: IslandComponent<P>,
): void {
	if (islands.has(name)) throw new Error(`aether: island "${name}" is already registered`);
	islands.set(name, component);
}

function parseProps(el: HTMLElement): Record<string, unknown> {
	const raw = el.dataset.xProps;
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		console.warn(
			`aether: island "${el.dataset.xId}" has malformed data-x-props, mounting with no props`,
		);
		return {};
	}
}

function mountOne(el: HTMLElement): void {
	const name = el.dataset.xId;
	if (!name) return;

	const component = islands.get(name);
	if (!component) {
		console.warn(
			`aether: no island registered for "${name}", leaving server-rendered markup as-is`,
		);
		return;
	}

	let result: Node | Node[] | null = null;
	let dispose: (() => void) | undefined;

	try {
		dispose = effectScope(() => {
			result = component(parseProps(el));
		});
	} catch (err) {
		console.error(
			`aether: island "${name}" threw during hydration and was skipped. ` +
				`Its server-rendered markup is left in place but will not be interactive. ` +
				`Other islands on this page are unaffected.`,
			err,
		);
		return;
	}

	scopes.set(el, dispose);
	el.replaceChildren(...(result == null ? [] : Array.isArray(result) ? result : [result]));
	el.removeAttribute("data-x-id");
}

/** hydrates every unhydrated `[data-x-id]` element under `root` with a registered island */
export function mount(root: ParentNode = document): void {
	for (const el of root.querySelectorAll<HTMLElement>("[data-x-id]")) mountOne(el);
}

/** disposes an island's reactive scope and clears its root. no-op if never mounted */
export function unmount(el: HTMLElement): void {
	scopes.get(el)?.();
	scopes.delete(el);
	el.replaceChildren();
}

/** `mount()` plus a `data-x` marker on `<html>`, so `[data-x-id]{visibility:hidden}` can hide islands until hydrated */
export function hydrate(root: ParentNode = document): void {
	mount(root);
	document.documentElement.setAttribute("data-x", "");
}

export * from "./control-flow.ts";
export { jsx } from "./jsx-runtime.ts";
export * from "../env.ts";
export * from "./css.ts";
