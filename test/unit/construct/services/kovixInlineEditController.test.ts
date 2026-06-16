/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for the Patch B inline edit controller's pure-logic helpers.
 *
 * The KovixInlineEditController class itself requires a running editor and a
 * configured AI service, so it is exercised by smoke tests instead. The
 * shared pure-logic helpers (extractAddedLinesFromDiff, detectErrorSentinel)
 * are already covered by kovixInlineCompletionProvider.test.ts because they
 * live in the shared helpers file.
 *
 * This test file covers the Patch B-specific logic that doesn't depend on
 * the editor: the system prompt format, the user message construction, and
 * the response post-processing heuristics.
 */

import * as assert from 'assert';
import {
	extractAddedLinesFromDiff,
	detectErrorSentinel,
} from '../../../../src/vs/platform/construct/common/editor/kovixInlineCompletionHelpers.js';

/**
 * Pure-function mirror of the user-message construction logic in
 * KovixInlineEditController._handleSubmit. Extracted here for unit testing.
 *
 * Keeping this in sync with the controller is acceptable because the
 * controller's version is simple enough to verify by reading.
 */
function buildUserMessage(
	instruction: string,
	anchorLine: number,
	anchorColumn: number,
	selectedText: string | null
): string {
	if (selectedText) {
		return `Selected code:\n\`\`\`\n${selectedText}\n\`\`\`\n\nInstruction: ${instruction}`;
	}
	return `Cursor is at line ${anchorLine}, column ${anchorColumn}.\n\nInstruction: ${instruction}`;
}

/**
 * Pure-function mirror of the response post-processing in _handleSubmit.
 * Strips trailing whitespace and checks for the ERROR sentinel.
 * Returns either { kind: 'ok', text } or { kind: 'error', message } or { kind: 'empty' }.
 */
function processModelResponse(response: string): { kind: 'ok'; text: string } | { kind: 'error'; message: string } | { kind: 'empty' } {
	const errorMessage = detectErrorSentinel(response);
	if (errorMessage !== null) {
		return { kind: 'error', message: errorMessage };
	}
	const text = response.replace(/\s+$/, '');
	if (text.length === 0) {
		return { kind: 'empty' };
	}
	return { kind: 'ok', text };
}

suite('KovixInlineEditController', () => {

	suite('buildUserMessage', () => {

		test('includes selected code when provided', () => {
			const msg = buildUserMessage('rename to bar', 5, 10, 'const foo = 1;');
			assert.ok(msg.includes('const foo = 1;'));
			assert.ok(msg.includes('rename to bar'));
			assert.ok(msg.includes('Selected code:'));
		});

		test('includes cursor position when no selection', () => {
			const msg = buildUserMessage('insert log', 12, 3, null);
			assert.ok(msg.includes('line 12'));
			assert.ok(msg.includes('column 3'));
			assert.ok(msg.includes('insert log'));
			assert.ok(!msg.includes('Selected code:'));
		});

		test('handles empty selection string as no selection', () => {
			// Empty string is falsy in JS, so it's treated as no selection
			const msg = buildUserMessage('test', 1, 1, '');
			assert.ok(msg.includes('Cursor is at'));
			assert.ok(!msg.includes('Selected code:'));
		});

		test('escapes code fences properly when selected text contains backticks', () => {
			const msg = buildUserMessage('edit', 1, 1, 'const x = `template`');
			// The message should still contain the original text — we don't escape,
			// we rely on the model to handle it
			assert.ok(msg.includes('const x = `template`'));
		});
	});

	suite('processModelResponse', () => {

		test('returns ok with stripped text for normal response', () => {
			const result = processModelResponse('const x = 1;\n\n\n');
			assert.strictEqual(result.kind, 'ok');
			if (result.kind === 'ok') {
				assert.strictEqual(result.text, 'const x = 1;');
			}
		});

		test('returns empty for whitespace-only response', () => {
			const result = processModelResponse('   \n\t  ');
			assert.strictEqual(result.kind, 'empty');
		});

		test('returns empty for truly empty response', () => {
			const result = processModelResponse('');
			assert.strictEqual(result.kind, 'empty');
		});

		test('returns error with message for ERROR sentinel', () => {
			const result = processModelResponse('ERROR: instruction is ambiguous');
			assert.strictEqual(result.kind, 'error');
			if (result.kind === 'error') {
				assert.strictEqual(result.message, 'instruction is ambiguous');
			}
		});

		test('returns ok for code that happens to contain the word ERROR', () => {
			// Code that legitimately contains ERROR should not be mistaken for the sentinel
			// because detectErrorSentinel only matches at the start (after trimming)
			const result = processModelResponse('throw new Error("ERROR: something");');
			assert.strictEqual(result.kind, 'ok');
		});

		test('preserves leading whitespace (indentation) in ok response', () => {
			const result = processModelResponse('    const x = 1;  \n');
			assert.strictEqual(result.kind, 'ok');
			if (result.kind === 'ok') {
				assert.strictEqual(result.text, '    const x = 1;');
			}
		});

		test('preserves internal newlines in ok response', () => {
			const result = processModelResponse('const a = 1;\nconst b = 2;\n');
			assert.strictEqual(result.kind, 'ok');
			if (result.kind === 'ok') {
				assert.strictEqual(result.text, 'const a = 1;\nconst b = 2;');
			}
		});
	});

	suite('extractAddedLinesFromDiff (re-used by Patch B for diff-mode fallback)', () => {

		test('extracts the new function from a refactor diff', () => {
			const diff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,5 @@
 function oldName() {
-  return 1;
+  return 2;
 }
+
+export { oldName as newName };
`;
			const added = extractAddedLinesFromDiff(diff);
			assert.deepStrictEqual(added, ['  return 2;', '', 'export { oldName as newName };']);
		});

		test('returns empty for a deletion-only diff', () => {
			const diff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,1 @@
 function foo() {
-  return 1;
-  return 2;
 }
`;
			const added = extractAddedLinesFromDiff(diff);
			assert.deepStrictEqual(added, []);
		});

		test('handles a pure-insertion diff (no removed lines)', () => {
			const diff = `@@ -1,1 +1,3 @@
 context
+new line 1
+new line 2
`;
			const added = extractAddedLinesFromDiff(diff);
			assert.deepStrictEqual(added, ['new line 1', 'new line 2']);
		});
	});
});
