// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 3, item 3.7 — Local RAG over docs (offline MCP).
 *
 *  MCP server that indexes local PDF/HTML docs into the existing Qdrant
 *  vector store. The agent can then query these docs without internet.
 *
 *  STATUS: Architecture stub. Pure-logic helpers only.
 *  The actual MCP server implementation that uses Qdrant is future work.
 *
 *  Estimated effort to complete: 4-5 days
 *--------------------------------------------------------------------------------------------*/

/**
 * A document in the local RAG index.
 */
export interface ILocalDoc {
	/** Unique document ID */
	id: string;
	/** Source file path (workspace-relative or absolute) */
	sourcePath: string;
	/** Document title (extracted from content) */
	title: string;
	/** Document type */
	type: 'pdf' | 'html' | 'markdown' | 'text' | 'unknown';
	/** Number of chunks this document was split into */
	chunkCount: number;
	/** Total tokens in the document */
	tokenCount: number;
	/** ISO 8601 timestamp when indexed */
	indexedAt: string;
	/** Content hash for change detection */
	contentHash: string;
}

/**
 * A search result from the local RAG.
 */
export interface ILocalRagSearchResult {
	/** Document the result came from */
	docId: string;
	/** Document title */
	title: string;
	/** Source file path */
	sourcePath: string;
	/** Chunk content */
	content: string;
	/** Similarity score (0-1) */
	score: number;
	/** Page number (for PDFs) */
	page?: number;
	/** Character offset in the source document */
	offset?: number;
}

/**
 * Indexing status for a document.
 */
export type IndexingStatus = 'pending' | 'indexing' | 'completed' | 'failed' | 'stale';

/**
 * Configuration for the local RAG.
 */
export interface ILocalRagConfig {
	/** Directories to index (workspace-relative) */
	indexDirectories: string[];
	/** File extensions to index */
	extensions: string[];
	/** Chunk size in tokens (default 256) */
	chunkSize: number;
	/** Chunk overlap in tokens (default 32) */
	chunkOverlap: number;
	/** Maximum file size in MB (default 50) */
	maxFileSizeMb: number;
	/** Whether to re-index on file change */
	watchForChanges: boolean;
}

export const DEFAULT_LOCAL_RAG_CONFIG: ILocalRagConfig = {
	indexDirectories: ['docs/', 'README.md', '*.md'],
	extensions: ['.md', '.markdown', '.html', '.htm', '.txt', '.pdf'],
	chunkSize: 256,
	chunkOverlap: 32,
	maxFileSizeMb: 50,
	watchForChanges: true,
};

/**
 * Determine document type from file extension.
 *
 * Exported for unit testing.
 */
export function detectDocType(filePath: string): ILocalDoc['type'] {
	const lower = filePath.toLowerCase();
	if (lower.endsWith('.pdf')) { return 'pdf'; }
	if (lower.endsWith('.html') || lower.endsWith('.htm')) { return 'html'; }
	if (lower.endsWith('.md') || lower.endsWith('.markdown')) { return 'markdown'; }
	if (lower.endsWith('.txt')) { return 'text'; }
	return 'unknown';
}

/**
 * Check whether a file should be indexed based on its extension and size.
 *
 * Exported for unit testing.
 */
export function shouldIndexFile(
	filePath: string,
	fileSizeMb: number,
	config: ILocalRagConfig
): boolean {
	// Check extension
	const lower = filePath.toLowerCase();
	const matchesExt = config.extensions.some(ext => lower.endsWith(ext));
	if (!matchesExt) { return false; }
	// Check size
	if (fileSizeMb > config.maxFileSizeMb) { return false; }
	return true;
}

/**
 * Split text into chunks of approximately `chunkSize` tokens with overlap.
 * Uses a simple word-based tokenization (1 token ~= 0.75 words).
 *
 * Exported for unit testing.
 */
export function chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
	// Simple word-based chunking. Real implementation would use a proper tokenizer.
	const words = text.split(/\s+/);
	const chunks: string[] = [];
	const wordsPerChunk = Math.floor(chunkSize * 1.33); // 1 token ~= 0.75 words
	const overlapWords = Math.floor(chunkOverlap * 1.33);
	let i = 0;
	while (i < words.length) {
		const end = Math.min(i + wordsPerChunk, words.length);
		chunks.push(words.slice(i, end).join(' '));
		if (end >= words.length) { break; }
		i = end - overlapWords;
		if (i < 0) { i = 0; }
	}
	return chunks;
}

/**
 * Compute a simple content hash for change detection.
 *
 * Exported for unit testing.
 */
export function computeContentHash(content: string): string {
	// Simple FNV-1a hash. Real implementation would use crypto.
	let hash = 2166136261;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16);
}

/**
 * Estimate token count for a piece of text.
 *
 * Exported for unit testing.
 */
export function estimateTokenCount(text: string): number {
	// Rough estimate: 1 token ~= 4 characters, or 0.75 words
	return Math.ceil(text.length / 4);
}

/**
 * Format a search result for display in the agent's context.
 *
 * Exported for unit testing.
 */
export function formatSearchResult(result: ILocalRagSearchResult): string {
	const header = `[${result.title}] (${result.sourcePath})`;
	const score = `Score: ${(result.score * 100).toFixed(1)}%`;
	const page = result.page ? ` (page ${result.page})` : '';
	return `${header}${page}\n${score}\n\n${result.content}`;
}

/**
 * Sort search results by score (descending).
 *
 * Exported for unit testing.
 */
export function sortSearchResults(results: ILocalRagSearchResult[]): ILocalRagSearchResult[] {
	return [...results].sort((a, b) => b.score - a.score);
}

/**
 * Deduplicate search results by content hash.
 *
 * Exported for unit testing.
 */
export function deduplicateResults(results: ILocalRagSearchResult[]): ILocalRagSearchResult[] {
	const seen = new Set<string>();
	return results.filter(r => {
		const hash = computeContentHash(r.content);
		if (seen.has(hash)) { return false; }
		seen.add(hash);
		return true;
	});
}
