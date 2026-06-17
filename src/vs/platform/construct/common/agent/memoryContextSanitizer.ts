// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptSanitizer } from './promptSanitizer.js';

/**
 * Sanitize memory context before injection into the LLM system prompt.
 *
 * Delegates to PromptSanitizer.sanitize() for stripping control characters,
 * removing injection-like lines, and truncating long entries.
 *
 * @param content Raw memory/context string to sanitize.
 * @returns Sanitized string safe for LLM injection.
 */
export function sanitizeMemoryContext(content: string): string {
	return PromptSanitizer.sanitize(content);
}

/**
 * Sanitize and wrap a memory content block in protective XML tags
 * that clearly mark it as user-provided context, not system instructions.
 *
 * Delegates to PromptSanitizer.wrapMemoryBlock().
 *
 * @param content Raw memory/context string to sanitize and wrap.
 * @returns Wrapped string with XML safety markers.
 */
export function wrapMemoryContext(content: string): string {
	return PromptSanitizer.wrapMemoryBlock(content);
}
