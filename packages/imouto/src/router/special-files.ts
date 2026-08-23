/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { basename, toFileUrl } from "@std/path";
import type {
	ErrorModule,
	LayoutModule,
	MiddlewareModule,
	NotFoundModule,
	RootRouteMetadata,
} from "./types.ts";
import { log } from "@july/snarl/verbosity";

type SpecialAssigner = (meta: RootRouteMetadata, mod: any) => void;

const SPECIAL_FILE_HANDLERS: Record<string, SpecialAssigner> = {
	layout: (meta, mod: LayoutModule) => {
		meta.layout = mod;
	},
	middleware: (meta, mod: MiddlewareModule) => {
		const mw = mod.default;
		if (mw) {
			meta.middlewares.push(...(Array.isArray(mw) ? mw : [mw]));
		}
	},
	error: (meta, mod: ErrorModule) => {
		meta.errorBoundary = mod;
	},
	"404": (meta, mod: NotFoundModule) => {
		meta.notFound = mod;
	},
};

export async function applySpecialFile(meta: RootRouteMetadata, fsPath: string): Promise<void> {
	const name = basename(fsPath) ?? "";
	const match = name.match(/^_([a-z0-9]+)\.tsx?$/);
	const assign = match && SPECIAL_FILE_HANDLERS[match[1]];

	if (!assign) {
		log.warn("imouto", `unrecognised special file "${name}", ignoring`);
		return;
	}
	assign(meta, await import(toFileUrl(fsPath).href));
}
