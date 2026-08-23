/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { type Signal, signal } from "./signal.ts";
import { untracked } from "./engine.ts";
import { type Computed, computed } from "./computed.ts";

const RAW = Symbol("reactive.raw");

const ARRAY_MUTATORS = new Set([
	"push",
	"pop",
	"shift",
	"unshift",
	"splice",
	"sort",
	"reverse",
	"fill",
	"copyWithin",
]);

function isTrackable(v: unknown): v is Record<PropertyKey, unknown> {
	return typeof v === "object" && v !== null;
}

interface StoreState {
	/** one signal per accessed property/index, created lazily, reused forever */
	fields: Map<PropertyKey, Signal<unknown>>;
	/** cached child store proxies, keyed by key, invalidated when the value at that key changes */
	children: Map<PropertyKey, unknown>;
	/** fires when the key/index *set* changes shape: new/deleted object keys, or array length */
	shape: Signal<number>;
}

function fieldSignal(state: StoreState, key: PropertyKey, initial: unknown): Signal<unknown> {
	let s = state.fields.get(key);
	if (!s) state.fields.set(key, s = signal(initial));
	return s;
}

function wrapChild(state: StoreState, key: PropertyKey, value: unknown): unknown {
	if (!isTrackable(value)) return value;

	const cached = state.children.get(key);
	if (cached && (cached as any)[RAW] === value) return cached;

	const child = reactive(value);
	return state.children.set(key, child), child;
}

function reconcileArray(obj: unknown[], state: StoreState, before: unknown[]): void {
	const maxLen = Math.max(before.length, obj.length);
	for (let i = 0; i < maxLen; i++) {
		if (i in before || i in obj) {
			if (before[i] !== obj[i]) {
				fieldSignal(state, i, obj[i]).set(obj[i]);
				state.children.delete(i);
			}
		}
	}
	if (before.length !== obj.length) {
		fieldSignal(state, "length", obj.length).set(obj.length);
		state.shape.update((n) => n + 1);
	}
}

/**
 * turns any object or array into a deeply reactive store, with per-property
 * (or per-index) tracking.
 * ```
 */
export function reactive<T extends object>(
	target: T,
): T & { derive: <R>(fn: (prev: T) => R) => Computed<R> } {
	const state: StoreState = { fields: new Map(), children: new Map(), shape: signal(0) };
	const isArray = Array.isArray(target);

	const proxy = new Proxy(target, {
		get(obj, key, receiver) {
			if (key === RAW) return obj;

			if (isArray && typeof key === "string" && ARRAY_MUTATORS.has(key)) {
				return (...args: unknown[]) => {
					const before = untracked(() => (obj as unknown[]).slice());
					const result = (obj as unknown[] as any)[key](...args);
					reconcileArray(obj as unknown[], state, before);
					return result;
				};
			}

			const value = Reflect.get(obj, key, receiver);
			if (typeof value === "function") return value.bind(receiver);

			fieldSignal(state, key, value)();
			return wrapChild(state, key, value);
		},

		set(obj, key, value, receiver) {
			const had = Reflect.has(obj, key);
			const old = (obj as any)[key];
			const ok = Reflect.set(obj, key, value, receiver);
			if (!ok) return false;

			if (old !== value) {
				fieldSignal(state, key, value).set(value);
				state.children.delete(key);
			}

			if (isArray) {
				const len = (obj as unknown[]).length;
				const lengthSignal = state.fields.get("length");
				if (lengthSignal && untracked(() => lengthSignal()) !== len) {
					lengthSignal.set(len);
					state.shape.update((n) => n + 1);
				}
			}
			if (!had) state.shape.update((n) => n + 1);
			return true;
		},

		deleteProperty(obj, key) {
			const had = Reflect.has(obj, key);
			const ok = Reflect.deleteProperty(obj, key);
			if (ok && had) {
				state.fields.get(key)?.set(undefined);
				state.children.delete(key);
				state.shape.update((n) => n + 1);
			}
			return ok;
		},

		ownKeys(obj) {
			state.shape();
			return Reflect.ownKeys(obj);
		},
	}) as ReturnType<typeof reactive<T>>;

	proxy.derive = <R>(fn: (prev: T) => R) => computed(() => fn(proxy));
	return proxy;
}
