/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

export function isPromiseLike(value: unknown): value is Promise<unknown> {
	return typeof value === "object" && value !== null && typeof (value as any).then === "function";
}
