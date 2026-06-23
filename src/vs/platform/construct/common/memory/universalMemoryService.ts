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
	 */
	autoExtractFromTask(task: string, summary: string): Promise<void>;

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
