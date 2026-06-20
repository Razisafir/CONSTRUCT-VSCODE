/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * K2-M4 SecretPatterns — canonical redaction unit tests.
 *
 * NOTE ON TEST FIXTURES: every "secret" below is an obviously-fake
 * placeholder that matches the regex shape but is NOT a valid credential
 * for any provider. We deliberately use repeated sentinel characters
 * (TESTTEST..., XXXX..., 0000...) so that GitHub's secret scanner does
 * not flag the test file, while still exercising the redaction logic.
 */

import * as assert from 'assert';

import {
	redactSecrets,
	SECRET_PATTERNS,
	listSecretPatternNames,
	resetSecretPatterns,
} from '../../../../src/vs/platform/construct/common/security/secretPatterns.js';

suite('K2-M4 SecretPatterns — canonical redaction', () => {

	test('SECRET_PATTERNS is non-empty and every pattern is global', () => {
		assert.ok(SECRET_PATTERNS.length >= 10, 'expected at least 10 canonical patterns');
		for (const sp of SECRET_PATTERNS) {
			assert.ok(sp.pattern.global, `pattern ${sp.name} must have the g flag`);
		}
	});

	test('listSecretPatternNames matches SECRET_PATTERNS', () => {
		const names = listSecretPatternNames();
		assert.strictEqual(names.length, SECRET_PATTERNS.length);
		for (const sp of SECRET_PATTERNS) {
			assert.ok(names.includes(sp.name), `expected ${sp.name} in name list`);
		}
	});

	// ─── Per-pattern fixtures ───────────────────────────────────────────────
	// Each fixture uses a sentinel-shaped placeholder that matches the regex
	// but is obviously not a real credential. The "without" sample asserts
	// no false positives.

	const FIXTURES: Array<{ name: string; with: string; without: string }> = [
		{ name: 'anthropic', with: 'key=sk-ant-TESTTESTTESTTESTTESTTEST', without: 'key=sk-ant-short' },
		{ name: 'openai', with: 'Authorization: sk-proj-TESTTESTTESTTESTTESTTEST', without: 'short sk-abc' },
		{ name: 'nvidia_nim', with: 'nvapi-TESTTESTTESTTESTTESTTESTTEST', without: 'no nvidia key here' },
		{ name: 'groq', with: 'gsk_TESTTESTTESTTESTTESTTEST', without: 'just gsk_ short' },
		{ name: 'google_ai', with: 'AIzaSyATESTTESTTESTTESTTESTTESTTEST', without: 'no google key' },
		{ name: 'github_pat', with: 'ghp_TESTTESTTESTTESTTESTTESTTESTTEST', without: 'no ghp_ here' },
		{ name: 'gitlab_pat', with: 'glpat-TESTTESTTESTTESTTESTTEST', without: 'no glpat here' },
		{ name: 'slack_token', with: 'xoxb-TESTTESTTEST-TESTTESTTEST', without: 'no slack token' },
		{ name: 'authorization_basic', with: 'Authorization: Basic TESTTESTTESTTESTTEST', without: 'Authorization: Bearer short' },
		{ name: 'authorization_bearer', with: 'Bearer TESTTESTTESTTESTTESTTESTTEST.payload.sig', without: 'Bearer short' },
		{ name: 'qs_password', with: 'https://example.com/?password=TESTTESTTEST', without: 'https://example.com/?q=hello' },
		{ name: 'qs_token', with: 'https://example.com/?token=TESTTESTTEST', without: 'https://example.com/?q=hello' },
		{ name: 'qs_key', with: 'https://example.com/?key=TESTTESTTEST', without: 'https://example.com/?q=hello' },
		{ name: 'qs_api_key', with: 'https://example.com/?api_key=TESTTESTTEST', without: 'https://example.com/?q=hello' },
		{ name: 'qs_access_token', with: 'https://example.com/?access_token=TESTTESTTEST', without: 'https://example.com/?q=hello' },
		{ name: 'hex_32plus', with: 'token=00000000000000000000000000000000', without: 'short hex abcd' },
		{ name: 'upper_env_secret', with: 'AWS_SECRET_ACCESS_KEY=TESTTESTTESTTESTTEST', without: 'APP_NAME=kovix' },
	];

	for (const fx of FIXTURES) {
		test(`redacts ${fx.name}`, () => {
			const result = redactSecrets(fx.with);
			assert.ok(
				result.includes(`[REDACTED:${fx.name}]`),
				`expected [REDACTED:${fx.name}] in result, got: ${result}`,
			);
			// The original secret substring must NOT be in the result.
			// (Compare against the part of `fx.with` after the `=` or `:` if present.)
			const secretPart = fx.with.split(/[=:]/).pop()!.trim();
			assert.ok(
				!result.includes(secretPart),
				`original secret "${secretPart}" leaked into result: ${result}`,
			);
		});

		test(`does not false-positive on ${fx.name}`, () => {
			const result = redactSecrets(fx.without);
			assert.ok(
				!result.includes('[REDACTED'),
				`unexpected redaction on benign input "${fx.without}": ${result}`,
			);
		});
	}

	// ─── Edge cases ─────────────────────────────────────────────────────────

	test('redactSecrets handles empty / null / non-string input', () => {
		assert.strictEqual(redactSecrets(''), '');
		assert.strictEqual(redactSecrets(null as unknown as string), null);
		assert.strictEqual(redactSecrets(undefined as unknown as string), undefined);
		assert.strictEqual(redactSecrets(42 as unknown as string), 42);
	});

	test('redactSecrets redacts ALL occurrences, not just the first', () => {
		const input = 'key=sk-ant-TESTTESTTESTTESTTESTTEST and again sk-ant-TESTTESTTESTTESTTESTTEST';
		const result = redactSecrets(input);
		assert.strictEqual(
			(result.match(/\[REDACTED:anthropic\]/g) || []).length,
			2,
			'expected 2 redactions',
		);
	});

	test('redactSecrets is idempotent (redacting a redacted string is a no-op)', () => {
		const input = 'key=sk-ant-TESTTESTTESTTESTTESTTEST';
		const once = redactSecrets(input);
		const twice = redactSecrets(once);
		assert.strictEqual(once, twice);
	});

	test('resetSecretPatterns is safe to call repeatedly', () => {
		assert.doesNotThrow(() => {
			resetSecretPatterns();
			resetSecretPatterns();
		});
	});

	test('multiple distinct secrets in one string are all redacted', () => {
		const input = [
			'anthropic=sk-ant-TESTTESTTESTTESTTESTTEST',
			'nvidia=nvapi-TESTTESTTESTTESTTESTTESTTEST',
			'github=ghp_TESTTESTTESTTESTTESTTESTTESTTEST',
			'slack=xoxb-TESTTESTTEST-TESTTESTTEST',
		].join(' | ');
		const result = redactSecrets(input);
		assert.ok(result.includes('[REDACTED:anthropic]'));
		assert.ok(result.includes('[REDACTED:nvidia_nim]'));
		assert.ok(result.includes('[REDACTED:github_pat]'));
		assert.ok(result.includes('[REDACTED:slack_token]'));
		// None of the raw secret fragments should remain.
		assert.ok(!result.includes('sk-ant-TEST'));
		assert.ok(!result.includes('nvapi-TEST'));
		assert.ok(!result.includes('ghp_TEST'));
		assert.ok(!result.includes('xoxb-TEST'));
	});
});
