/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { jsx } from "@july/snarl/jsx-runtime";
import type { Context, JSX } from "@july/snarl";
import { markStyleUsed, scopeCss, styleRegistry } from "@404/varnish";
import { getContext } from "./context.ts";
import { boring } from "./hash/mod.ts";
import { log } from "@july/snarl/verbosity";

export type CssCollisionPolicy = "throw" | "warn";

export interface Css {
	/**
	 * creates a scoped stylesheet from a CSS string

	 * @example
	 * ```js
	 * const root = css`
	 *   :scope { display: flex; }
	 *   .title { font-size: 2rem; }
	 * `;
	 *
	 * function Greet() {
	 *   return <div class={root}><h1 class="title">Hello</h1></div>;
	 * }
	 * ```
	 */
	<const S extends string>(
		strings: TemplateStringsArray | S,
		...values: unknown[]
	): ScopedStyles;
}

/** a scoped stylesheet object */
export interface ScopedStyles {
	/** the unique scope identifier applied to the root element */
	readonly id: string;

	/** coerces to the scope class name and auto-registers for injection */
	toString(): string;

	/** :3 */
	readonly raw: string;

	/** mark this stylesheet as used for the current request */
	use(ctx?: Context): void;
}

const stylesheetProto = Object.create(null, {
	toString: {
		enumerable: false,
		writable: false,
		value(this: ScopedStyles): string {
			const ctx = getContext();
			if (ctx) markStyleUsed(ctx, this.id);
			return this.id;
		},
	},
});

export interface CssConfig {
	hash: (input: string) => string;

	/**
	 * what to do when two different source strings hash to the same
	 * scope. `"throw"` (default) fails fast; `"warn"` logs and keeps
	 * the first-registered stylesheet */
	onCollision?: CssCollisionPolicy;
}

export type ScopedComponent = JSX.FC<{ children?: any; class?: string; [key: string]: unknown }>;

export type StyledFactory = {
	[K in keyof HTMLElementTagNameMap]: (
		strings: TemplateStringsArray,
		...values: unknown[]
	) => ScopedComponent;
};

export type ScopedStyleSheet =
	& ScopedStyles
	& {
		[K in keyof HTMLElementTagNameMap]: ScopedComponent;
	}
	& {
		readonly styled: StyledFactory;
	};

function createComponent(tag: string, scope: string): ScopedComponent {
	return function TagComponent(props: Record<string, unknown> = {}) {
		const ctx = getContext();
		if (ctx) markStyleUsed(ctx, scope);

		if (tag === "html" || tag === "body" || tag === "head") scope = "";

		const { class: className, ...rest } = props;
		return jsx(tag, {
			...rest,
			class: className ? `${scope ? `${scope} ` : ""}${className}` : scope,
		});
	};
}

function registerScope(scope: string, compiled: string, onCollision: CssCollisionPolicy): string {
	const existing = styleRegistry.get(scope);

	if (existing !== undefined && existing !== compiled) {
		const message = `imouto: CSS hash collision detected for scope "${scope}"`;
		if (onCollision === "warn") log.warn("css", message);
		else throw new Error(message);
	}

	styleRegistry.set(scope, compiled);
	return scope;
}

function createStyledComponent(
	tag: string,
	src: string,
	scope: string,
	onCollision: CssCollisionPolicy,
): ScopedComponent {
	const shouldIgnore = tag === "html" || tag === "body" || tag === "head";
	registerScope(scope, scopeCss(src, shouldIgnore ? "" : `.${scope}`), onCollision);
	return createComponent(tag, scope);
}

function createScopedStyles(src: string, config: CssConfig): ScopedStyleSheet {
	const { hash: hashFn, onCollision = "throw" } = config;

	let scope = hashFn(src);
	scope = registerScope(scope, scopeCss(src, `.${scope}`), onCollision);

	const styledFactory = new Proxy({} as StyledFactory, {
		get(_target, property: string) {
			const tag = property.toLowerCase();
			return (strings: TemplateStringsArray, ...values: unknown[]) => {
				const additional = strings.reduce<string>(
					(acc, str, i) => acc + str + (values[i] ?? ""),
					"",
				).trim();
				const combined = `${src} ${additional}`;
				const scope$styled = hashFn(combined);
				return createStyledComponent(tag, combined, scope$styled, onCollision);
			};
		},
	});

	const componentProxy = new Proxy(
		Object.create(stylesheetProto, {
			id: { value: scope, enumerable: true },
			use: {
				value: function (ctx?: Context) {
					const resolved = ctx ?? getContext();
					if (!resolved) throw new Error("css.use(): no request context available");
					markStyleUsed(resolved, scope);
				},
			},
			raw: { value: src, enumerable: false },
			styled: { value: styledFactory, enumerable: true },
		}),
		{
			get(target, tag: string) {
				if (tag in target) return target[tag];
				if (tag === "styled") return styledFactory;
				return createStyledComponent(tag, src, scope, onCollision);
			},
		},
	);

	return componentProxy as ScopedStyleSheet;
}

export interface CssTag {
	(strings: TemplateStringsArray, ...values: unknown[]): ScopedStyleSheet;
}

export function createStyles(
	config: CssConfig = { hash: boring },
): { css: CssTag; styled: StyledFactory } {
	function cssTag(strings: TemplateStringsArray, ...values: unknown[]): ScopedStyleSheet {
		const src = strings.reduce<string>(
			(acc, str, i) => acc + str + (values[i] ?? ""),
			"",
		).trim();
		return createScopedStyles(src, config);
	}

	const styled = new Proxy({} as StyledFactory, {
		get(_target, property: string) {
			const tag = property.toLowerCase();
			return (strings: TemplateStringsArray, ...values: unknown[]) => {
				const src = strings.reduce<string>(
					(acc, str, i) => acc + str + (values[i] ?? ""),
					"",
				).trim();
				const styles = createScopedStyles(src, config);
				return createComponent(tag, styles.id);
			};
		},
	});

	return { css: cssTag, styled };
}

let defaultHash: CssConfig["hash"] = boring;
let defaultOnCollision: CssCollisionPolicy = "throw";
let cachedInstance = createStyles({ hash: defaultHash, onCollision: defaultOnCollision });

export function configureDefaultCss(config: Partial<CssConfig>): void {
	if (config.hash) defaultHash = config.hash;
	if (config.onCollision) defaultOnCollision = config.onCollision;
	cachedInstance = createStyles({ hash: defaultHash, onCollision: defaultOnCollision });
}

export const css: CssTag = (strings, ...values) => cachedInstance.css(strings, ...values);
export const styled: StyledFactory = new Proxy({} as StyledFactory, {
	get: (_t, prop: string) => cachedInstance.styled[prop as keyof StyledFactory],
});
