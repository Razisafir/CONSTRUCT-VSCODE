// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SEC-5 / K2-M4: Secret redaction utility (tool-registry / Ponytail path).
 *
 * This module is the BACKWARD-COMPAT shim. The canonical implementation
 * now lives in `secretPatterns.ts` (single source of truth shared with
 * `promptSanitiser.ts`). Existing imports of `redactSecrets` or
 * `SECRET_PATTERNS` from this file continue to work; new code should
 * import directly from `secretPatterns.ts`.
 *
 * Closes K2-M4: the SEC-7 L3 pattern set (nvapi-, gsk_, ghp_/gho_/ghs_,
 * glpat-, xox*, Authorization: Basic, UPPER_CASE env names, 32+ hex)
 * was previously only in the agentLoop-side sanitiser; the tool-registry
 * path silently redacted fewer secrets. Both paths now share one module.
 */

export {
	SECRET_PATTERNS,
	redactSecrets,
	resetSecretPatterns,
	listSecretPatternNames,
	type SecretPattern,
} from './secretPatterns';
