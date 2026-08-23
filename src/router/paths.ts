/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

/** collapses runs of consecutive `/` down to a single `/` */
export function normalisePath(path: string): string {
	let idx = path.indexOf("//");
	if (idx === -1) return path;

	let result = path.slice(0, idx + 1);
	let start = idx + 2;
	const len = path.length;

	while (start < len) {
		idx = path.indexOf("/", start);
		if (idx === -1) {
			result += path.slice(start);
			break;
		}
		if (idx > start) {
			result += path.slice(start, idx + 1);
		}
		start = idx + 1;
	}

	return result;
}

export function hasTrailingSlash(pathname: string): boolean {
	return pathname.length > 1 && pathname.charCodeAt(pathname.length - 1) === /* "/" */ 47;
}

interface PathParts {
	pathname: string;
	search: string;
}

export function extractPathParts(rawUrl: string): PathParts {
	const schemeEnd = rawUrl.indexOf("://");
	if (schemeEnd === -1) return makeFallbackPathParts(rawUrl);

	const pathStart = rawUrl.indexOf("/", schemeEnd + 3);
	if (pathStart === -1) return { pathname: "/", search: "" };

	const hashIdx = rawUrl.indexOf("#", pathStart);
	const end = hashIdx === -1 ? rawUrl.length : hashIdx;

	const queryIdx = rawUrl.indexOf("?", pathStart);
	let pathname, search;
	if (queryIdx === -1 || queryIdx > end) {
		pathname = rawUrl.slice(pathStart, end);
		search = "";
	} else {
		pathname = rawUrl.slice(pathStart, queryIdx);
		search = rawUrl.slice(queryIdx, end);
	}

	pathname = normalisePath(pathname);
	return { pathname, search };
}

export function makeFallbackPathParts(rawUrl: string): PathParts {
	const url = new URL(rawUrl);
	return { pathname: url.pathname, search: url.search };
}
