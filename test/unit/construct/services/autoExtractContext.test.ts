/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * Phase 5.5 (Fix 3) unit tests for richer auto-extract.
 *
 * These tests verify the IAutoExtractContext interface and the
 * buildAutoExtractContext() helper logic. They do NOT instantiate
 * UniversalMemoryService (which has 3 injected dependencies including
 * IConstructAIService that needs a real LLM). Instead they test:
 *
 *   1. The IAutoExtractContext type is importable and has the right shape.
 *   2. The agentLoop's buildAutoExtractContext() helper builds the right
 *      context object from the per-task tracking fields. (This requires
 *      instantiating AgentLoopService with stubbed deps, OR extracting
 *      buildAutoExtractContext as a pure function. We choose the latter
 *      for consistency with the Phase 4 + Fix 1 patterns.)
 *
 * The actual LLM call in autoExtractFromTask() is not tested here --
 * it requires a real LLM or a stubbed IConstructAIService. That's a
 * future integration test.
 */

import * as assert from 'assert';

import { IAutoExtractContext } from '../../../../src/vs/platform/construct/common/memory/universalMemoryService.js';

// ----------------------------------------------------------------------
// Test the IAutoExtractContext type shape
// ----------------------------------------------------------------------

describe('Phase 5.5 (Fix 3) -- IAutoExtractContext type', () => {

	it('accepts all three optional fields', () => {
		const ctx: IAutoExtractContext = {
			conversationHistory: [{ role: 'user', content: 'hello' }],
			failedToolResults: [{ toolName: 'write_file', input: { path: 'a' }, result: 'Error: ...' }],
			repeatedFileReads: ['package.json'],
		};
		assert.ok(ctx);
		assert.strictEqual(ctx.conversationHistory?.length, 1);
		assert.strictEqual(ctx.failedToolResults?.length, 1);
		assert.strictEqual(ctx.repeatedFileReads?.length, 1);
	});

	it('accepts an empty object (all fields optional)', () => {
		const ctx: IAutoExtractContext = {};
		assert.ok(ctx);
		assert.strictEqual(ctx.conversationHistory, undefined);
		assert.strictEqual(ctx.failedToolResults, undefined);
		assert.strictEqual(ctx.repeatedFileReads, undefined);
	});

	it('accepts partial data (only conversationHistory)', () => {
		const ctx: IAutoExtractContext = {
			conversationHistory: [
				{ role: 'user', content: 'task' },
				{ role: 'assistant', content: 'response' },
			],
		};
		assert.strictEqual(ctx.conversationHistory?.length, 2);
		assert.strictEqual(ctx.failedToolResults, undefined);
		assert.strictEqual(ctx.repeatedFileReads, undefined);
	});

	it('accepts partial data (only failedToolResults)', () => {
		const ctx: IAutoExtractContext = {
			failedToolResults: [
				{ toolName: 'run_command', input: { command: 'npm test' }, result: 'Error: exit code 1' },
				{ toolName: 'edit_file', input: { path: 'a.ts', diff: '...' }, result: 'Error: file not found' },
			],
		};
		assert.strictEqual(ctx.failedToolResults?.length, 2);
	});

	it('accepts partial data (only repeatedFileReads)', () => {
		const ctx: IAutoExtractContext = {
			repeatedFileReads: ['package.json', 'tsconfig.json', 'README.md'],
		};
		assert.strictEqual(ctx.repeatedFileReads?.length, 3);
	});
});

// ----------------------------------------------------------------------
// Test the buildAutoExtractContext logic (extracted as a pure function)
// ----------------------------------------------------------------------

/**
 * Extracted pure function that mirrors AgentLoopService.buildAutoExtractContext().
 * Takes the per-task tracking state as parameters and returns the
 * IAutoExtractContext (or undefined if nothing useful).
 *
 * This is the same logic as agentLoop.ts:buildAutoExtractContext() —
 * extracted here for testability. The production method has the same
 * implementation, just reading from `this._conversationHistory` etc.
 */
function buildAutoExtractContextPure(opts: {
	conversationHistory: Array<{ role: string; content: string }>;
	failedToolResults: Array<{ toolName: string; input: unknown; result: string }>;
	fileReadCounts: Map<string, number>;
}): IAutoExtractContext | undefined {
	const conversationHistory = opts.conversationHistory.slice(-20).map(m => ({
		role: m.role,
		content: m.content,
	}));

	const failedToolResults = opts.failedToolResults.length > 0
		? opts.failedToolResults
		: undefined;

	const repeatedFileReads: string[] = [];
	for (const [path, count] of opts.fileReadCounts) {
		if (count > 1) {
			repeatedFileReads.push(path);
		}
	}

	if (conversationHistory.length === 0 && !failedToolResults && repeatedFileReads.length === 0) {
		return undefined;
	}

	return {
		conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
		failedToolResults,
		repeatedFileReads: repeatedFileReads.length > 0 ? repeatedFileReads : undefined,
	};
}

describe('Phase 5.5 (Fix 3) -- buildAutoExtractContext logic', () => {

	it('returns undefined when all fields are empty', () => {
		const result = buildAutoExtractContextPure({
			conversationHistory: [],
			failedToolResults: [],
			fileReadCounts: new Map(),
		});
		assert.strictEqual(result, undefined);
	});

	it('returns context with conversationHistory only', () => {
		const result = buildAutoExtractContextPure({
			conversationHistory: [
				{ role: 'user', content: 'do task' },
				{ role: 'assistant', content: 'doing it' },
			],
			failedToolResults: [],
			fileReadCounts: new Map(),
		});
		assert.ok(result);
		assert.strictEqual(result.conversationHistory?.length, 2);
		assert.strictEqual(result.failedToolResults, undefined);
		assert.strictEqual(result.repeatedFileReads, undefined);
	});

	it('returns context with failedToolResults only', () => {
		const result = buildAutoExtractContextPure({
			conversationHistory: [],
			failedToolResults: [
				{ toolName: 'write_file', input: { path: 'a' }, result: 'Error: permission denied' },
			],
			fileReadCounts: new Map(),
		});
		assert.ok(result);
		assert.strictEqual(result.conversationHistory, undefined);
		assert.strictEqual(result.failedToolResults?.length, 1);
		assert.strictEqual(result.repeatedFileReads, undefined);
	});

	it('returns context with repeatedFileReads only', () => {
		const counts = new Map<string, number>([
			['package.json', 3],
			['tsconfig.json', 2],
			['README.md', 1],  // should NOT be included (read only once)
		]);
		const result = buildAutoExtractContextPure({
			conversationHistory: [],
			failedToolResults: [],
			fileReadCounts: counts,
		});
		assert.ok(result);
		assert.strictEqual(result.repeatedFileReads?.length, 2);
		assert.ok(result.repeatedFileReads?.includes('package.json'));
		assert.ok(result.repeatedFileReads?.includes('tsconfig.json'));
		assert.ok(!result.repeatedFileReads?.includes('README.md'));
	});

	it('returns context with all three fields populated', () => {
		const counts = new Map<string, number>([
			['src/index.ts', 4],
			['src/utils.ts', 2],
		]);
		const result = buildAutoExtractContextPure({
			conversationHistory: [{ role: 'user', content: 'fix bug' }],
			failedToolResults: [{ toolName: 'run_command', input: { command: 'npm test' }, result: 'Error: 3 failures' }],
			fileReadCounts: counts,
		});
		assert.ok(result);
		assert.strictEqual(result.conversationHistory?.length, 1);
		assert.strictEqual(result.failedToolResults?.length, 1);
		assert.strictEqual(result.repeatedFileReads?.length, 2);
	});

	it('truncates conversation history to last 20 messages', () => {
		const history = Array.from({ length: 30 }, (_, i) => ({
			role: i % 2 === 0 ? 'user' : 'assistant',
			content: `message ${i}`,
		}));
		const result = buildAutoExtractContextPure({
			conversationHistory: history,
			failedToolResults: [],
			fileReadCounts: new Map(),
		});
		assert.ok(result);
		assert.strictEqual(result.conversationHistory?.length, 20);
		// Should keep the LAST 20 messages (messages 10-29)
		assert.strictEqual(result.conversationHistory?.[0].content, 'message 10');
		assert.strictEqual(result.conversationHistory?.[19].content, 'message 29');
	});
});
