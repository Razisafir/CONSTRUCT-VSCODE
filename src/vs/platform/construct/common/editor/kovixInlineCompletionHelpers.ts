// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Pure-logic helpers for the inline completion provider.
 *
 *  Extracted to a separate file with ZERO VS Code imports so that the unit
 *  tests can exercise this logic without dragging in the entire service
 *  layer. The provider class in kovixInlineCompletionProvider.ts imports
 *  these helpers.
 *
 *  Tier 1, item 1.1 of the KOVIX Technical Audit roadmap.
 *--------------------------------------------------------------------------------------------*/

// Tunable defaults — also configurable via settings
export const MAX_PREFIX_CHARS = 4000;
export const MAX_SUFFIX_CHARS = 2000;
export const CACHE_SIZE = 16;
export const CACHE_TTL_MS = 60_000;
export const DEFAULT_DEBOUNCE_MS = 200;

/**
 * Build a stable cache key from prefix + suffix.
 *
 * Non-cryptographic; just needs to be deterministic and reasonably collision-free
 * across the working set of (prefix, suffix) pairs a single user generates.
 */
export function buildCacheKey(prefix: string, suffix: string): string {
	// Truncate long inputs to keep hashing cheap
	const p = prefix.length > 400
		? prefix.substring(0, 200) + '…' + prefix.substring(prefix.length - 200)
		: prefix;
	const s = suffix.length > 400
		? suffix.substring(0, 200) + '…' + suffix.substring(suffix.length - 200)
		: suffix;
	const str = p + '|||' + s;
	// djb2-ish hash: fast, good distribution for short strings
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i);
		hash = hash & hash; // force 32-bit
	}
	return (hash >>> 0).toString(36);
}

/**
 * Bound the prefix/suffix sent to the model so we don't ship the entire file
 * to the LLM on every keystroke. Keeps latency and token cost bounded.
 */
export function boundContext(
	offset: number,
	fullTextLength: number
): { prefixStart: number; suffixEnd: number } {
	const prefixStart = Math.max(0, offset - MAX_PREFIX_CHARS);
	const suffixEnd = Math.min(fullTextLength, offset + MAX_SUFFIX_CHARS);
	return { prefixStart, suffixEnd };
}

/**
 * Strip trailing whitespace that adds no value as a suggestion.
 * Leading whitespace (indentation) is preserved.
 */
export function normalizeSuggestion(text: string): string {
	return text.replace(/\s+$/, '');
}

/**
 * Decide whether a suggestion is meaningfully different from the text
 * already present after the cursor. If the suggestion is just a prefix of
 * what's already on the line, we should not display it.
 */
export function isSuggestionUseful(
	suggestion: string,
	textAfterCursor: string
): boolean {
	if (suggestion.length === 0) {
		return false;
	}
	if (textAfterCursor.startsWith(suggestion) && suggestion.length <= textAfterCursor.length) {
		return false;
	}
	return true;
}

/**
 * LRU cache for (prefix, suffix) → suggestion pairs.
 * Capped at CACHE_SIZE entries; entries older than CACHE_TTL_MS are evicted
 * on lookup.
 */
export class SuggestionCache {
	private readonly _entries: Map<string, { suggestion: string; timestamp: number }> = new Map();
	private readonly _keysInOrder: string[] = [];

	get(key: string): string | undefined {
		const entry = this._entries.get(key);
		if (!entry) {
			return undefined;
		}
		if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
			// Stale — evict
			this._entries.delete(key);
			const idx = this._keysInOrder.indexOf(key);
			if (idx >= 0) {
				this._keysInOrder.splice(idx, 1);
			}
			return undefined;
		}
		return entry.suggestion;
	}

	set(key: string, suggestion: string): void {
		// Evict oldest if at capacity
		while (this._keysInOrder.length >= CACHE_SIZE) {
			const oldest = this._keysInOrder.shift();
			if (oldest) {
				this._entries.delete(oldest);
			}
		}
		this._entries.set(key, { suggestion, timestamp: Date.now() });
		this._keysInOrder.push(key);
	}

	clear(): void {
		this._entries.clear();
		this._keysInOrder.length = 0;
	}

	get size(): number {
		return this._entries.size;
	}
}

/**
 * Parse a unified diff and return the list of added lines (lines starting with '+').
 *
 * Used by the inline-edit controller (Patch B) to extract the new code from a
 * model-produced unified diff.
 */
export function extractAddedLinesFromDiff(diff: string): string[] {
	const added: string[] = [];
	for (const line of diff.split('\n')) {
		// Skip diff metadata lines
		if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
			continue;
		}
		// Added line — strip the leading '+'
		if (line.startsWith('+') && !line.startsWith('+++')) {
			added.push(line.substring(1));
		}
	}
	return added;
}

/**
 * Detect the ERROR sentinel produced by the inline-edit system prompt.
 * Returns the error message if the diff is an error sentinel, or null otherwise.
 */
export function detectErrorSentinel(diff: string): string | null {
	const trimmed = diff.trim();
	if (trimmed.startsWith('ERROR:')) {
		return trimmed.substring('ERROR:'.length).trim();
	}
	return null;
}
