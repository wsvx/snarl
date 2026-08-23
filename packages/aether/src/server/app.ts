/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { type AppOptions, createApp as createImoutoApp } from "@404/imouto";
import { aether, type AetherOptions } from "./middleware.ts";
import { discoverAndRegisterIslands } from "./discover.ts";

export interface AetherAppOptions extends AppOptions {
	aether?: Omit<AetherOptions, "entrypoints"> & { entrypoints?: string[] };
}

export async function createApp(
	options: AetherAppOptions = {},
): Promise<ReturnType<typeof createImoutoApp>> {
	const { aether: aetherOpts = {}, routesDir = "./routes", ...rest } = options;

	const app = await createImoutoApp({ routesDir, ...rest });

	const entrypoints = aetherOpts.entrypoints ?? [routesDir];
	if (entrypoints) {
		await discoverAndRegisterIslands(entrypoints);
	}

	app.use({
		name: "aether",
		priority: 800,
		dependencies: ["context"],
		override: true,
		factory: () =>
			aether({
				entrypoints: [],
				...aetherOpts,
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
