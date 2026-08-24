/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import type { ReactiveAccessor } from "./accessor.ts";
import {
	checkDirty,
	getActiveSub,
	getCycle,
	incrementCycle,
	link,
	pruneChildEffectDeps,
	purgeDeps,
	setActiveSub,
	shallowPropagate,
	untracked,
} from "./engine.ts";
import { tag } from "./tag.ts";
import { HasChildEffect, NodeKind, ReactiveFlags, type ReactiveNode } from "./types.ts";

export interface ComputedNode<T = unknown> extends ReactiveNode {
	readonly kind: NodeKind.Computed;
	value?: T;
	getter: (previousValue?: T) => T;
}

export interface Computed<T> extends ReactiveAccessor<T> {
	(): T;

	/**
	 * Reactive read. Computeds are derived, writing to `.value` throws, since it's a getter-only
	 * accessor property.
	 */
	readonly value: T;
}

export function computed<T>(getter: (previousValue?: T) => T): Computed<T> {
	const node: ComputedNode<T> = {
		kind: NodeKind.Computed,
		value: undefined,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: ReactiveFlags.None,
		getter,
	};

	const accessor = (() => readComputed(node)) as unknown as Computed<T>;

	Object.defineProperty(accessor, "value", {
		enumerable: true,
		configurable: true,
		get: () => readComputed(node),
	});

	accessor.peek = () => untracked(() => readComputed(node));
	accessor.map = (fn) => computed(() => fn(readComputed(node)));
	accessor.is = (value) => computed(() => readComputed(node) === value);

	accessor[Symbol.toPrimitive] = (hint: string) => {
		const v = readComputed(node);
		return hint === "number" ? Number(v) : hint === "string" ? String(v) : v as string;
	};
	(accessor as any).toString = () => String(readComputed(node));
	(accessor as any).valueOf = () => readComputed(node) as unknown as number;

	return tag(accessor, NodeKind.Computed);
}

export function readComputed<T>(node: ComputedNode<T>): T {
	const flags = node.flags;
	if (
		flags & ReactiveFlags.Dirty ||
		(flags & ReactiveFlags.Pending &&
			(checkDirty(node.deps!, node) || ((node.flags = flags & ~ReactiveFlags.Pending), false)))
	) {
		if (updateComputed(node)) {
			const subs = node.subs;
			if (subs !== undefined) shallowPropagate(subs);
		}
	} else if (!flags) {
		node.flags = ReactiveFlags.Mutable | ReactiveFlags.RecursedCheck;
		const prevSub = setActiveSub(node);
		try {
			node.value = node.getter();
		} finally {
			setActiveSub(prevSub);
			node.flags &= ~ReactiveFlags.RecursedCheck;
		}
	}
	const sub = getActiveSub();
	if (sub !== undefined) link(node, sub, getCycle());
	return node.value!;
}

export function updateComputed<T>(node: ComputedNode<T>): boolean {
	if (node.flags & HasChildEffect) pruneChildEffectDeps(node);
	node.depsTail = undefined;
	node.flags = ReactiveFlags.Mutable | ReactiveFlags.RecursedCheck;

	const prevSub = setActiveSub(node);
	try {
		incrementCycle();
		const oldValue = node.value;
		return oldValue !== (node.value = node.getter(oldValue));
	} finally {
		setActiveSub(prevSub);
		node.flags &= ~ReactiveFlags.RecursedCheck;
		purgeDeps(node);
	}
}
