/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for the KovixInlineCompletionProvider pure-logic helpers.
 *
 * These tests cover the parts of the autocomplete pipeline that can be tested
 * without instantiating VS Code services: cache key stability, context
 * bounding, suggestion normalization, and the "is this suggestion useful"
 * heuristic. The provider class itself requires a running editor and a
 * configured AI service, so it is exercised by smoke tests instead.
 */

import * as assert from 'assert';
import {
        buildCacheKey,
        boundContext,
        normalizeSuggestion,
        isSuggestionUseful,
        SuggestionCache,
        extractAddedLinesFromDiff,
        detectErrorSentinel,
} from '../../../../src/vs/platform/construct/common/editor/kovixInlineCompletionHelpers.js';

suite('KovixInlineCompletionProvider', () => {

        suite('buildCacheKey', () => {

                test('returns a stable key for identical inputs', () => {
                        const k1 = buildCacheKey('const x = ', '\nconst y = 2;');
                        const k2 = buildCacheKey('const x = ', '\nconst y = 2;');
                        assert.strictEqual(k1, k2);
                });

                test('returns different keys for different inputs', () => {
                        const k1 = buildCacheKey('const x = ', '\nconst y = 2;');
                        const k2 = buildCacheKey('const x = ', '\nconst y = 3;');
                        assert.notStrictEqual(k1, k2);
                });

                test('returns different keys for swapped prefix/suffix', () => {
                        const k1 = buildCacheKey('aaa', 'bbb');
                        const k2 = buildCacheKey('bbb', 'aaa');
                        assert.notStrictEqual(k1, k2);
                });

                test('handles empty inputs', () => {
                        const k1 = buildCacheKey('', '');
                        const k2 = buildCacheKey('', '');
                        assert.strictEqual(k1, k2);
                        assert.ok(k1.length > 0);
                });

                test('truncates very long inputs without crashing', () => {
                        const long = 'a'.repeat(10_000);
                        const key = buildCacheKey(long, long);
                        assert.ok(key.length > 0);
                        // Should be deterministic
                        assert.strictEqual(key, buildCacheKey(long, long));
                });

                test('produces a reasonably short key (base36, 32-bit)', () => {
                        const key = buildCacheKey('hello', 'world');
                        // 32-bit number in base36 → max 7 chars
                        assert.ok(key.length <= 7, `key too long: ${key}`);
                });
        });

        suite('boundContext', () => {

                test('returns full range when offset is in the middle', () => {
                        const { prefixStart, suffixEnd } = boundContext(5000, 10_000);
                        // 5000 - 4000 = 1000, 5000 + 2000 = 7000
                        assert.strictEqual(prefixStart, 1000);
                        assert.strictEqual(suffixEnd, 7000);
                });

                test('clamps prefixStart to 0 when offset is near start', () => {
                        const { prefixStart, suffixEnd } = boundContext(100, 10_000);
                        assert.strictEqual(prefixStart, 0);
                        assert.strictEqual(suffixEnd, 2100);
                });

                test('clamps suffixEnd to text length when offset is near end', () => {
                        const { prefixStart, suffixEnd } = boundContext(9900, 10_000);
                        assert.strictEqual(prefixStart, 5900);
                        assert.strictEqual(suffixEnd, 10_000);
                });

                test('handles offset at start of empty file', () => {
                        const { prefixStart, suffixEnd } = boundContext(0, 0);
                        assert.strictEqual(prefixStart, 0);
                        assert.strictEqual(suffixEnd, 0);
                });

                test('handles offset equal to text length (cursor at EOF)', () => {
                        const { prefixStart, suffixEnd } = boundContext(100, 100);
                        assert.strictEqual(prefixStart, 0);
                        assert.strictEqual(suffixEnd, 100);
                });
        });

        suite('normalizeSuggestion', () => {

                test('strips trailing newlines', () => {
                        assert.strictEqual(normalizeSuggestion('foo\n\n\n'), 'foo');
                });

                test('strips trailing spaces', () => {
                        assert.strictEqual(normalizeSuggestion('foo   '), 'foo');
                });

                test('strips mixed trailing whitespace', () => {
                        assert.strictEqual(normalizeSuggestion('foo \n \t \n'), 'foo');
                });

                test('preserves internal whitespace', () => {
                        assert.strictEqual(normalizeSuggestion('foo  bar  '), 'foo  bar');
                });

                test('returns empty string for whitespace-only input', () => {
                        assert.strictEqual(normalizeSuggestion('   \n\t  '), '');
                });

                test('returns empty string for empty input', () => {
                        assert.strictEqual(normalizeSuggestion(''), '');
                });

                test('preserves leading whitespace (indentation matters)', () => {
                        assert.strictEqual(normalizeSuggestion('    foo  '), '    foo');
                });
        });

        suite('isSuggestionUseful', () => {

                test('returns false for empty suggestion', () => {
                        assert.strictEqual(isSuggestionUseful('', 'anything'), false);
                });

                test('returns true when suggestion extends beyond existing text', () => {
                        assert.strictEqual(isSuggestionUseful('fooBar', 'foo'), true);
                });

                test('returns true when suggestion is unrelated to existing text', () => {
                        assert.strictEqual(isSuggestionUseful('xyz', 'foo'), true);
                });

                test('returns false when suggestion equals existing text', () => {
                        assert.strictEqual(isSuggestionUseful('foo', 'foo'), false);
                });

                test('returns false when suggestion is a prefix of existing text', () => {
                        assert.strictEqual(isSuggestionUseful('fo', 'foo'), false);
                });

                test('returns true when existing text is empty', () => {
                        assert.strictEqual(isSuggestionUseful('foo', ''), true);
                });

                test('returns true when suggestion is longer than existing text but matches prefix', () => {
                        // 'foo' + 'bar' vs 'foo' → suggestion extends → useful
                        assert.strictEqual(isSuggestionUseful('foobar', 'foo'), true);
                });
        });

        suite('SuggestionCache', () => {

                test('returns undefined for missing key', () => {
                        const cache = new SuggestionCache();
                        assert.strictEqual(cache.get('missing'), undefined);
                });

                test('stores and retrieves a value', () => {
                        const cache = new SuggestionCache();
                        cache.set('key1', 'suggestion1');
                        assert.strictEqual(cache.get('key1'), 'suggestion1');
                });

                test('overwrites value for existing key', () => {
                        const cache = new SuggestionCache();
                        cache.set('key1', 'old');
                        cache.set('key1', 'new');
                        assert.strictEqual(cache.get('key1'), 'new');
                });

                test('evicts oldest entries when at capacity', () => {
                        const cache = new SuggestionCache();
                        // CACHE_SIZE is 16 — fill it
                        for (let i = 0; i < 16; i++) {
                                cache.set(`key${i}`, `val${i}`);
                        }
                        assert.strictEqual(cache.size, 16);
                        // Add one more — should evict key0
                        cache.set('key16', 'val16');
                        assert.strictEqual(cache.get('key0'), undefined);
                        assert.strictEqual(cache.get('key16'), 'val16');
                        assert.strictEqual(cache.size, 16);
                });

                test('clear() empties the cache', () => {
                        const cache = new SuggestionCache();
                        cache.set('a', '1');
                        cache.set('b', '2');
                        cache.clear();
                        assert.strictEqual(cache.size, 0);
                        assert.strictEqual(cache.get('a'), undefined);
                });

                test('reports correct size', () => {
                        const cache = new SuggestionCache();
                        assert.strictEqual(cache.size, 0);
                        cache.set('a', '1');
                        assert.strictEqual(cache.size, 1);
                        cache.set('b', '2');
                        assert.strictEqual(cache.size, 2);
                        cache.set('a', 'updated'); // overwrite, not insert
                        assert.strictEqual(cache.size, 2);
                });
        });

        suite('extractAddedLinesFromDiff', () => {

                test('extracts a single added line', () => {
                        const diff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 3;
`;
                        const added = extractAddedLinesFromDiff(diff);
                        assert.deepStrictEqual(added, ['const b = 3;']);
                });

                test('extracts multiple added lines', () => {
                        const diff = `@@ -1,2 +1,4 @@
 const a = 1;
+const b = 2;
+const c = 3;
 const d = 4;
`;
                        const added = extractAddedLinesFromDiff(diff);
                        assert.deepStrictEqual(added, ['const b = 2;', 'const c = 3;']);
                });

                test('ignores context lines', () => {
                        const diff = `@@ -1,3 +1,3 @@
 context line 1
+added line
 context line 2
`;
                        const added = extractAddedLinesFromDiff(diff);
                        assert.deepStrictEqual(added, ['added line']);
                });

                test('ignores removed lines', () => {
                        const diff = `@@ -1,2 +1,1 @@
-removed line
 context line
`;
                        const added = extractAddedLinesFromDiff(diff);
                        assert.deepStrictEqual(added, []);
                });

                test('ignores +++ and --- header lines', () => {
                        const diff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,1 +1,1 @@
 context
`;
                        const added = extractAddedLinesFromDiff(diff);
                        assert.deepStrictEqual(added, []);
                });

                test('returns empty array for empty diff', () => {
                        assert.deepStrictEqual(extractAddedLinesFromDiff(''), []);
                });

                test('handles added lines that start with +++ literally (rare but possible)', () => {
                        // A line in the diff body that starts with +++ would be misdetected
                        // as a header — this is an accepted limitation documented in the
                        // helper. Verify the behavior is at least consistent.
                        const diff = `+++ b/file
+normal add
`;
                        const added = extractAddedLinesFromDiff(diff);
                        // The +++ at the start is treated as a header, the +normal add is added
                        assert.deepStrictEqual(added, ['normal add']);
                });
        });

        suite('detectErrorSentinel', () => {

                test('returns the message for a valid ERROR sentinel', () => {
                        assert.strictEqual(
                                detectErrorSentinel('ERROR: model could not parse the request'),
                                'model could not parse the request'
                        );
                });

                test('returns null for a normal diff', () => {
                        assert.strictEqual(detectErrorSentinel('--- a/foo\n+++ b/foo\n@@'), null);
                });

                test('returns null for empty input', () => {
                        assert.strictEqual(detectErrorSentinel(''), null);
                });

                test('trims whitespace around the error message', () => {
                        assert.strictEqual(
                                detectErrorSentinel('  ERROR:   trimmed message   '),
                                'trimmed message'
                        );
                });

                test('does not falsely match ERROR in the middle of a diff', () => {
                        assert.strictEqual(
                                detectErrorSentinel('--- a/foo\n+++ b/foo\n+ERROR: in code'),
                                null
                        );
                });

                test('handles ERROR with no message', () => {
                        assert.strictEqual(detectErrorSentinel('ERROR:'), '');
                });
        });
});
