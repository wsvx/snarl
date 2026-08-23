/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { boring, getContext } from "@404/imouto";

export interface IslandMeta {
	id: string;
	moduleUrl: string;
	exportName: string;
	Component: (...args: any[]) => unknown;
}

interface CachedIsland {
	meta: IslandMeta;
	analysis?: Awaited<ReturnType<typeof import("./analyser.ts").analyseIslandSource>>;
}

const REGISTRY = new Map<string, CachedIsland>();

const USED_ISLANDS = Symbol.for("aether.used-islands");
const ISLAND_META_KEY = Symbol.for("aether.island-meta");

export function generateIslandId(moduleUrl: string, exportName: string): string {
	return boring(`${moduleUrl}:${exportName}`);
}

export function registerIslandComponent(
	// deno-lint-ignore ban-types
	Component: Function,
	moduleUrl: string,
	exportName = "default",
	id: string = generateIslandId(moduleUrl, exportName),
): IslandMeta {
	const existing = REGISTRY.get(id);

	if (existing && Deno.env.get("ENV") !== "production") {
		existing.meta.Component = Component as any;
		existing.meta.moduleUrl = moduleUrl;
		if ((Component as any)[ISLAND_META_KEY]) {
			(Component as any)[ISLAND_META_KEY] = existing;
		}
		return existing.meta;
	}

	if (existing) {
		if (existing.meta.Component !== Component || existing.meta.moduleUrl !== moduleUrl) {
			throw new Error(
				`aether: island id "${id}" is already registered from a different component/module`,
			);
		}
		return existing.meta;
	}

	const meta: IslandMeta = { id, moduleUrl, exportName, Component: Component as any };

	Object.defineProperty(Component, ISLAND_META_KEY, {
		value: meta,
		enumerable: false,
		configurable: true,
	});
	return REGISTRY.set(id, { meta }), meta;
}

export function getIslandMeta(value: unknown): IslandMeta | undefined {
	return typeof value === "function" ? (value as any)[ISLAND_META_KEY] : undefined;
}

export function getIslandMetaById(id: string): IslandMeta | undefined {
	return REGISTRY.get(id)?.meta;
}

export function getIslandModuleUrl(id: string): string | undefined {
	return REGISTRY.get(id)?.meta?.moduleUrl;
}

export function getIslandExportName(id: string): string {
	return REGISTRY.get(id)?.meta?.exportName ?? "default";
}

export function markIslandUsed(id: string): void {
	const ctx = getContext();
	if (!ctx) return;

	let used = ctx.state.get(USED_ISLANDS) as Set<string> | undefined;
	if (!used) {
		used = new Set();
		ctx.state.set(USED_ISLANDS, used);
	}

	used.add(id);
}

export function getUsedIslands(
	ctx?: { state?: Map<string | symbol, unknown> },
): ReadonlySet<string> | undefined {
	const target = ctx ?? getContext();
	if (!target?.state) return undefined;
	return target.state.get(USED_ISLANDS) as ReadonlySet<string> | undefined;
}
