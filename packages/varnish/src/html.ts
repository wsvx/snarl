/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

const HEAD_RE = /<\/head>/;
const BODY_RE = /<\/body>/;
const HTML_RE = /<\/html>/;
const BODY_OPEN_RE = /<body(?:\s[^>]*)?>/;

export interface InjectionConfig {
	head?: string | string[];
	body?: string | string[];
}

function injectWithFallback(
	text: string,
	injection: string,
	markers: RegExp[],
	fallback?: "prepend" | "append",
): [string, boolean] {
	for (const marker of markers) {
		const [updated, injected] = injectBeforeRegex(
			text,
			marker,
			injection,
		);

		if (injected) {
			return [updated, true];
		}
	}

	if (fallback === "prepend") {
		return [injection + text, true];
	}

	if (fallback === "append") {
		return [text + injection, true];
	}

	return [text, false];
}

function injectElement(
	text: string,
	element: string,
	content: string,
	normalMarker: RegExp,
	fallbackMarkers: RegExp[],
): [string, boolean] {
	const [updated, injected] = injectBeforeRegex(
		text,
		normalMarker,
		content,
	);

	if (injected) {
		return [updated, true];
	}

	return injectWithFallback(
		text,
		`<${element}>${content}</${element}>`,
		fallbackMarkers,
	);
}

function injectBeforeRegex(text: string, pattern: RegExp, injection: string): [string, boolean] {
	const match = pattern.exec(text);
	if (!match) {
		return [text, false];
	}

	return [
		text.slice(0, match.index) + injection + text.slice(match.index),
		true,
	];
}

function splitSafeBuffer(
	buffer: string,
	markers: string[],
	finished: boolean,
): { flush: string; keep: string } {
	if (finished || buffer.length === 0) {
		return {
			flush: buffer,
			keep: "",
		};
	}

	let keepLength = 0;

	for (const marker of markers) {
		const max = Math.min(buffer.length, marker.length - 1);

		for (let length = max; length > keepLength; length--) {
			if (buffer.endsWith(marker.slice(0, length))) {
				keepLength = length;
				break;
			}
		}
	}

	if (keepLength === 0) {
		return {
			flush: buffer,
			keep: "",
		};
	}

	return {
		flush: buffer.slice(0, -keepLength),
		keep: buffer.slice(-keepLength),
	};
}

export class HtmlInjector extends TransformStream<Uint8Array, Uint8Array> {
	constructor(config: InjectionConfig) {
		const encoder = new TextEncoder(), decoder = new TextDecoder();

		const head = Array.isArray(config.head) ? config.head.join("") : config.head ?? "";
		const body = Array.isArray(config.body) ? config.body.join("") : config.body ?? "";

		let buffer = "";
		let headDone = !config.head, bodyDone = !config.body;

		super({
			transform(chunk, controller) {
				buffer += decoder.decode(chunk, { stream: true });

				if (!headDone) {
					[buffer, headDone] = injectElement(
						buffer,
						"head",
						head,
						HEAD_RE,
						[BODY_OPEN_RE, HTML_RE],
					);
				}

				if (headDone && !bodyDone) {
					[buffer, bodyDone] = injectElement(
						buffer,
						"body",
						body,
						BODY_RE,
						[HTML_RE],
					);
				}

				const markers: string[] = [];

				if (!headDone) {
					markers.push("</head>");
				}
				if (!bodyDone) {
					markers.push("</body>", "</html>");
				}

				const finished = headDone && bodyDone;

				const { flush, keep } = splitSafeBuffer(
					buffer,
					markers,
					finished,
				);

				buffer = keep;

				if (flush) {
					controller.enqueue(encoder.encode(flush));
				}
			},

			flush(controller) {
				buffer += decoder.decode();

				if (!headDone && head) {
					[buffer, headDone] = injectElement(
						buffer,
						"head",
						head,
						HEAD_RE,
						[BODY_OPEN_RE, HTML_RE],
					);
				}

				if (!bodyDone && body) {
					[buffer, bodyDone] = injectElement(
						buffer,
						"body",
						body,
						BODY_RE,
						[HTML_RE],
					);
				}

				if (buffer) {
					controller.enqueue(encoder.encode(buffer));
				}
			},
		});
	}
}
