/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IConstructVectorStore = createDecorator<IConstructVectorStore>('kovix.vectorStore');

/**
 * A document chunk stored in the vector store.
 * Each chunk is a 512-token window of a workspace file,
 * with 64-token overlap between consecutive chunks.
 */
export interface IVectorChunk {
        /** Unique ID for this chunk */
        id: string;
        /** The text content of this chunk */
        content: string;
        /** The file path this chunk was extracted from */
        filePath: string;
        /** The start offset of this chunk in the file (character position) */
        startOffset: number;
        /** The end offset of this chunk in the file (character position) */
        endOffset: number;
        /** The embedding vector for this chunk */
        embedding: number[];
        /** Metadata for filtering and display */
        metadata: {
                /** File extension (e.g., '.ts', '.py') */
                extension: string;
                /** Last modified timestamp of the source file */
                lastModified: number;
                /** Chunk index within the file (0-based) */
                chunkIndex: number;
        };
}

/**
 * Search result from the vector store.
 */
export interface IVectorSearchResult {
        /** The matching chunk */
        chunk: IVectorChunk;
        /** Similarity score (0-1, higher is more similar) */
        score: number;
}

/**
 * IConstructVectorStore — interface for the Qdrant-backed vector store.
 *
 * Stores workspace file chunks as embeddings and supports semantic search.
 * The collection is identified by a hash of the workspace root path,
 * ensuring each workspace gets its own isolated vector space.
 *
 * OFFLINE FIRST: Qdrant runs locally (localhost:6333). If Qdrant is not
 * running, the service skips memory with a clear warning — never crashes.
 *
 * Graceful degradation:
 * - If Qdrant is not reachable: all operations return empty results
 * - If embedding fails: chunk is stored without embedding (skipped in search)
 * - If workspace walk fails: indexing is skipped
 */
export interface IConstructVectorStore {
        readonly _serviceBrand: undefined;

        /**
         * Initialize the vector store for the given workspace.
         * Creates the Qdrant collection if it doesn't exist.
         * If Qdrant is not running, this returns false and all
         * subsequent operations will be no-ops.
         *
         * @param workspaceRoot The workspace root path (used to derive collection name).
         * @returns True if the vector store is ready to use.
         */
        initialize(workspaceRoot: string): Promise<boolean>;

        /**
         * Index a file into the vector store.
         * Reads the file, chunks it (512-token windows, 64-token overlap),
         * generates embeddings for each chunk, and stores them in Qdrant.
         *
         * @param filePath Absolute path to the file.
         * @param content File content. If not provided, the file will be read from disk.
         */
        indexFile(filePath: string, content?: string): Promise<void>;

        /**
         * Remove all chunks for a given file from the vector store.
         *
         * @param filePath Absolute path to the file.
         */
        removeFile(filePath: string): Promise<void>;

        /**
         * Index all files in the workspace.
         * Walks the workspace recursively, skipping binary files and
         * common ignore patterns (node_modules, .git, etc.).
         *
         * @param workspaceRoot The workspace root path.
         * @param onProgress Optional callback for progress reporting.
         */
        indexWorkspace(workspaceRoot: string, onProgress?: (indexed: number, total: number) => void): Promise<void>;

        /**
         * Search for chunks similar to the given query.
         *
         * @param query The search query text.
         * @param queryEmbedding The embedding of the query (if pre-computed).
         * @param topK Number of results to return (default 8).
         * @returns Array of search results, sorted by similarity (highest first).
         */
        search(query: string, queryEmbedding?: number[], topK?: number): Promise<IVectorSearchResult[]>;

        /**
         * Generate an embedding for the given text.
         * Uses the active AI provider's embedding model.
         * Falls back to a simple hash-based pseudo-embedding if no
         * embedding model is available (for offline mode).
         *
         * @param text The text to embed.
         * @returns The embedding vector.
         */
        embed(text: string): Promise<number[]>;

        /**
         * Check if the vector store is connected and ready.
         */
        isConnected(): boolean;

        /**
         * Get the number of indexed chunks.
         */
        getChunkCount(): Promise<number>;
}
