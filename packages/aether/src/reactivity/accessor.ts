/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import type { Computed } from "./computed.ts";

export interface ReactiveAccessor<T> {
	/** Reactive `get`/`set` operators wrapped within a `Proxy`. */
	value: T;

	/**
	 * Derives a lazy, reactive `Computed` from this signal. This is the
	 * correct way to put a transformation or comparison directly in JSX
	 * and have it re-render on change, e.g.:
	 *
	 * `{count.map(n => n > 5 ? "big" : "small")}` is reactive
	 * `{count() > 5 ? "big" : "small"}` isn't reactive and only evaluates once
	 *
	 * Basically, it's because a plain call/coercion is just a read. `.map()`
	 * wraps the read in a `computed()`, which JSX already knows how to
	 * subscribe to (same as embedding a bare signal).
	 */
	map<U>(fn: (value: T) => U): Computed<U>;

	/** Reads the current value without subscribing the active `effect`/`computed` to it. */
	peek(): T;

	/**
	 * shorthand for `.map(v => v === value)`
	 */
	is(value: T): Computed<boolean>;

	/**
	 * Allows implicit or explicit type coercion to a primitive value outside of JSX contexts.
	 * This is *not* a it is NOT a substitute for `.map()` when embedding a derived/comparison
	 * value directly in JSX.
	 *
	 * @see {@link map}
	 */
	[Symbol.toPrimitive](hint: "string" | "number" | "default"): string | number;
}
