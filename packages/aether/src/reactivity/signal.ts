/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import type { ReactiveAccessor } from "./accessor.ts";
import { computed } from "./computed.ts";
import {
	flush,
	getActiveSub,
	getBatchDepth,
	getCycle,
	getRunDepth,
	link,
	propagate,
	shallowPropagate,
} from "./engine.ts";
import { tag } from "./tag.ts";
import { NodeKind, ReactiveFlags, type ReactiveNode } from "./types.ts";

export interface SignalNode<T = unknown> extends ReactiveNode {
	readonly kind: NodeKind.Signal;
	currentValue: T;
	pendingValue: T;
}

export interface Signal<T> extends ReactiveAccessor<T> {
	(value: T): void;
	(): T;

	set(value: T): void;

	/** Updates from the current value in one step. `count.update(n => n + 1)` instead of `count(count() + 1)` */
	update(fn: (current: T) => T): void;
}

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(initialValue: T): Signal<T>;
export function signal<T>(initialValue?: T): Signal<T | undefined> {
	const node: SignalNode<T | undefined> = {
		kind: NodeKind.Signal,
		currentValue: initialValue,
		pendingValue: initialValue,
		subs: undefined,
		subsTail: undefined,
		flags: ReactiveFlags.Mutable,
	};

	const accessor =
		((...args: [T | undefined]) =>
			args.length ? writeSignal(node, args[0]) : readSignal(node)) as Signal<
				T | undefined
			>;

	Object.defineProperty(accessor, "value", {
		enumerable: true,
		configurable: true,
		get: () => readSignal(node),
		set: (v: T | undefined) => writeSignal(node, v),
	});

	accessor.peek = () => {
		if (node.flags & ReactiveFlags.Dirty) {
			if (updateSignal(node)) {
				const subs = node.subs;
				if (subs !== undefined) shallowPropagate(subs);
			}
		}
		return node.currentValue;
	};

	accessor.update = (fn) => writeSignal(node, fn(node.currentValue));
	accessor.map = (fn) => computed(() => fn(readSignal(node)));
	accessor.is = (value) => computed(() => readSignal(node) === value);

	accessor.set = (v) => accessor(v);

	accessor[Symbol.toPrimitive] = (hint: string) => {
		const v = readSignal(node);
		return hint === "number" ? Number(v) : hint === "string" ? String(v) : v as string;
	};
	accessor.toString = () => String(readSignal(node));
	accessor.valueOf = () => readSignal(node) as unknown as number;

	return tag(accessor, NodeKind.Signal);
}

export function readSignal<T>(node: SignalNode<T>): T {
	if (node.flags & ReactiveFlags.Dirty) {
		if (updateSignal(node)) {
			const subs = node.subs;
			if (subs !== undefined) shallowPropagate(subs);
		}
	}
	const sub = getActiveSub();
	if (sub !== undefined) link(node, sub, getCycle());
	return node.currentValue;
}

export function writeSignal<T>(node: SignalNode<T>, value: T): void {
	if (node.pendingValue !== (node.pendingValue = value)) {
		node.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;
		const subs = node.subs;
		if (subs !== undefined) {
			propagate(subs, !!getRunDepth());
			if (!getBatchDepth()) flush();
		}
	}
}

export function updateSignal(node: SignalNode): boolean {
	node.flags = ReactiveFlags.Mutable;
	return node.currentValue !== (node.currentValue = node.pendingValue);
}
