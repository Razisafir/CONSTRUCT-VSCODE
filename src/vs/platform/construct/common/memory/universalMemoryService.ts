/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { IUniversalMemoryEntry, IUniversalMemoryQuery, IUniversalMemoryStats } from './universalMemoryTypes.js';

export const IUniversalMemoryService = createDecorator<IUniversalMemoryService>('kovix.universalMemory');

/**
 * Phase 5.5 (Fix 3) -- enriched context for auto-extract.
 *
 * The basic autoExtractFromTask(task, summary) only sees the task description
 * and a 500-char summary. This enriched context gives the AI more material
 * to extract memories from:
 *
 *   - conversationHistory: the full multi-turn conversation (user messages
 *     + assistant responses + tool calls + tool results). This is the
 *     richest source of "the user said X, the agent did Y, the result was Z"
 *     patterns.
 *   - failedToolResults: tool calls that returned Error: ... + their inputs.
 *     These are error->solution pairs ("npx tsc failed because of X, fixed
 *     by Y") that are worth remembering for future tasks.
 *   - repeatedFileReads: files the agent read more than once. These are
 *     likely "project context" files (config, package.json, README) worth
 *     remembering as "this project uses X".
 */
export interface IAutoExtractContext {
	/**
	 * The full conversation history from the task (user + assistant + tool
	 * messages). Truncated to a reasonable size by the caller (e.g. last
	 * 20 messages or 8KB, whichever is smaller).
	 */
	readonly conversationHistory?: ReadonlyArray<{ role: string; content: string }>;

	/**
	 * Tool calls that failed (returned Error: ...). Each entry has the
	 * tool name, the input that was passed, and the error result.
	 */
	readonly failedToolResults?: ReadonlyArray<{
		toolName: string;
		input: unknown;
		result: string;
	}>;

	/**
	 * Files the agent read more than once during the task. These are
	 * likely project-context files worth remembering.
	 */
	readonly repeatedFileReads?: ReadonlyArray<string>;
}

/**
 * Service for universal, cross-project memory that persists locally.
 * Unlike the per-project four-layer memory, universal memory stores
 * facts, patterns, and preferences that apply across all projects.
 *
 * Storage: ~/.kovix/universal-memory.json (local JSON file)
 * Fallback: Supermemory write-through when available
 */
export interface IUniversalMemoryService {
	readonly _serviceBrand: undefined;

	/**
	 * Add a memory entry to the universal store.
	 */
	addMemory(content: string, category: string, tags?: string[]): Promise<IUniversalMemoryEntry>;

	/**
	 * Query universal memory with fuzzy search.
	 * Uses tag matching, substring search, and category filtering.
	 */
	query(query: IUniversalMemoryQuery): Promise<IUniversalMemoryEntry[]>;

	/**
	 * Get formatted context string for a task.
	 * Searches for relevant memories and formats them for LLM injection.
	 */
	getContextForTask(task: string, limit?: number): Promise<string>;

	/**
	 * Auto-extract memories from a completed task.
	 * Uses the AI to identify reusable facts, patterns, or conventions.
	 *
	 * Phase 5.5 (Fix 3): the basic form (task + summary) is preserved for
	 * backward compatibility. The enriched form takes an IAutoExtractContext
	 * with conversation history, failed tool results, and repeated file
	 * reads -- giving the AI much more material to extract from.
	 */
	autoExtractFromTask(task: string, summary: string, enrichedContext?: IAutoExtractContext): Promise<void>;

	/**
	 * Remove a memory entry by ID.
	 */
	removeMemory(id: string): Promise<void>;

	/**
	 * Delete a memory entry by ID (alias of {@link removeMemory}).
	 * Used by the Obsidian-style memory graph UI.
	 */
	delete(id: string): Promise<void>;

	/**
	 * Update an existing memory entry's content and/or tags.
	 * Used by the Obsidian-style memory graph editor.
	 */
	update(id: string, changes: { content?: string; tags?: string[] }): Promise<IUniversalMemoryEntry | undefined>;

	/**
	 * Get statistics about the universal memory store.
	 */
	getStats(): Promise<IUniversalMemoryStats>;

	/**
	 * Compact the memory store by removing duplicates and low-value entries.
	 */
	compact(): Promise<number>;
}
