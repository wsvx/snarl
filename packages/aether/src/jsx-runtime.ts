/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import * as snarl from "@july/snarl/jsx-runtime";

import { island } from "./server/island.ts";
import { getActiveIslandRegistry } from "./server/registry.ts";
import { type Computed, isReactive, type Signal } from "./reactivity/mod.ts";
import { For, type ForProps, Show, type ShowProps } from "./control-flow.ts";

//deno-lint-ignore ban-types
const wrappers = new WeakMap<Function, ReturnType<typeof island>>();

function maybeRenderIsland(tag: unknown, props: any): any {
	if (typeof tag !== "function") return null;

	const meta = getActiveIslandRegistry()?.getMeta(tag);
	if (!meta) return null;

	const wrapper = wrappers.getOrInsertComputed(tag, () => island(meta));
	return wrapper(props ?? {});
}

function unwrapReactive(value: unknown): unknown {
	if (isReactive(value)) return unwrapReactive((value as () => unknown)());

	if (Array.isArray(value)) return value.map(unwrapReactive);
	if (
		value != null && typeof value === "object" &&
		!snarl.isJsxElement(value) && (value as object).constructor === Object
	) {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(value as Record<string, unknown>)) {
			out[k] = unwrapReactive((value as Record<string, unknown>)[k]);
		}
		return out;
	}
	return value;
}

function handleBinding(
	target: string,
	value: unknown,
	out: Record<string, unknown>,
	groupState: { value: unknown; hasBind: boolean },
) {
	if (target === "group") {
		groupState.value = value;
		groupState.hasBind = true;
	} else if (target === "checked") {
		out.checked = Boolean(value);
	} else {
		out.value = value ?? "";
	}
}

function finaliseGroupBinding(
	groupState: { value: unknown; hasBind: boolean },
	out: Record<string, unknown>,
) {
	if (groupState.hasBind) {
		out.checked = String(groupState.value) === String(out.value ?? "");
	}
}

function finaliseClasses(classToggles: string[], out: Record<string, unknown>) {
	if (classToggles.length) {
		out.class = [out.class, ...classToggles].filter(Boolean).join(" ");
	}
}

function jsx<P extends JSX.Props = JSX.Props>(
	tag: JSX.Element["tag"],
	props: P | null = {} as P,
	key?: string | number,
): JSX.Element {
	props ??= {} as P;
	if (key !== undefined) props = { ...props, key };

	if (tag === "for") return For(props as any);
	if (tag === "show") return Show(props as any);

	const rendered = maybeRenderIsland(tag, props);
	if (rendered) return rendered;

	if (props == null) return snarl.jsx(tag, props);

	const out: Record<string, unknown> = {};
	const classToggles: string[] = [];
	const groupState = { value: undefined as unknown, hasBind: false };

	for (const prop of Object.keys(props)) {
		const value = unwrapReactive(props[prop]);
		if (prop.startsWith("bind:")) {
			handleBinding(prop.slice(5), value, out, groupState);
		} else if (prop.startsWith("class:")) {
			if (value) classToggles.push(prop.slice(6));
		} else {
			out[prop] = value;
		}
	}

	finaliseGroupBinding(groupState, out);
	finaliseClasses(classToggles, out);

	return snarl.jsx(tag, out, key);
}

export const Fragment = snarl.Fragment as snarl.JSX.Fragment;
export const voidTags = snarl.voidTags;
export const isJsxElement = snarl.isJsxElement;
export const jsxEscape = snarl.jsxEscape;
export const jsxAttr = snarl.jsxAttr;
export const jsxTemplate = snarl.jsxTemplate;
export const renderToString = snarl.renderToString;

type MaybeReactive<T> = T | Signal<T> | Computed<T>;

export type ReactiveExtensions<T> =
	& {
		[K in keyof T]: T[K] | ReactiveOverrides[K & keyof ReactiveOverrides];
	}
	& ReactiveOverrides;

export type ReactiveOverrides = {
	style?: MaybeReactive<string> | snarl.CSSProperties | MaybeReactive<snarl.CSSProperties>;
	class?: MaybeReactive<string>;
	href?: MaybeReactive<string>;

	disabled?: MaybeReactive<boolean>;
	value?: MaybeReactive<string>;
	checked?: MaybeReactive<boolean>;

	[key: `data-${string}`]: MaybeReactive<string | number | boolean | null | undefined>;
	[key: `aria-${string}`]: MaybeReactive<string | number | boolean | null | undefined>;

	// deno-lint-ignore ban-types
	[key: `on${string}`]: EventListener | ((e: any) => void) | string | Function;

	// deno-lint-ignore ban-types
	[key: `on:${string}`]: EventListener | ((e: any) => void) | string | Function;

	[key: `bind:${string}`]: Signal<any> | any;
	[key: `class:${string}`]: MaybeReactive<boolean>;
};

export declare namespace JSX {
	export type Element = snarl.JSX.Element;
	export type Node = snarl.JSX.Node;
	export type Props = snarl.JSX.Props;
	export type Fragment = snarl.JSX.Fragment;

	export type FC<P extends Props = Props> = snarl.JSX.FC<P>;

	/** defines valid JSX elements */
	export type ElementType =
		| keyof IntrinsicElements
		| FC<any>;

	export interface ElementChildrenAttribute {
		// deno-lint-ignore ban-types
		children: {};
	}

	export type IntrinsicAttributes = snarl.JSX.IntrinsicAttributes;

	export type IntrinsicElements =
		& {
			show: ShowProps<any>;
			for: ForProps<any>;
		}
		& ReactiveExtensions<snarl.JSX.IntrinsicElements>;
}

export { jsx, jsx as jsxDEV, jsx as jsxs };
