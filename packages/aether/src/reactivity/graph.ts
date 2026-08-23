/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

/**
 * @module reactivity/graph
 *
 * The push-pull dependency graph underlying signals, computeds, and effects.
 */

import type { AnyReactiveNode } from "./types.ts";
import { type Link, ReactiveFlags, type ReactiveNode } from "./types.ts";

export interface ReactiveOps {
	/** recomputes `sub`'s value (signal: adopt pending value; computed: re-run getter) and reports whether the value actually changed */
	readonly update: (sub: AnyReactiveNode) => boolean;
	/** called once, when a node transitions to `Watching` + dirty during a push; drives effect scheduling */
	readonly notify: (sub: AnyReactiveNode) => void;
	/** called when a dependency's subscriber list becomes empty */
	readonly unwatched: (dep: AnyReactiveNode) => void;
}

export function createReactiveSystem({ update, notify, unwatched }: ReactiveOps) {
	return Object.freeze({
		link,
		unlink,
		propagate,
		checkDirty,
		shallowPropagate,
	});

	/** records that `sub` read `dep` during its current evaluation */
	function link(dep: ReactiveNode, sub: ReactiveNode, version: number): void {
		const prevDep = sub.depsTail;
		if (prevDep !== undefined && prevDep.dep === dep) return;

		const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
		if (nextDep !== undefined && nextDep.dep === dep) {
			nextDep.version = version;
			sub.depsTail = nextDep;
			return;
		}

		const prevSub = dep.subsTail;
		if (prevSub !== undefined && prevSub.version === version && prevSub.sub === sub) return;

		const newLink = sub.depsTail =
			dep.subsTail =
				{
					version,
					dep,
					sub,
					prevDep,
					nextDep,
					prevSub,
					nextSub: undefined,
					prevStack: undefined,
				};

		if (nextDep !== undefined) nextDep.prevDep = newLink;
		if (prevDep !== undefined) prevDep.nextDep = newLink;
		else sub.deps = newLink;

		if (prevSub !== undefined) prevSub.nextSub = newLink;
		else dep.subs = newLink;
	}

	/** removes `link` from both lists it participates in (dep's
	 subscribers, sub's dependencies) and returns the next link in
	 * `sub`'s dependency chain */
	function unlink(link: Link, sub = link.sub): Link | undefined {
		const { dep, prevDep, nextDep, nextSub, prevSub } = link;

		if (nextDep !== undefined) nextDep.prevDep = prevDep;
		else sub.depsTail = prevDep;

		if (prevDep !== undefined) prevDep.nextDep = nextDep;
		else sub.deps = nextDep;

		if (nextSub !== undefined) nextSub.prevSub = prevSub;
		else dep.subsTail = prevSub;

		if (prevSub !== undefined) prevSub.nextSub = nextSub;
		else if ((dep.subs = nextSub) === undefined) unwatched(dep as AnyReactiveNode);

		return nextDep;
	}

	function propagate(startLink: Link, innerWrite: boolean): void {
		let currentLink: Link = startLink;
		let next = startLink.nextSub;
		let stack: Link | undefined;

		top: do {
			const sub = currentLink.sub;
			const flags = sub.flags;

			const masked = flags &
				(ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed | ReactiveFlags.Dirty |
					ReactiveFlags.Pending);

			let notifyAndTraverse = false;

			if (!masked) {
				sub.flags = flags | ReactiveFlags.Pending;
				if (innerWrite) sub.flags |= ReactiveFlags.Recursed;
				notifyAndTraverse = true;
			} else if (!(flags & (ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed))) {
				notifyAndTraverse = false;
			} else if (!(flags & ReactiveFlags.RecursedCheck)) {
				sub.flags = (flags & ~ReactiveFlags.Recursed) | ReactiveFlags.Pending;
				notifyAndTraverse = true;
			} else if (
				!(flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending)) && isValidLink(currentLink, sub)
			) {
				sub.flags = flags | ReactiveFlags.Recursed | ReactiveFlags.Pending;
				notifyAndTraverse = true;
			} else {
				notifyAndTraverse = false;
			}

			if (notifyAndTraverse) {
				if (sub.flags & ReactiveFlags.Watching) notify(sub as AnyReactiveNode);
				if (sub.flags & ReactiveFlags.Mutable) {
					const subSubs = sub.subs;
					if (subSubs !== undefined) {
						const nextSub = subSubs.nextSub;
						if (nextSub !== undefined) {
							currentLink.prevStack = stack;
							stack = currentLink;
							next = nextSub;
						}
						currentLink = subSubs;
						continue;
					}
				}
			}

			if (next !== undefined) {
				currentLink = next;
				next = currentLink.nextSub;
				continue;
			}
			while (stack !== undefined) {
				currentLink = stack;
				stack = currentLink.prevStack;
				currentLink.prevStack = undefined;
				if (currentLink !== undefined) {
					next = currentLink.nextSub;
					if (next !== undefined) {
						currentLink = next;
						next = currentLink.nextSub;
						continue top;
					}
				}
			}
			break;
		} while (true);
	}

	function shallowPropagate(startLink: Link) {
		let currentLink: Link | undefined = startLink;
		do {
			const sub = currentLink.sub;
			const flags = sub.flags;
			if ((flags & (ReactiveFlags.Pending | ReactiveFlags.Dirty)) === ReactiveFlags.Pending) {
				sub.flags = flags | ReactiveFlags.Dirty;
				if (
					(flags & (ReactiveFlags.Watching | ReactiveFlags.RecursedCheck)) ===
						ReactiveFlags.Watching
				) {
					notify(sub as AnyReactiveNode);
				}
			}
			currentLink = currentLink.nextSub;
		} while (currentLink !== undefined);
	}

	function checkDirty(startLink: Link, initialSub: ReactiveNode): boolean {
		let currentLink: Link = startLink;
		let sub = initialSub;
		let stackHead: Link | undefined = undefined;
		let checkDepth = 0;
		let dirty = false;

		top: do {
			const dep = currentLink!.dep;
			const flags = dep.flags;

			if (sub.flags & ReactiveFlags.Dirty) {
				dirty = true;
			} else if (
				(flags & (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) ===
					(ReactiveFlags.Mutable | ReactiveFlags.Dirty)
			) {
				const subs = dep.subs!;
				if (update(dep as AnyReactiveNode)) {
					if (subs.nextSub !== undefined) shallowPropagate(subs);
					dirty = true;
				}
			} else if (
				(flags & (ReactiveFlags.Mutable | ReactiveFlags.Pending)) ===
					(ReactiveFlags.Mutable | ReactiveFlags.Pending)
			) {
				currentLink!.prevStack = stackHead;
				stackHead = currentLink;

				currentLink = dep.deps!;
				sub = dep;
				++checkDepth;
				continue;
			}

			if (!dirty) {
				const nextDep = currentLink!.nextDep;
				if (nextDep !== undefined) {
					currentLink = nextDep;
					continue;
				}
			}

			while (checkDepth--) {
				currentLink = stackHead!;
				stackHead = currentLink.prevStack;
				currentLink.prevStack = undefined;

				if (dirty) {
					const subs = sub.subs!;
					if (update(sub as AnyReactiveNode)) {
						if (subs.nextSub !== undefined) shallowPropagate(subs);
						sub = currentLink.sub;
						continue;
					}
					dirty = false;
				} else {
					sub.flags &= ~ReactiveFlags.Pending;
				}

				sub = currentLink.sub;
				const nextDep = currentLink.nextDep;
				if (nextDep !== undefined) {
					currentLink = nextDep;
					continue top;
				}
			}
			return dirty && !!sub.flags;
		} while (true);
	}

	function isValidLink(checkLink: Link, sub: ReactiveNode): boolean {
		let link = sub.depsTail;
		while (link !== undefined) {
			if (link === checkLink) return true;
			link = link.prevDep;
		}
		return false;
	}
}
