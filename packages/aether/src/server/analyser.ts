/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

export type IslandConfidence = "high" | "medium" | "none";

export interface IslandAnalysis {
	isIsland: boolean;
	confidence: IslandConfidence;
	/** the directive hint if present, else null */
	directive: "island" | "server" | null;
	/** reactive primitives used, by base name (signal/computed/effect/...) */
	primitives: string[];
	/** JSX event-handler props found (onClick, onSubmit, ...) */
	eventHandlers: string[];
	/** human-readable reasons for the decision */
	reasons: string[];

	readonly ast: AstNode;
}

const REACTIVE_MODULES = new Set([
	"@404/aether/reactivity",
	"@404/aether",
	"@404/aether/client",
]);
const REACTIVE_PRIMITIVES = new Set(["signal", "computed", "effect", "batch", "untracked"]);
const EVENT_HANDLER_RE = /^on(?:[A-Z]|:[a-z])/;

export interface AstNode {
	type: string;
	[key: string]: any;
}

/** depth-first walk over every node in an ESTree AST */
export function walk(
	node: AstNode,
	enter: (node: AstNode, parent: AstNode | null) => void,
	parent: AstNode | null = null,
): void {
	if (!node || typeof node.type !== "string") return;
	enter(node, parent);

	for (const key of Object.keys(node)) {
		if (key === "type" || key === "loc" || key === "range" || key === "start" || key === "end") {
			continue;
		}
		const value = node[key];
		if (Array.isArray(value)) {
			for (const child of value) {
				if (child && typeof child === "object" && typeof child.type === "string") {
					walk(child, enter, node);
				}
			}
		} else if (value && typeof value === "object" && typeof value.type === "string") {
			walk(value, enter, node);
		}
	}
}

export async function parseSource(
	source: string,
	loader: "jsx" | "tsx" | "ts" | "js",
): Promise<AstNode> {
	const { transform } = await import("esbuild");
	const { parseModule } = await import("meriyah");

	const { code: src } = await transform(source, {
		loader: loader,
		jsx: "preserve",
		minifyIdentifiers: false,
		minifySyntax: false,
		minifyWhitespace: false,
		legalComments: "none",
	});
	return parseModule(src, { jsx: true, module: true, next: true });
}

/** read a leading directive hint ("use island" / "use client" / "use server") */
function readDirective(ast: AstNode): IslandAnalysis["directive"] {
	const first = ast.body?.[0];
	if (
		first?.type === "ExpressionStatement" &&
		first.expression?.type === "Literal" &&
		typeof first.expression.value === "string"
	) {
		const value = first.expression.value.trim();
		if (value === "use island" || value === "use client") return "island";
		if (value === "use server") return "server";
	}
	return null;
}

/** analyse a component module and decide whether it is an interactive island. */
export async function analyseIslandSource(
	source: string,
	loader: "jsx" | "tsx" | "ts" | "js",
): Promise<IslandAnalysis> {
	const ast = await parseSource(source, loader);

	const reasons: string[] = [];
	const directive = readDirective(ast);

	const reactiveBindings = new Map<string, string>();
	const reactiveNamespaces = new Set<string>();

	walk(ast, (node) => {
		if (node.type !== "ImportDeclaration") return;

		const spec = node.source?.value;
		if (typeof spec !== "string") return;

		const isReactivity = REACTIVE_MODULES.has(spec) || spec.endsWith("/reactivity");
		if (!isReactivity) return;

		for (const s of node.specifiers ?? []) {
			if (s.type === "ImportSpecifier") {
				const imported = s.imported?.name;
				if (REACTIVE_PRIMITIVES.has(imported)) reactiveBindings.set(s.local.name, imported);
			} else if (s.type === "ImportNamespaceSpecifier" || s.type === "ImportDefaultSpecifier") {
				reactiveNamespaces.add(s.local.name);
			}
		}
	});

	const primitives = new Set<string>();
	const eventHandlers = new Set<string>();

	walk(ast, (node) => {
		if (node.type === "CallExpression") {
			const callee = node.callee;
			if (callee?.type === "Identifier" && reactiveBindings.has(callee.name)) {
				primitives.add(reactiveBindings.get(callee.name)!);
			} else if (
				callee?.type === "MemberExpression" &&
				callee.object?.type === "Identifier" &&
				reactiveNamespaces.has(callee.object.name) &&
				callee.property?.type === "Identifier" &&
				REACTIVE_PRIMITIVES.has(callee.property.name)
			) {
				primitives.add(callee.property.name);
			}
		}

		if (node.type === "JSXAttribute") {
			let name, testName;

			if (node.name?.type === "JSXIdentifier") {
				testName = node.name.name;

				if (testName.startsWith("on") && testName.length > 2) {
					name = `on:${testName.slice(2).toLowerCase()}`;
				} else {
					name = testName;
				}
			} else if (node.name?.type === "JSXNamespacedName") {
				const namespace = node.name.namespace?.name;
				const pathName = node.name.name?.name;
				if (namespace && pathName) {
					name = `${namespace}:${pathName}`;
					if (namespace === "bind") {
						eventHandlers.add(name);
					}
				}
			}

			if (
				typeof name === "string" && EVENT_HANDLER_RE.test(testName ?? name) &&
				node.value?.type === "JSXExpressionContainer"
			) {
				eventHandlers.add(name);
			}
		}
	});

	const hasHandlers = eventHandlers.size > 0;
	const hasStateOrEffect = primitives.has("signal") || primitives.has("effect");
	const hasReactivity = primitives.size > 0;

	let isIsland = false;
	let confidence: IslandConfidence = "none";

	if (directive === "server") {
		isIsland = false;
		confidence = "high";
		reasons.push(`"use server" directive`);
	} else if (directive === "island") {
		isIsland = true;
		confidence = "high";
		reasons.push(`"use island" directive`);
	} else if (hasHandlers || hasStateOrEffect) {
		isIsland = true;
		confidence = "high";
	} else if (hasReactivity) {
		isIsland = true;
		confidence = "medium";
	}

	if (hasReactivity) reasons.push(`uses reactivity: ${[...primitives].join(", ")}`);
	if (hasHandlers) reasons.push(`has event handlers: ${[...eventHandlers].join(", ")}`);

	return {
		isIsland,
		confidence,
		directive,
		primitives: [...primitives],
		eventHandlers: [...eventHandlers],
		reasons,
		ast,
	};
}
