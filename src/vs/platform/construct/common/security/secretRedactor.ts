// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SEC-5: Secret redaction utility.
 *
 * API keys must never appear in any log file, IPC message, or audit trail.
 * This module provides a redactSecrets() function that scrubs known secret
 * patterns from any string before logging.
 *
 * Patterns covered:
 * - Anthropic keys: sk-ant-...
 * - OpenAI keys: sk-...
 * - Google AI keys: AIza...
 * - GitHub PATs: ghp_..., github_pat_..., gho_..., ghs_..., ghu_..., ghr_...
 * - AWS access keys: AKIA..., secret access keys (40-char base64)
 * - Azure keys: long hex strings in connection strings
 * - Bearer tokens: Bearer ...
 * - Generic password/token/key/secret query parameters and JSON fields
 * - Slack tokens: xoxb-..., xoxp-...
 * - Stripe keys: sk_live_..., sk_test_..., pk_live_..., pk_test_...
 * - JWTs: three base64 segments separated by dots
 * - Private key blocks: -----BEGIN ... PRIVATE KEY-----
 * - Connection string passwords: mongodb://user:pass@host, postgres://...
 */

/**
 * Secret patterns to redact from any string before logging.
 * Each pattern is applied globally (all occurrences replaced).
 *
 * F-007 fix: expanded from 6 patterns to 18 to cover the providers Kovix
 * actually supports (Anthropic, OpenAI, Google, GitHub, AWS, Azure, Slack,
 * Stripe) plus generic JWTs, PEM blocks, and connection-string credentials.
 */
export const SECRET_PATTERNS: RegExp[] = [
        // Cloud provider API keys
        /sk-ant-[A-Za-z0-9_-]{20,}/g,                  // Anthropic
        /sk-[A-Za-z0-9]{20,}/g,                         // OpenAI (keep after sk-ant- so the ant pattern wins)
        /AIza[A-Za-z0-9_-]{35,}/g,                      // Google AI / Firebase
        /gh[psoru]_[A-Za-z0-9]{36,}/g,                  // GitHub PAT (ghp_, ghs_, gho_, ghu_, ghr_)
        /github_pat_[A-Za-z0-9_]{20,}/g,                // GitHub fine-grained PAT
        /AKIA[0-9A-Z]{16,}/g,                            // AWS access key id
        /[0-9a-zA-Z/+]{40}(?![0-9a-zA-Z/+])/g,          // AWS secret access key (40-char base64) — heuristic
        /xox[bp]-[A-Za-z0-9-]{20,}/g,                   // Slack bot/user tokens
        /sk_(?:live|test)_[A-Za-z0-9]{20,}/g,           // Stripe secret keys
        /pk_(?:live|test)_[A-Za-z0-9]{20,}/g,           // Stripe publishable keys (treat as sensitive)

        // Auth headers
        /Bearer [A-Za-z0-9_.-]{20,}/g,                  // Bearer tokens

        // PEM private key blocks (multi-line)
        /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,

        // JWTs (three base64url segments separated by dots, middle segment ≥ 16 chars)
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,}\b/g,

        // Query parameter credentials
        /password=\S+/gi,
        /token=\S+/gi,
        /key=\S+/gi,
        /secret=\S+/gi,
        /passcode=\S+/gi,
        /api[_-]?key=\S+/gi,

        // Connection-string credentials: scheme://user:pass@host
        /([a-z][a-z0-9+\-.]*:\/\/[^:/@\s]+:)[^@\s]+(@)/gi,

        // JSON field credentials (basic — catches "api_key":"...", "password":"...", etc.)
        /"(?:api[_-]?key|password|passwd|secret|token|access[_-]?token|refresh[_-]?token)"\s*:\s*"[^"]+"/gi,
];

/**
 * SEC-5: Redact known secret patterns from a string.
 * Replace all occurrences of known secret patterns with [REDACTED].
 *
 * This MUST be applied to ALL logger calls in construct code.
 * Usage:
 *   this.logService.info(redactSecrets(`Processing: ${someData}`));
 *   console.log(redactSecrets(output));
 *
 * F-007 fix: now covers 18 patterns (was 6). Adds Google, GitHub, AWS, Slack,
 * Stripe, JWT, PEM, connection-string, and JSON field patterns.
 *
 * @param input The string to redact.
 * @returns The redacted string with secrets replaced by [REDACTED].
 */
export function redactSecrets(input: string): string {
        if (!input || typeof input !== 'string') {
                return input;
        }

        let result = input;
        for (const pattern of SECRET_PATTERNS) {
                // Reset lastIndex for global regex reuse
                pattern.lastIndex = 0;
                if (pattern.source.startsWith('(')) {
                        // Capturing-group patterns (e.g. connection strings): preserve the non-secret parts.
                        result = result.replace(pattern, '$1[REDACTED]$2');
                } else if (pattern.source.startsWith('"')) {
                        // JSON field patterns: preserve the field name, redact only the value.
                        result = result.replace(pattern, (match) => {
                                const eqIdx = match.indexOf(':');
                                if (eqIdx < 0) { return '[REDACTED]'; }
                                return match.slice(0, eqIdx + 1) + ' "[REDACTED]"';
                        });
                } else {
                        result = result.replace(pattern, '[REDACTED]');
                }
        }
        return result;
}
