/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { decodeHex, encodeHex } from "@std/encoding";

/**
 * configuration options for setting a cookie
 */
export interface CookieOptions {
	/**
	 * Prepend `__Host-` or `__Secure-` and enforce corresponding attributes:
	 * - `"host"` sets Path=/, Secure, forbids `Domain`
	 * - `"secure" sets Secure
	 */
	prefix?: "host" | "secure";
	/**
	 * the expiration date of the cookie. if omitted, the cookie becomes a session cookie
	 */
	expires?: Date;
	/**
	 * the maximum age of the cookie in seconds
	 */
	maxAge?: number;
	/**
	 * the domain for which the cookie is valid
	 */
	domain?: string;
	/**
	 * the path for which the cookie is valid. defaults to `/`
	 */
	path?: string;
	/**
	 * whether the cookie will only be sent if the connection is established through HTTPS. defaults to `true`
	 */
	secure?: boolean;
	/**
	 * whether the cookie disallows to be accessed via javascript. defaults to `true`
	 */
	httpOnly?: boolean;
	/**
	 * the `SameSite` attribute (`Strict`, `Lax`, or `None`).
	 * Defaults to `Lax`
	 */
	sameSite?: "Strict" | "Lax" | "None";
}

/**
 * parses the `Cookie` header string into an object
 * @param header the value of the `Cookie` request header
 * @returns an object mapping cookie names to their decoded values
 * @example
 * parseCookies("session=mrrp; user=meow") // { session: "mrrp", user: "meow" }
 */
export function parseCookies(header: string | null): Record<string, string> {
	if (!header) return {};

	const cookies: Record<string, string> = {};

	for (const cookie of header.split(";")) {
		const trimmed = cookie.trim();
		const idx = trimmed.indexOf("=");

		if (idx === -1) continue;

		const name = trimmed.slice(0, idx).trim();
		const value = trimmed.slice(idx + 1).trim();

		try {
			cookies[name] = decodeURIComponent(value);
		} catch {
			cookies[name] = value;
		}
	}

	return cookies;
}

/**
 * serializes a cookie into a `Set-Cookie` header string
 * @param name the name of the cookie
 * @param value the value of the cookie
 * @param options additional options for the cookie
 * @returns a formatted `Set-Cookie` header string
 */
export function serializeCookie(
	name: string,
	value: string,
	options: CookieOptions = {},
): string {
	return serialiseCookie(name, value, options);
}

/**
 * serialises a cookie into a `Set-Cookie` header string
 * @param name the name of the cookie
 * @param value the value of the cookie
 * @param options additional options for the cookie
 * @returns a formatted `Set-Cookie` header string
 */
export function serialiseCookie(
	name: string,
	value: string,
	options: CookieOptions = {},
): string {
	if (options.prefix === "host") {
		name = `__Host-${name}`;
		options.path = "/";
		options.secure = true;
		delete options.domain;
	} else if (options.prefix === "secure") {
		name = `__Secure-${name}`;
		options.secure = true;
	}

	let cookie = `${name}=${encodeURIComponent(value)}`;

	if (options.expires) {
		cookie += `; Expires=${options.expires.toUTCString()}`;
	}
	if (options.maxAge !== undefined) {
		cookie += `; Max-Age=${options.maxAge}`;
	}
	if (options.domain) {
		cookie += `; Domain=${options.domain}`;
	}
	if (options.path) {
		cookie += `; Path=${options.path}`;
	}
	if (options.secure !== false) {
		cookie += "; Secure";
	}
	if (options.httpOnly !== false) {
		cookie += "; HttpOnly";
	}
	if (options.sameSite != null) {
		if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
	} else {
		cookie += `; SameSite=Lax`;
	}

	return cookie;
}

/**
 * creates a `Set-Cookie` header string that instructs the client to delete a cookie
 * @param name the name of the cookie to delete
 * @param options options such as domain or path to ensure the cookie matches correctly
 * @returns a formatted `Set-Cookie` header string
 */
export function deleteCookie(
	name: string,
	options?: Omit<CookieOptions, "expires" | "maxAge">,
): string {
	return serialiseCookie(name, "", {
		...options,
		expires: new Date(0),
		maxAge: 0,
	});
}

function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

/**
 * signs a value with HMAC-SHA256 and appends the signature, so a later
 * `unsignValue()` call can detect tampering. this does not encrypt the
 * value. it remains visible to the client. it only proves the server
 * produced it
 *
 * @example
 * ```ts
 * const signed = await signValue("user-id:42", secret);
 * jar.set("session", signed);
 * ```
 */
export async function signValue(value: string, secret: string): Promise<string> {
	const key = await hmacKey(secret);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return `${value}.${encodeHex(sig)}`;
}

/**
 * verifies a value produced by `signValue()`
 *
 * @returns the original value if the signature is valid, or `undefined`
 * if the input is missing, malformed, or the signature doesn't match
 */
export async function unsignValue(signed: string, secret: string): Promise<string | undefined> {
	const idx = signed.lastIndexOf(".");
	if (idx === -1) return undefined;

	const value = signed.slice(0, idx);
	const sigHex = signed.slice(idx + 1);

	let sig: Uint8Array<ArrayBuffer>;
	try {
		sig = decodeHex(sigHex);
	} catch {
		return undefined;
	}

	const key = await hmacKey(secret);
	const valid = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(value));
	return valid ? value : undefined;
}

/**
 * a helper class to manage request cookies (input) and response cookies (output)
 */
export class CookieJar {
	private parsed?: Record<string, string>;
	private setCookieHeaders: string[] = [];

	/**
	 * parses the `Cookie` header and creates a new `CookieJar` instance
	 * @param header the value of the `Cookie` request header
	 */
	constructor(private readonly header: string | null) {}

	private ensureParsed(): Record<string, string> {
		return this.parsed ??= parseCookies(this.header);
	}

	/**
	 * gets a cookie value from the request
	 * @param name the name of the cookie
	 * @returns the cookie value or undefined if not found
	 */
	get(name: string): string | undefined {
		return this.ensureParsed()[name];
	}

	/**
	 * gets and verifies a cookie set via `setSigned()`
	 *
	 * @param name the name of the cookie
	 * @param secret the same secret passed to `setSigned()`
	 *
	 * @returns the original value, or `undefined` if the cookie is
	 * absent, malformed, or was tampered with / signed under a different secret
	 */
	async getSigned(name: string, secret: string): Promise<string | undefined> {
		const raw = this.get(name);
		if (raw === undefined) return undefined;
		return await unsignValue(raw, secret);
	}

	/**
	 * sets a cookie whose value is HMAC-signed with `secret`, so a later
	 * `getSigned()` call can detect tampering.
	 *
	 * @example
	 * ```ts
	 * await ctx.cookies.setSigned("session", `user:${userId}`, Deno.env.get("COOKIE_SECRET")!);
	 * ```
	 */
	async setSigned(
		name: string,
		value: string,
		secret: string,
		options?: CookieOptions,
	): Promise<void> {
		this.set(name, await signValue(value, secret), options);
	}

	/**
	 * sets and overwrites (if previously set) a cookie to be sent in the response.
	 * @param name the name of the cookie
	 * @param value the value of the cookie
	 * @param options options for the cookie (`path`, `maxAge`, etc.)
	 */
	set(name: string, value: string, options?: CookieOptions): void {
		this.ensureParsed()[name] = value;
		this.setCookieHeaders = this.setCookieHeaders.filter((h) => !h.startsWith(`${name}=`));
		this.setCookieHeaders.push(serialiseCookie(name, value, options));
	}

	/**
	 * deletes a cookie by setting its expiration to the past
	 * @param name the name of the cookie to delete
	 * @param options options such as domain/path to ensure correct matching
	 */
	delete(name: string, options?: Omit<CookieOptions, "expires" | "maxAge">): void {
		delete this.ensureParsed()[name];
		this.setCookieHeaders.push(deleteCookie(name, options));
	}

	/**
	 * checks if a cookie exists in the request
	 * @param name the name of the cookie
	 * @returns whether the cookie exists
	 */
	has(name: string): boolean {
		return name in this.ensureParsed();
	}

	/**
	 * returns a copy of all cookies from the request
	 * @returns an object of all cookie names and values
	 */
	allCookies(): Record<string, string> {
		return { ...this.ensureParsed() };
	}

	/**
	 * gets the list of `Set-Cookie` header strings to be sent in the response
	 * @returns an array of header strings
	 */
	get headers(): string[] {
		return this.setCookieHeaders;
	}
}

export type Cookies = CookieJar;
