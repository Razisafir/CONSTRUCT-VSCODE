"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
suite('Pure Logic Tests', () => {
    suite('Data Type Validation', () => {
        test('should validate string type correctly', () => {
            assert.strictEqual(typeof 'hello', 'string');
            assert.strictEqual(typeof '', 'string');
            assert.strictEqual(typeof String('test'), 'string');
            assert.notStrictEqual(typeof 42, 'string');
            assert.notStrictEqual(typeof null, 'string');
        });
        test('should validate number type correctly', () => {
            assert.strictEqual(typeof 42, 'number');
            assert.strictEqual(typeof 3.14, 'number');
            assert.strictEqual(typeof NaN, 'number');
            assert.strictEqual(typeof Infinity, 'number');
            assert.notStrictEqual(typeof '42', 'number');
            assert.notStrictEqual(typeof undefined, 'number');
        });
        test('should validate boolean type correctly', () => {
            assert.strictEqual(typeof true, 'boolean');
            assert.strictEqual(typeof false, 'boolean');
            assert.notStrictEqual(typeof 1, 'boolean');
            assert.notStrictEqual(typeof 'true', 'boolean');
            assert.notStrictEqual(typeof undefined, 'boolean');
        });
        test('should validate array type correctly', () => {
            assert.strictEqual(Array.isArray([1, 2, 3]), true);
            assert.strictEqual(Array.isArray([]), true);
            assert.strictEqual(Array.isArray(new Array()), true);
            assert.notStrictEqual(Array.isArray({}), true);
            assert.notStrictEqual(Array.isArray('string'), true);
            assert.notStrictEqual(Array.isArray(null), true);
            assert.notStrictEqual(Array.isArray(undefined), true);
        });
        test('should validate object type correctly', () => {
            assert.strictEqual(typeof { key: 'value' }, 'object');
            assert.strictEqual(typeof null, 'object'); // well-known JS quirk
            assert.strictEqual(typeof [1, 2], 'object'); // arrays are objects
            assert.notStrictEqual(typeof function () { }, 'object'); // functions are 'function'
        });
        test('should validate null and undefined correctly', () => {
            assert.strictEqual(null === null, true);
            assert.strictEqual(undefined === undefined, true);
            assert.strictEqual(null === undefined, false);
            assert.strictEqual(null == undefined, true); // loose equality
            assert.strictEqual(typeof null, 'object');
            assert.strictEqual(typeof undefined, 'undefined');
        });
        test('should validate enum values', () => {
            let Color;
            (function (Color) {
                Color[Color["Red"] = 0] = "Red";
                Color[Color["Green"] = 1] = "Green";
                Color[Color["Blue"] = 2] = "Blue";
            })(Color || (Color = {}));
            assert.strictEqual(Color.Red, 0);
            assert.strictEqual(Color.Green, 1);
            assert.strictEqual(Color.Blue, 2);
            assert.strictEqual(Color[0], 'Red');
            assert.strictEqual(Color[1], 'Green');
        });
        test('should validate union types', () => {
            // Simulate union type validation at runtime
            function isStringOrNumber(value) {
                return typeof value === 'string' || typeof value === 'number';
            }
            assert.strictEqual(isStringOrNumber('hello'), true);
            assert.strictEqual(isStringOrNumber(42), true);
            assert.strictEqual(isStringOrNumber(true), false);
            assert.strictEqual(isStringOrNumber(null), false);
            assert.strictEqual(isStringOrNumber(undefined), false);
        });
        test('should handle nested object validation', () => {
            const obj = { user: { name: 'Alice', age: 30 } };
            assert.strictEqual(typeof obj.user, 'object');
            assert.strictEqual(typeof obj.user.name, 'string');
            assert.strictEqual(typeof obj.user.age, 'number');
            assert.strictEqual(obj.user.name, 'Alice');
            assert.strictEqual(obj.user.age, 30);
        });
        test('should reject invalid type coercions', () => {
            // Number() coercions
            assert.ok(isNaN(Number('abc')));
            assert.strictEqual(Number(''), 0);
            assert.strictEqual(Number(true), 1);
            assert.strictEqual(Number(false), 0);
            assert.strictEqual(Number(null), 0);
            assert.ok(isNaN(Number(undefined)));
            // String() coercions
            assert.strictEqual(String(null), 'null');
            assert.strictEqual(String(undefined), 'undefined');
            assert.strictEqual(String([1, 2, 3]), '1,2,3');
        });
    });
    suite('Sort and Filter Operations', () => {
        test('should sort strings alphabetically', () => {
            const arr = ['banana', 'apple', 'cherry', 'date'];
            const sorted = [...arr].sort();
            assert.deepStrictEqual(sorted, ['apple', 'banana', 'cherry', 'date']);
        });
        test('should sort numbers numerically', () => {
            const arr = [10, 1, 5, 3, 8];
            const sorted = [...arr].sort((a, b) => a - b);
            assert.deepStrictEqual(sorted, [1, 3, 5, 8, 10]);
            // Verify default sort is NOT numeric
            const defaultSorted = [...arr].sort();
            assert.deepStrictEqual(defaultSorted, [1, 10, 3, 5, 8], 'Default sort is lexicographic');
        });
        test('should sort by custom comparator', () => {
            const arr = [{ name: 'Bob', age: 30 }, { name: 'Alice', age: 25 }, { name: 'Charlie', age: 35 }];
            const byAge = [...arr].sort((a, b) => a.age - b.age);
            assert.strictEqual(byAge[0].name, 'Alice');
            assert.strictEqual(byAge[1].name, 'Bob');
            assert.strictEqual(byAge[2].name, 'Charlie');
            const byName = [...arr].sort((a, b) => a.name.localeCompare(b.name));
            assert.strictEqual(byName[0].name, 'Alice');
            assert.strictEqual(byName[1].name, 'Bob');
            assert.strictEqual(byName[2].name, 'Charlie');
        });
        test('should filter by predicate correctly', () => {
            const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const evens = arr.filter(n => n % 2 === 0);
            assert.deepStrictEqual(evens, [2, 4, 6, 8, 10]);
            const gt5 = arr.filter(n => n > 5);
            assert.deepStrictEqual(gt5, [6, 7, 8, 9, 10]);
        });
        test('should handle empty array operations', () => {
            const empty = [];
            assert.deepStrictEqual(empty.sort(), []);
            assert.deepStrictEqual(empty.filter(() => true), []);
            assert.deepStrictEqual([...new Set(empty)], []);
            assert.strictEqual(empty.length, 0);
        });
        test('should deduplicate array elements', () => {
            const arr = [1, 2, 3, 2, 1, 4, 3, 5];
            const deduped = Array.from(new Set(arr));
            assert.deepStrictEqual(deduped, [1, 2, 3, 4, 5]);
            const strings = ['a', 'b', 'a', 'c', 'b'];
            const dedupedStrings = Array.from(new Set(strings));
            assert.deepStrictEqual(dedupedStrings, ['a', 'b', 'c']);
        });
        test('should handle stable sort', () => {
            // ES2019+ guarantees stable sort
            const arr = [
                { key: 'a', value: 1 },
                { key: 'b', value: 1 },
                { key: 'c', value: 1 },
                { key: 'd', value: 2 },
                { key: 'e', value: 2 },
            ];
            const sorted = [...arr].sort((a, b) => a.value - b.value);
            // Elements with same value should maintain original order
            assert.strictEqual(sorted[0].key, 'a');
            assert.strictEqual(sorted[1].key, 'b');
            assert.strictEqual(sorted[2].key, 'c');
            assert.strictEqual(sorted[3].key, 'd');
            assert.strictEqual(sorted[4].key, 'e');
        });
        test('should filter null and undefined from arrays', () => {
            const arr = [1, null, 2, undefined, 3, null, 4];
            const filtered = arr.filter((x) => x !== null && x !== undefined);
            assert.deepStrictEqual(filtered, [1, 2, 3, 4]);
            // Using Boolean as filter (removes falsy values)
            const arr2 = [0, 1, '', 'hello', null, undefined, false, true];
            const truthy = arr2.filter(Boolean);
            assert.deepStrictEqual(truthy, [1, 'hello', true]);
        });
        test('should sort with locale-aware comparison', () => {
            const arr = ['café', 'apple', 'Zebra', 'banana'];
            const sorted = [...arr].sort((a, b) => a.localeCompare(b));
            // localeCompare produces a deterministic total order
            assert.strictEqual(sorted.length, arr.length, 'All elements present after sort');
            assert.ok(sorted.includes('café'), 'Accented word is preserved');
            // Verify that case-insensitive sorting produces expected order
            const caseInsensitive = [...arr].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
            assert.strictEqual(caseInsensitive[0], 'apple', 'apple comes first in case-insensitive sort');
            assert.ok(caseInsensitive.length === arr.length, 'All elements present after case-insensitive sort');
            // Verify localeCompare distinguishes accented vs non-accented
            assert.notStrictEqual('café'.localeCompare('cafe'), 0, 'localeCompare should distinguish café from cafe');
        });
        test('should handle large array operations efficiently', () => {
            const large = Array.from({ length: 10000 }, (_, i) => i);
            const filtered = large.filter(n => n % 2 === 0);
            assert.strictEqual(filtered.length, 5000, 'Half should be even');
            const sorted = [...large].reverse().sort((a, b) => a - b);
            assert.strictEqual(sorted[0], 0, 'First element should be 0');
            assert.strictEqual(sorted[9999], 9999, 'Last element should be 9999');
            const deduped = Array.from(new Set([...large, ...large]));
            assert.strictEqual(deduped.length, 10000, 'Deduplication should produce same length');
        });
    });
    suite('Token Counting', () => {
        // Simple token estimation: roughly chars/4 or whitespace split
        function estimateTokensCharDiv4(text) {
            return Math.ceil(text.length / 4);
        }
        function estimateTokensWhitespace(text) {
            if (!text.trim()) {
                return 0;
            }
            return text.split(/\s+/).length;
        }
        function estimateTokensHybrid(text) {
            // Average of char/4 and word count
            const charBased = Math.ceil(text.length / 4);
            const wordBased = text.trim() ? text.split(/\s+/).length : 0;
            return Math.ceil((charBased + wordBased) / 2);
        }
        test('should count tokens for simple text', () => {
            const text = 'Hello world this is a test';
            const charTokens = estimateTokensCharDiv4(text);
            const wordTokens = estimateTokensWhitespace(text);
            assert.ok(charTokens > 0, 'Char-based estimate should be positive');
            assert.strictEqual(wordTokens, 6, 'Whitespace split should count 6 words');
            assert.ok(charTokens >= wordTokens, 'Char-based estimate is typically >= word count');
        });
        test('should count tokens for code snippets', () => {
            const code = 'function add(a: number, b: number): number { return a + b; }';
            const wordTokens = estimateTokensWhitespace(code);
            assert.ok(wordTokens > 0, 'Code should have positive token count');
            // Code tokens via char/4 should account for symbols
            const charTokens = estimateTokensCharDiv4(code);
            assert.ok(charTokens > 10, 'Code char estimate should be > 10');
        });
        test('should handle empty string', () => {
            assert.strictEqual(estimateTokensCharDiv4(''), 0);
            assert.strictEqual(estimateTokensWhitespace(''), 0);
            assert.strictEqual(estimateTokensHybrid(''), 0);
        });
        test('should handle multi-line content', () => {
            const text = 'Line 1\nLine 2\nLine 3\nLine 4';
            const wordTokens = estimateTokensWhitespace(text);
            assert.strictEqual(wordTokens, 8, '4 lines × 2 words each = 8');
            const charTokens = estimateTokensCharDiv4(text);
            assert.ok(charTokens > 0, 'Char-based should be positive');
        });
        test('should estimate token count within tolerance', () => {
            // For a known text, both methods should give reasonable bounds
            const text = 'The quick brown fox jumps over the lazy dog';
            const charTokens = estimateTokensCharDiv4(text);
            const wordTokens = estimateTokensWhitespace(text);
            // The text has 9 words and ~44 chars (11 tokens by char/4)
            assert.ok(wordTokens >= 8 && wordTokens <= 10, 'Word count should be ~9');
            assert.ok(charTokens >= 9 && charTokens <= 15, 'Char estimate should be in reasonable range');
        });
        test('should count tokens for markdown', () => {
            const md = '# Header\n\n- Item 1\n- Item 2\n\n**Bold text** _italic_';
            const wordTokens = estimateTokensWhitespace(md);
            assert.ok(wordTokens > 0, 'Markdown should have positive token count');
            const charTokens = estimateTokensCharDiv4(md);
            assert.ok(charTokens > wordTokens, 'Char-based estimate typically > word count for short tokens');
        });
        test('should handle unicode content', () => {
            const unicode = '你好世界 こんにちは 안녕하세요';
            const charTokens = estimateTokensCharDiv4(unicode);
            assert.ok(charTokens > 0, 'Unicode content should have positive char-based estimate');
            const wordTokens = estimateTokensWhitespace(unicode);
            assert.ok(wordTokens >= 3, 'At least 3 words in unicode text');
        });
        test('should count tokens for mixed language content', () => {
            const mixed = 'Hello 世界 and こんにちは world';
            const wordTokens = estimateTokensWhitespace(mixed);
            assert.ok(wordTokens >= 3, 'Mixed language should have multiple tokens');
            const charTokens = estimateTokensCharDiv4(mixed);
            assert.ok(charTokens > 0, 'Char estimate should be positive');
            // Hybrid should be between the two
            const hybrid = estimateTokensHybrid(mixed);
            assert.ok(hybrid > 0, 'Hybrid estimate should be positive');
            assert.ok(hybrid >= Math.min(charTokens, wordTokens), 'Hybrid should be >= min of both');
        });
    });
    suite('Diff Parsing', () => {
        function parseDiff(diffText) {
            const lines = diffText.split('\n');
            return lines.map(line => {
                if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')
                    || line.startsWith('new file mode') || line.startsWith('deleted file mode')) {
                    return { type: 'header', content: line };
                }
                if (line.startsWith('@@')) {
                    return { type: 'header', content: line };
                }
                if (line.startsWith('+')) {
                    return { type: 'add', content: line.substring(1) };
                }
                if (line.startsWith('-')) {
                    return { type: 'remove', content: line.substring(1) };
                }
                return { type: 'context', content: line };
            });
        }
        test('should parse unified diff format', () => {
            const diff = `diff --git a/file.txt b/file.txt
index abc1234..def5678 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2modified
+line3
 line4`;
            const parsed = parseDiff(diff);
            assert.ok(parsed.length > 0, 'Should parse some lines');
            const headers = parsed.filter(l => l.type === 'header');
            assert.ok(headers.length >= 2, 'Should have header lines');
            assert.ok(headers.some(h => h.content.startsWith('diff --git')), 'Should find diff header');
            assert.ok(headers.some(h => h.content.startsWith('@@')), 'Should find hunk header');
        });
        test('should identify added lines', () => {
            const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,3 @@
 line1
 line2
+added line`;
            const parsed = parseDiff(diff);
            const added = parsed.filter(l => l.type === 'add');
            assert.strictEqual(added.length, 1, 'Should find one added line');
            assert.strictEqual(added[0].content, 'added line', 'Added content should match');
        });
        test('should identify removed lines', () => {
            const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,2 @@
 line1
-removed line
 line3`;
            const parsed = parseDiff(diff);
            const removed = parsed.filter(l => l.type === 'remove');
            assert.strictEqual(removed.length, 1, 'Should find one removed line');
            assert.strictEqual(removed[0].content, 'removed line', 'Removed content should match');
        });
        test('should identify unchanged lines', () => {
            const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 unchanged1
-changed
+modified
 unchanged2`;
            const parsed = parseDiff(diff);
            const context = parsed.filter(l => l.type === 'context');
            assert.ok(context.length >= 2, 'Should find context lines');
            assert.ok(context.some(l => l.content.includes('unchanged1')), 'First unchanged line present');
            assert.ok(context.some(l => l.content.includes('unchanged2')), 'Second unchanged line present');
        });
        test('should parse multi-file diffs', () => {
            const diff = `diff --git a/file1.txt b/file1.txt
--- a/file1.txt
+++ b/file1.txt
@@ -1,1 +1,1 @@
-old1
+new1
diff --git a/file2.txt b/file2.txt
--- a/file2.txt
+++ b/file2.txt
@@ -1,1 +1,1 @@
-old2
+new2`;
            const parsed = parseDiff(diff);
            const diffHeaders = parsed.filter(l => l.type === 'header' && l.content.startsWith('diff --git'));
            assert.strictEqual(diffHeaders.length, 2, 'Should find 2 file diff headers');
            const added = parsed.filter(l => l.type === 'add');
            assert.strictEqual(added.length, 2, 'Should find 2 added lines');
            assert.strictEqual(added[0].content, 'new1');
            assert.strictEqual(added[1].content, 'new2');
        });
        test('should handle empty diff', () => {
            const diff = '';
            const parsed = parseDiff(diff);
            assert.strictEqual(parsed.length, 1, 'Empty diff produces one empty context line');
            assert.strictEqual(parsed[0].type, 'context', 'Empty line is context');
        });
        test('should parse diff with new file', () => {
            const diff = `diff --git a/newfile.txt b/newfile.txt
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+line1
+line2`;
            const parsed = parseDiff(diff);
            const added = parsed.filter(l => l.type === 'add');
            assert.strictEqual(added.length, 2, 'New file should have 2 added lines');
            const headers = parsed.filter(l => l.type === 'header');
            assert.ok(headers.some(h => h.content.includes('new file mode')), 'Should have new file mode header');
            assert.ok(headers.some(h => h.content.includes('/dev/null')), 'Should have /dev/null as old file');
        });
        test('should parse diff with deleted file', () => {
            const diff = `diff --git a/oldfile.txt b/oldfile.txt
deleted file mode 100644
index abc1234..0000000
--- a/oldfile.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2`;
            const parsed = parseDiff(diff);
            const removed = parsed.filter(l => l.type === 'remove');
            assert.strictEqual(removed.length, 2, 'Deleted file should have 2 removed lines');
            const headers = parsed.filter(l => l.type === 'header');
            assert.ok(headers.some(h => h.content.includes('deleted file mode')), 'Should have deleted file mode header');
            assert.ok(headers.some(h => h.content.includes('/dev/null')), 'Should have /dev/null as new file');
        });
    });
});
//# sourceMappingURL=pureLogic.test.js.map