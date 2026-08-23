/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { boring, getContext } from "@404/imouto";

const USED_ISLANDS = Symbol.for("aether.used-islands");
const ISLAND_META_KEY = Symbol.for("aether.island-meta");
const ISLAND_REGISTRY = Symbol.for("aether.island-registry");

export interface IslandMeta {
	id: string;
	moduleUrl: string;
	exportName: string;
	Component: (...args: any[]) => unknown;
}

interface CachedIsland {
	meta: IslandMeta;
}

export interface IslandRegistryOptions {
	/** derives a stable island id from `${moduleUrl}:${exportName}`. defaults to `boring` */
	hash?: (input: string) => string;

	/**
	 * when `true`, re-registering an island under an already-known id
	 * replaces its component/module in place instead of throwing */
	hmr?: boolean;
}

export class IslandRegistry {
	#entries = new Map<string, CachedIsland>();
	#hash: (input: string) => string;
	#hmr: boolean;

	constructor(options: IslandRegistryOptions = {}) {
		this.#hash = options.hash ?? boring;
		this.#hmr = options.hmr ?? false;
	}

	generateId(moduleUrl: string, exportName: string): string {
		return this.#hash(`${moduleUrl}:${exportName}`);
	}

	register(
		Component: (props: Record<string, unknown>) => unknown,
		moduleUrl: string,
		exportName = "default",
		id: string = this.generateId(moduleUrl, exportName),
	): IslandMeta {
		const existing = this.#entries.get(id);

		if (existing) {
			if (this.#hmr) {
				existing.meta.Component = Component as any;
				existing.meta.moduleUrl = moduleUrl;
				if ((Component as any)[ISLAND_META_KEY]) {
					(Component as any)[ISLAND_META_KEY] = existing.meta;
				}
				return existing.meta;
			}
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
		this.#entries.set(id, { meta });
		return meta;
	}

	getMeta(value: unknown): IslandMeta | undefined {
		return typeof value === "function" ? (value as any)[ISLAND_META_KEY] : undefined;
	}

	getMetaById(id: string): IslandMeta | undefined {
		return this.#entries.get(id)?.meta;
	}

	getModuleUrl(id: string): string | undefined {
		return this.#entries.get(id)?.meta.moduleUrl;
	}

	getExportName(id: string): string {
		return this.#entries.get(id)?.meta.exportName ?? "default";
	}
}

export function markIslandUsed(id: string): void {
	const ctx = getContext();
	if (!ctx) return;
	const used = ctx.state.getOrInsertComputed(USED_ISLANDS, () => new Set()) as Set<string>;
	used.add(id);
}

export function getUsedIslands(
	ctx?: { state?: Map<string | symbol, unknown> },
): ReadonlySet<string> | undefined {
	const target = ctx ?? getContext();
	return target?.state?.get(USED_ISLANDS) as ReadonlySet<string> | undefined;
}

export function setActiveIslandRegistry(registry: IslandRegistry): void {
	getContext()?.state.set(ISLAND_REGISTRY, registry);
}

export function getActiveIslandRegistry(): IslandRegistry | undefined {
	return getContext()?.state.get(ISLAND_REGISTRY) as IslandRegistry | undefined;
}
