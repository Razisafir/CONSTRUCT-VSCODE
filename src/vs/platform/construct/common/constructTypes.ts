/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SEC-P5: Safely parse a JSON string, returning a fallback value on failure.
 * Use this for any JSON.parse on untrusted input (LLM output, SSE chunks,
 * user-supplied strings, file contents from external sources) to prevent
 * unhandled exceptions from crashing the agent loop.
 */
export function safeJsonParse<T>(input: string, fallback: T): T {
	try {
		return JSON.parse(input) as T;
	} catch {
		return fallback;
	}
}
