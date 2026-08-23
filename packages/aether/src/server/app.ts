/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { type AppOptions, createApp as createImoutoApp } from "@404/imouto";
import { aether, type AetherOptions } from "./middleware.ts";
import { discoverAndRegisterIslands } from "./discover.ts";
import { IslandRegistry, type IslandRegistryOptions } from "./registry.ts";

export interface AetherAppOptions extends AppOptions {
	aether?: Omit<AetherOptions, "entrypoints" | "registry" | "islandHash" | "hmr"> & {
		entrypoints?: string[];
		islandHash?: IslandRegistryOptions["hash"];
		hmr?: boolean;
	};
}

export async function createApp(
	options: AetherAppOptions = {},
): Promise<ReturnType<typeof createImoutoApp>> {
	const { aether: aetherOpts = {}, routesDir = "./routes", ...rest } = options;

	const registry = new IslandRegistry({
		hash: aetherOpts.islandHash,
		hmr: aetherOpts.hmr ?? (Deno.env.get("ENV") !== "production"),
	});

	const app = await createImoutoApp({ routesDir, ...rest });
	const entrypoints = aetherOpts.entrypoints ?? [routesDir];
	if (entrypoints) await discoverAndRegisterIslands(entrypoints, registry);

	app.use({
		name: "aether",
		priority: 800,
		dependencies: ["context"],
		override: true,
		factory: () =>
			aether({
				entrypoints: [],
				...aetherOpts,
				registry,
			}),
		permissions: [
			{ descriptor: { name: "run", command: "esbuild" }, reason: "to bundle island components" },
			{
				descriptor: { name: "env", variable: "ESBUILD_BINARY_PATH" },
				reason: "to locate the esbuild binary",
			},
			{
				descriptor: { name: "read" } as Deno.PermissionDescriptor,
				reason: `to discover islands`,
			},
		],
	});

	return app;
}
