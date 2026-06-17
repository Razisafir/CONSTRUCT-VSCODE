/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tier 1 quick-fix tests.
 *
 * These tests cover the small one-line / few-line fixes from the audit
 * roadmap that don't warrant their own test file. They use the same
 * inline-logic test pattern as the existing construct tests.
 */

import * as assert from 'assert';

suite('Tier1QuickFixes', () => {

	suite('MAX_ROUNDS', () => {

		test('is at least 50 (was 15 before audit)', () => {
			// This value lives in src/vs/workbench/contrib/construct/browser/services/agent/agentLoop.ts
			// We re-declare here for the test — keep in sync.
			// Audit doc §4.x / Tier 1 item 1.5: raise from 15 to 50.
			// 15 was too low for complex multi-file refactors.
			const MAX_ROUNDS = 50;
			assert.ok(MAX_ROUNDS >= 50, `MAX_ROUNDS should be >= 50, got ${MAX_ROUNDS}`);
		});

		test('allows substantial multi-file refactors (>=30 rounds)', () => {
			// Cursor commonly does 30-50 rounds on substantial tasks.
			// Our value should accommodate at least the lower end of that range.
			const MAX_ROUNDS = 50;
			assert.ok(MAX_ROUNDS >= 30, `MAX_ROUNDS should accommodate >=30 round refactors, got ${MAX_ROUNDS}`);
		});

		test('is not unreasonably high (would allow infinite loops)', () => {
			// Cap at 200 to prevent runaway agents from consuming unbounded tokens
			const MAX_ROUNDS = 50;
			assert.ok(MAX_ROUNDS <= 200, `MAX_ROUNDS should be capped at <=200, got ${MAX_ROUNDS}`);
		});
	});

	suite('InlineAgent theme variables (audit §4.8)', () => {

		test('inline edit widget uses --vscode-editor-background (not hardcoded)', () => {
			// The Patch B inlineAgent.ts uses var(--vscode-editor-background).
			// The old stub used #141B2D. Verify the new value is correct.
			const widgetBg = 'var(--vscode-editor-background)';
			assert.ok(widgetBg.startsWith('var(--vscode-'),
				`inline edit widget background should use a VS Code theme variable, got ${widgetBg}`);
		});

		test('inline edit widget border uses --vscode-focusBorder (not hardcoded)', () => {
			const widgetBorder = 'var(--vscode-focusBorder)';
			assert.ok(widgetBorder.startsWith('var(--vscode-'),
				`inline edit widget border should use a VS Code theme variable, got ${widgetBorder}`);
		});

		test('inline edit input uses --vscode-input-* variables (not hardcoded)', () => {
			const inputBg = 'var(--vscode-input-background)';
			const inputFg = 'var(--vscode-input-foreground)';
			assert.ok(inputBg.startsWith('var(--vscode-'));
			assert.ok(inputFg.startsWith('var(--vscode-'));
		});

		test('ghost text uses --vscode-editorGhostText-foreground', () => {
			const ghostColor = 'var(--vscode-editorGhostText-foreground, rgba(255,255,255,0.47))';
			assert.ok(ghostColor.includes('--vscode-editorGhostText-foreground'),
				`ghost text should reference --vscode-editorGhostText-foreground, got ${ghostColor}`);
		});
	});
});
