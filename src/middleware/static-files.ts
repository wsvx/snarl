/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { encodeHex } from "@std/encoding/hex";
import { contentType } from "@std/media-types";
import { extname, isAbsolute, join, relative, resolve, SEPARATOR } from "@std/path";
import type { Middleware } from "../context/mod.ts";
import { HttpError } from "../errors.ts";
import { ByteSliceStream } from "@std/streams";
import { log } from "../verbosity.ts";

export type CustomContentTypes = Record<string, string>;

export interface StaticFilesOptions {
	maxAge?: number;
	immutable?: boolean;
	index?: string;
	/**
	 * `"weak"` (default): `size+mtime` etag
	 * `"strong"`: SHA-256 content hash, disables streaming
	 * `false`: no etag
	 */
	etag?: boolean | "weak" | "strong";
	dotfiles?: "allow" | "ignore" | "deny";
	maxRangeLength?: number;
	strongEtagThreshold?: number;
	/** custom content-type overrides extending or replacing `@std/media-types` */
	customContentTypes?: CustomContentTypes;
	/** URL path to mount under. files are served at `${prefix}/...`. defaults to root mount ("/"). */
	prefix?: string;
}

function resolveContentType(
	ext: string,
	overrides?: CustomContentTypes,
): string | undefined {
	if (overrides) {
		const norm = ext.toLowerCase();
		const withoutDot = norm.startsWith(".") ? norm.slice(1) : norm;
		const withDot = norm.startsWith(".") ? norm : `.${norm}`;

		if (withDot in overrides) return overrides[withDot];
		if (withoutDot in overrides) return overrides[withoutDot];
	}

	return contentType(ext);
}

function computeWeakETag(stat: Deno.FileInfo): string {
	const mtime = stat.mtime?.getTime() ?? 0;
	return `W/"${stat.size.toString(16)}-${mtime.toString(16)}"`;
}

async function computeStrongETag(filepath: string): Promise<string> {
	const file = await Deno.readFile(filepath);
	const digest = await crypto.subtle.digest("SHA-256", file);
	return encodeHex(digest);
}

function parseRangeHeader(
	rangeHeader: string,
	fileSize: number,
	maxRangeLength: number,
): { start: number; end: number } | null {
	const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return null;

	const [, startStr, endStr] = match;
	if (startStr === "" && endStr === "") return null;

	let start: number, end: number;
	if (startStr === "") {
		const suffixLength = parseInt(endStr, 10);
		if (isNaN(suffixLength) || suffixLength <= 0) return null;
		start = Math.max(0, fileSize - suffixLength);
		end = fileSize - 1;
	} else {
		start = parseInt(startStr, 10);
		end = endStr ? parseInt(endStr, 10) : fileSize - 1;
	}

	if (
		isNaN(start) || isNaN(end) || start < 0 || end < 0 || start > end || start >= fileSize ||
		end >= fileSize
	) {
		return null;
	}
	if ((end - start + 1) > maxRangeLength) return null;

	return { start, end };
}

/**
 * Serves static files from a directory, streaming from disk rather than
 * buffering into memory.
 *
 * @example
 * ```js
 * app.use(staticFiles("public", { immutable: true, dotfiles: "deny" }));
 * app.use(staticFiles("uploads", { etag: "strong" })); // content hashing
 * ```
 */
export function staticFiles(root: string, options: StaticFilesOptions = {}): Middleware {
	const {
		maxAge = 3600,
		immutable = false,
		index = "index.html",
		etag: etagOption = "weak",
		dotfiles = "ignore",
		maxRangeLength = 128 * 1024 * 1024,
		strongEtagThreshold = 1024 * 1024,
		customContentTypes,
		prefix = "",
	} = options;

	const etagMode = etagOption === false ? false : etagOption === true ? "weak" : etagOption;
	root = resolve(Deno.cwd(), root);

	let mount = prefix;
	if (mount && !mount.startsWith("/")) mount = `/${mount}`;
	if (mount.endsWith("/")) mount = mount.slice(0, -1);

	return async (ctx, next) => {
		if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") {
			return next();
		}

		const pathname = decodeURIComponent(ctx.url.pathname);
		let rel: string;
		if (mount === "") {
			rel = pathname.slice(1);
		} else if (pathname === mount) {
			rel = "";
		} else if (pathname.startsWith(`${mount}/`)) {
			rel = pathname.slice(mount.length + 1);
		} else {
			return next();
		}

		let filepath = resolve(root, rel);

		const relativePath = relative(root, filepath);

		if (
			relativePath === ".." || relativePath.startsWith(`..${SEPARATOR}`) || isAbsolute(relativePath)
		) {
			return next();
		}
		if (relativePath !== "." && /(^|[\\/])\./.test(relativePath)) {
			if (dotfiles === "deny") return new Response("Forbidden", { status: 403 });
			if (dotfiles === "ignore") return next();
		}

		let stat: Deno.FileInfo;
		try {
			stat = await Deno.stat(filepath);
			if (stat.isDirectory) {
				filepath = join(filepath, index);
				stat = await Deno.stat(filepath);
			}
		} catch (err) {
			if (!(err instanceof Deno.errors.NotFound)) {
				throw err;
			}
			return next();
		}

		const ext = extname(filepath).toLowerCase();

		const headers = new Headers({
			"Content-Type": resolveContentType(ext, customContentTypes) ?? "application/octet-stream",
		});

		if (etagMode) {
			let tag: string;
			if (etagMode === "strong" && stat.size <= strongEtagThreshold) {
				tag = await computeStrongETag(filepath);
			} else {
				if (etagMode === "strong" && stat.size > strongEtagThreshold) {
					log.warn("staticFiles", `file ${filepath} is too large for strong etag`);
				}
				tag = computeWeakETag(stat);
			}
			headers.set("ETag", tag);
			if (ctx.request.headers.get("If-None-Match") === tag) {
				return new Response(null, { status: 304, headers });
			}
		}

		const rangeHeader = ctx.request.headers.get("Range");
		if (rangeHeader) {
			const range = parseRangeHeader(rangeHeader, stat.size, maxRangeLength);

			if (!range) {
				headers.set("Content-Range", `bytes */${stat.size}`);
				throw new HttpError(416, "Range Not Satisfiable", headers);
			}

			const { start, end } = range;
			const chunkLen = end - start + 1;

			headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
			headers.set("Accept-Ranges", "bytes");
			headers.set("Content-Length", chunkLen.toString());

			let file: Deno.FsFile;
			try {
				file = await Deno.open(filepath, { read: true });
				await file.seek(start, Deno.SeekMode.Start);
			} catch {
				return next();
			}

			return new Response(file.readable.pipeThrough(new ByteSliceStream(0, chunkLen - 1)), {
				status: 206,
				headers,
			});
		}

		if (maxAge > 0 || immutable) {
			const directives = [`max-age=${maxAge}`];
			if (immutable) directives.push("immutable");
			headers.set("Cache-Control", directives.join(", "));
		}
		headers.set("Content-Length", stat.size.toString());

		let file: Deno.FsFile;
		try {
			file = await Deno.open(filepath, { read: true });
		} catch {
			return next();
		}
		return new Response(file.readable, { headers });
	};
}
