/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { compose, type Middleware } from "../context/middleware.ts";
import { httpMethods, type Method } from "../types.ts";
import { insertRoute, type RadixNode, type TreeOptions } from "./tree.ts";
import { extractPattern, type Route, type RouteMetadata, type RoutePayload } from "./route.ts";
import type { Router } from "./factory.ts";
import type { Handler } from "../context/mod.ts";
import { normalisePath } from "./paths.ts";

export function mergeSubRouter(
	subRoutes: Record<Method, Route<any>[]>,
	subMiddlewares: Middleware[],
	targetRoutes: Record<Method, Route<any>[]>,
	trees: Record<Method, RadixNode<RoutePayload>>,
	exactRoutes: Record<Method, Record<string, Route<any>>>,
	treeOptions: TreeOptions,
): void {
	const hasMiddlewares = subMiddlewares.length > 0;

	for (let m = 0; m < httpMethods.length; m++) {
		const method = httpMethods[m];
		const routes = subRoutes[method];

		if (!routes || routes.length === 0) continue;

		mergeMethodRoutes(
			routes,
			subMiddlewares,
			hasMiddlewares,
			targetRoutes[method],
			trees[method],
			exactRoutes[method],
			treeOptions,
		);
	}
}

function mergeMethodRoutes(
	routes: Route<any>[],
	subMiddlewares: Middleware[],
	hasMiddlewares: boolean,
	targetArray: Route<any>[],
	tree: RadixNode<RoutePayload>,
	exactMap: Record<string, Route<any>>,
	treeOptions: TreeOptions,
): void {
	const dynamicPatternRegex = /[*?:]/;
	const routesLen = routes.length;

	for (let i = 0; i < routesLen; i++) {
		const route = routes[i];

		if (hasMiddlewares) {
			route.handler = compose(subMiddlewares, route.handler);
		}

		targetArray.push(route);
		processRoutePattern(route, tree, exactMap, dynamicPatternRegex, treeOptions);
	}
}

function processRoutePattern(
	route: Route<any>,
	tree: RadixNode<RoutePayload>,
	exactMap: Record<string, Route<any>>,
	dynamicPatternRegex: RegExp,
	treeOptions: TreeOptions,
): void {
	const pattern = extractPattern(route.pattern);
	const payload: RoutePayload = { handler: route.handler, route };

	insertRoute(tree, pattern, payload, treeOptions);

	if (!dynamicPatternRegex.test(pattern)) {
		exactMap[pattern] = route;
	}
}

export function joinPrefix(parentPrefix: string, childPrefix: string): string {
	if (!parentPrefix) return childPrefix;
	if (!childPrefix) return parentPrefix;
	return normalisePath(parentPrefix + childPrefix);
}

export function createPrefixedRouter(parent: Router, prefix: string): Router {
	const prefixed: Partial<Router> = {
		routes: parent.routes,
		middlewares: parent.middlewares,
		config: parent.config,
		middlewareOrder: parent.middlewareOrder,

		use(...mw) {
			parent.use(...mw);
			return prefixed as Router;
		},

		on(method, path, handler, metadata) {
			const base = extractPattern(path);
			const prefixedPath = joinPrefix(prefix, base);
			parent.on(method, prefixedPath as any, handler, metadata);
			return prefixed as Router;
		},

		all(path, handler, metadata) {
			for (const method of httpMethods) {
				prefixed.on!(method, path, handler, metadata);
			}
			return prefixed as Router;
		},

		group(subPrefix, configure) {
			const child = createPrefixedRouter(parent, joinPrefix(prefix, subPrefix));
			configure(child);
			return prefixed as Router;
		},

		fetch: parent.fetch,
		allRoutes: parent.allRoutes,
		serve: parent.serve,
	};

	httpMethods.forEach((method) => {
		const lower = method.toLowerCase() as Lowercase<Method>;
		(prefixed as any)[lower] = (path: string, handler: Handler<any>, metadata?: RouteMetadata) =>
			prefixed.on!(method, path, handler, metadata);
	});

	return prefixed as Router;
}
