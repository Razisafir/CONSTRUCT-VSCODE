// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SEC-5 / K2-M4: Canonical secret-pattern registry.
 *
 * Single source of truth for every secret-redaction pattern in Kovix.
 * Both `promptSanitiser.ts` (agentLoop path) and `secretRedactor.ts`
 * (tool-registry / Ponytail path) MUST import from this module — closing
 * the K2-M4 audit finding that the two paths could drift.
 *
 * Patterns are ordered roughly longest-match-first to minimise partial
 * redactions (e.g. we want `Authorization: Basic dXNlcjpwYXNz` to be
 * caught by the `Authorization: Basic` rule before the bare `Bearer` rule
 * could fire on a substring).
 *
 * Every pattern is GLOBAL (the `g` flag) so `String.replace` redacts all
 * occurrences in one pass. Callers that re-use the regex object MUST reset
 * `lastIndex = 0` between calls (the `redactSecrets()` helper does this).
 */

export interface SecretPattern {
	/** Human-readable name for telemetry / audit logs. */
	name: string;
	/** Global regex. MUST include the `g` flag. */
	pattern: RegExp;
	/** Optional description for the audit docs. */
	description?: string;
}

/**
 * The canonical list of secret patterns. Adding a new pattern here
 * automatically updates both `promptSanitiser` and `secretRedactor`.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
	// ─── Cloud provider API keys ────────────────────────────────────────────
	{
		name: 'anthropic',
		pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
		description: 'Anthropic Claude API key',
	},
	{
		name: 'openai',
		pattern: /sk-[A-Za-z0-9]{20,}/g,
		description: 'OpenAI API key (covers sk-proj-, sk-svcacct-, etc.)',
	},
	{
		name: 'nvidia_nim',
		pattern: /nvapi-[A-Za-z0-9_-]{20,}/g,
		description: 'NVIDIA NIM API key (used by the 5 Kovix agent personas)',
	},
	{
		name: 'groq',
		pattern: /gsk_[A-Za-z0-9]{20,}/g,
		description: 'Groq API key',
	},
	{
		name: 'google_ai',
		pattern: /AIza[0-9A-Za-z_-]{35,}/g,
		description: 'Google AI Studio API key',
	},

	// ─── Source-control tokens ──────────────────────────────────────────────
	{
		name: 'github_pat',
		pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,
		description: 'GitHub PAT (ghp_/gho_/ghs_/ghu_/ghr_) — v1.5.0 SEC-7 L3',
	},
	{
		name: 'github_legacy_token',
		pattern: /\bghp_[A-Za-z0-9]{36}\b/g,
		description: 'GitHub classic PAT (kept for backward-compat with logs)',
	},
	{
		name: 'gitlab_pat',
		pattern: /glpat-[A-Za-z0-9_-]{20,}/g,
		description: 'GitLab PAT — v1.5.0 SEC-7 L3',
	},

	// ─── Chat / collaboration tokens ────────────────────────────────────────
	{
		name: 'slack_token',
		pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g,
		description: 'Slack token (bot, user, app, refresh, etc.) — v1.5.0 SEC-7 L3',
	},

	// ─── HTTP auth headers ──────────────────────────────────────────────────
	{
		name: 'authorization_basic',
		pattern: /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{16,}/gi,
		description: 'HTTP Basic auth header — v1.5.0 SEC-7 L3',
	},
	{
		name: 'authorization_bearer',
		pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/g,
		description: 'HTTP Bearer token',
	},

	// ─── Query-string credentials (logs / URLs) ────────────────────────────
	{
		name: 'qs_password',
		pattern: /[?&]password=\S+/gi,
		description: 'password= query parameter',
	},
	{
		name: 'qs_token',
		pattern: /[?&]token=\S+/gi,
		description: 'token= query parameter',
	},
	{
		name: 'qs_key',
		pattern: /[?&]key=\S+/gi,
		description: 'key= query parameter',
	},
	{
		name: 'qs_api_key',
		pattern: /[?&]api_key=\S+/gi,
		description: 'api_key= query parameter',
	},
	{
		name: 'qs_access_token',
		pattern: /[?&]access_token=\S+/gi,
		description: 'access_token= query parameter',
	},

	// ─── Generic high-entropy strings (last-resort heuristic) ──────────────
	// 32+ contiguous hex chars — covers MD5 (32), SHA-1 prefixes, Git SHAs
	// that leaked into logs as "token", etc. NOT a tight match — relies on
	// the surrounding context (env var name, log prefix) for relevance.
	{
		name: 'hex_32plus',
		pattern: /\b[0-9a-fA-F]{32,}\b/g,
		description: '32+ hex chars (MD5/SHA prefix, opaque token) — v1.5.0 SEC-7 L3',
	},

	// ─── UPPER_CASE env-style name=value (e.g. AWS_SECRET_ACCESS_KEY=...) ──
	// Matches MUST be anchored to a word boundary on the left and `=` on the
	// right; the value side is `\S+` to catch everything up to whitespace.
	{
		name: 'upper_env_secret',
		pattern: /\b[A-Z][A-Z0-9_]{6,}(?:SECRET|TOKEN|KEY|PASSWORD|PASS|CRED|CREDENTIALS)[A-Z0-9_]*=\S+/g,
		description: 'UPPER_CASE env var holding a secret — v1.5.0 SEC-7 L3',
	},
];

/**
 * Reset every pattern's lastIndex to 0. Required before re-using a global
 * regex across calls (otherwise `String.replace` with `/g` skips matches
 * after the first call when the regex object is reused).
 */
export function resetSecretPatterns(): void {
	for (const sp of SECRET_PATTERNS) {
		sp.pattern.lastIndex = 0;
	}
}

/**
 * Canonical secret-redaction function. Import this from anywhere that
 * logs strings containing potentially-sensitive data.
 *
 * @example
 *   this.logService.info(redactSecrets(`Calling NVIDIA with key ${apiKey}`));
 *   // → "Calling NVIDIA with key [REDACTED:nvidia_nim]"
 *
 * @param input The string to redact.
 * @returns The redacted string. If input is falsy or non-string, returned as-is.
 */
export function redactSecrets(input: string): string {
	if (!input || typeof input !== 'string') {
		return input;
	}

	resetSecretPatterns();
	let result = input;
	for (const sp of SECRET_PATTERNS) {
		result = result.replace(sp.pattern, `[REDACTED:${sp.name}]`);
	}
	return result;
}

/**
 * Return the list of pattern names (for telemetry / test assertions).
 */
export function listSecretPatternNames(): string[] {
	return SECRET_PATTERNS.map(sp => sp.name);
}
