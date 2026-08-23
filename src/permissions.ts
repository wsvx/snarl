/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { log } from "./verbosity.ts";

export interface PermissionRequirement {
	descriptor: Deno.PermissionDescriptor;

	/** human-readable reason shown if denied */
	reason: string;
}

export interface PreflightOptions {
	/** if a request is denied, throw instead of just logging. defaults to `true` */
	strict?: boolean;
}

/**
 * requests every listed permission up front, before the server starts
 * handling requests, so the person is never interrupted mid-request by
 * a permission prompt they weren't expecting.
 *
 * @example
 * ```ts
 * await preflightPermissions([
 *   { descriptor: { name: "net" }, reason: "to accept incoming connections" },
 *   { descriptor: { name: "read", path: "./static" }, reason: "to serve static files" },
 * ]);
 * ```
 */
export async function preflightPermissions(
	requirements: PermissionRequirement[],
	options: PreflightOptions = {},
): Promise<void> {
	const { strict = true } = options;

	requirements = dedupe(requirements);
	const denied: PermissionRequirement[] = [];

	for (const req of requirements) {
		const status = await Deno.permissions.request(req.descriptor);
		if (status.state !== "granted") denied.push(req);
	}

	if (!denied.length) return;

	const summary = denied.map((d) => `  · ${describe(d.descriptor)} — ${d.reason}`).join("\n");
	const message = `snarl: missing permissions:\n${summary}`;

	if (strict) throw new Error(message);
	log.warn(message);
}

const DESCRIBERS: {
	[K in Deno.PermissionName]?: (d: Extract<Deno.PermissionDescriptor, { name: K }>) => string;
} = {
	read: (d) => `filesystem read${"path" in d && d.path ? ` (${d.path})` : ""}`,
	write: (d) => `filesystem write${"path" in d && d.path ? ` (${d.path})` : ""}`,
	net: (d) => `network${"host" in d && d.host ? ` (${d.host})` : ""}`,
	run: (d) => `run command${"command" in d && d.command ? ` (${d.command})` : ""}`,
	env: (d) =>
		`access environment variables${"variable" in d && d.variable ? ` (${d.variable})` : ""}`,
};

function describe(d: Deno.PermissionDescriptor): string {
	return DESCRIBERS[d.name as Deno.PermissionName]?.(d as never) ?? d.name;
}

function dedupe(reqs: PermissionRequirement[]): PermissionRequirement[] {
	const seen = new Set<string>();
	const out: PermissionRequirement[] = [];
	for (const req of reqs) {
		const key = JSON.stringify(req.descriptor);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(req);
	}
	return out;
}
