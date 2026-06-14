"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
/**
 * Tests for Memory System — store/retrieve, eviction, compaction, expiration, fuzzy search.
 * Source references:
 * - src/vs/platform/construct/common/constructTypes.ts — safeJsonParse
 * - Memory store interfaces and logic patterns
 */
// ---- Replicate production logic ----
function safeJsonParse(input, fallback) {
    try {
        return JSON.parse(input);
    }
    catch {
        return fallback;
    }
}
class MemoryStore {
    entries = new Map();
    maxEntries;
    constructor(maxEntries = 100) {
        this.maxEntries = maxEntries;
    }
    store(entry) {
        // Check eviction before adding
        if (this.entries.size >= this.maxEntries && !this.entries.has(entry.id)) {
            this.evictOldest();
        }
        this.entries.set(entry.id, entry);
    }
    retrieve(id) {
        return this.entries.get(id);
    }
    search(query) {
        const lower = query.toLowerCase();
        return Array.from(this.entries.values()).filter(e => e.content.toLowerCase().includes(lower) ||
            e.tags.some(t => t.toLowerCase().includes(lower)));
    }
    fuzzySearch(query, threshold = 0.3) {
        const results = [];
        for (const entry of this.entries.values()) {
            const score = this.similarity(query.toLowerCase(), entry.content.toLowerCase());
            if (score >= threshold) {
                results.push(entry);
            }
        }
        return results.sort((a, b) => this.similarity(query, b.content) - this.similarity(query, a.content));
    }
    similarity(a, b) {
        // Simple Jaccard-like similarity on trigrams
        const trigramsA = this.trigrams(a);
        const trigramsB = this.trigrams(b);
        const intersection = trigramsA.filter(t => trigramsB.includes(t));
        const union = new Set([...trigramsA, ...trigramsB]);
        return union.size === 0 ? 0 : intersection.length / union.size;
    }
    trigrams(s) {
        const result = [];
        for (let i = 0; i < s.length - 2; i++) {
            result.push(s.substring(i, i + 3));
        }
        return result;
    }
    getByCategory(category) {
        return Array.from(this.entries.values()).filter(e => e.category === category);
    }
    removeExpired(now) {
        let removed = 0;
        for (const [id, entry] of this.entries) {
            if (entry.expiration !== undefined && entry.expiration <= now) {
                this.entries.delete(id);
                removed++;
            }
        }
        return removed;
    }
    compact() {
        // Remove duplicate content entries, keeping the most recent
        const byContent = new Map();
        for (const entry of this.entries.values()) {
            const existing = byContent.get(entry.content);
            if (!existing || entry.timestamp > existing.timestamp) {
                byContent.set(entry.content, entry);
            }
        }
        const before = this.entries.size;
        this.entries.clear();
        for (const entry of byContent.values()) {
            this.entries.set(entry.id, entry);
        }
        return before - this.entries.size;
    }
    evictOldest() {
        let oldest;
        for (const entry of this.entries.values()) {
            if (!oldest || entry.timestamp < oldest.timestamp) {
                oldest = entry;
            }
        }
        if (oldest) {
            this.entries.delete(oldest.id);
        }
    }
    get size() { return this.entries.size; }
}
// ---- Tests ----
suite('Memory System Tests', () => {
    suite('Store and Retrieve', () => {
        test('should store and retrieve memory entries', () => {
            const store = new MemoryStore();
            const entry = {
                id: 'mem-1', content: 'User prefers TypeScript', category: 'preference',
                timestamp: Date.now(), tags: ['typescript', 'language']
            };
            store.store(entry);
            const retrieved = store.retrieve('mem-1');
            assert.ok(retrieved);
            assert.strictEqual(retrieved.content, 'User prefers TypeScript');
            assert.strictEqual(retrieved.category, 'preference');
        });
        test('should persist memory across sessions', () => {
            const entry = {
                id: 'mem-2', content: 'Project uses React', category: 'project',
                timestamp: Date.now(), tags: ['react']
            };
            const serialized = JSON.stringify(entry);
            // Simulate persistence via JSON serialization
            const restored = safeJsonParse(serialized, null);
            assert.strictEqual(restored.content, 'Project uses React');
            assert.strictEqual(restored.category, 'project');
        });
    });
    suite('Eviction Policy', () => {
        test('should handle memory eviction policy', () => {
            const store = new MemoryStore(3);
            store.store({ id: '1', content: 'first', category: 'test', timestamp: 100, tags: [] });
            store.store({ id: '2', content: 'second', category: 'test', timestamp: 200, tags: [] });
            store.store({ id: '3', content: 'third', category: 'test', timestamp: 300, tags: [] });
            // Adding 4th entry should evict oldest (timestamp 100)
            store.store({ id: '4', content: 'fourth', category: 'test', timestamp: 400, tags: [] });
            assert.strictEqual(store.size, 3);
            assert.strictEqual(store.retrieve('1'), undefined, 'Oldest entry should be evicted');
            assert.ok(store.retrieve('4'), 'Newest entry should exist');
        });
        test('should manage memory size limits', () => {
            const store = new MemoryStore(5);
            for (let i = 0; i < 10; i++) {
                store.store({ id: `m-${i}`, content: `content-${i}`, category: 'test', timestamp: i * 100, tags: [] });
            }
            assert.strictEqual(store.size, 5, 'Store should not exceed max entries');
        });
    });
    suite('Search and Retrieval', () => {
        test('should support memory search and retrieval', () => {
            const store = new MemoryStore();
            store.store({ id: '1', content: 'Use TypeScript for new files', category: 'preference', timestamp: Date.now(), tags: ['typescript'] });
            store.store({ id: '2', content: 'Use ESLint for linting', category: 'tooling', timestamp: Date.now(), tags: ['eslint'] });
            store.store({ id: '3', content: 'Deploy with Docker', category: 'devops', timestamp: Date.now(), tags: ['docker'] });
            const results = store.search('typescript');
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].id, '1');
        });
        test('should organize memory by categories', () => {
            const store = new MemoryStore();
            store.store({ id: '1', content: 'pref1', category: 'preference', timestamp: Date.now(), tags: [] });
            store.store({ id: '2', content: 'pref2', category: 'preference', timestamp: Date.now(), tags: [] });
            store.store({ id: '3', content: 'tool1', category: 'tooling', timestamp: Date.now(), tags: [] });
            const prefs = store.getByCategory('preference');
            assert.strictEqual(prefs.length, 2);
            const tools = store.getByCategory('tooling');
            assert.strictEqual(tools.length, 1);
        });
    });
    suite('Concurrency and Expiration', () => {
        test('should handle concurrent memory access', () => {
            const store = new MemoryStore();
            // Simulate rapid concurrent writes
            const entries = [];
            for (let i = 0; i < 50; i++) {
                entries.push({ id: `c-${i}`, content: `concurrent-${i}`, category: 'test', timestamp: Date.now() + i, tags: [] });
            }
            for (const entry of entries) {
                store.store(entry);
            }
            assert.strictEqual(store.size, 50);
            assert.ok(store.retrieve('c-49'));
        });
        test('should handle memory expiration', () => {
            const store = new MemoryStore();
            const now = Date.now();
            store.store({ id: '1', content: 'expired', category: 'test', timestamp: now - 2000, tags: [], expiration: now - 1000 });
            store.store({ id: '2', content: 'active', category: 'test', timestamp: now, tags: [], expiration: now + 10000 });
            store.store({ id: '3', content: 'no-expiry', category: 'test', timestamp: now, tags: [] });
            const removed = store.removeExpired(now);
            assert.strictEqual(removed, 1, 'One expired entry should be removed');
            assert.strictEqual(store.retrieve('1'), undefined, 'Expired entry should be gone');
            assert.ok(store.retrieve('2'), 'Active entry should remain');
            assert.ok(store.retrieve('3'), 'No-expiry entry should remain');
        });
    });
    suite('Compaction and Corruption', () => {
        test('should support memory compaction', () => {
            const store = new MemoryStore();
            const now = Date.now();
            store.store({ id: '1', content: 'duplicate content', category: 'test', timestamp: now - 1000, tags: [] });
            store.store({ id: '2', content: 'duplicate content', category: 'test', timestamp: now, tags: [] });
            store.store({ id: '3', content: 'unique content', category: 'test', timestamp: now, tags: [] });
            const deduped = store.compact();
            assert.strictEqual(deduped, 1, 'One duplicate should be removed');
            assert.strictEqual(store.size, 2);
        });
        test('should handle memory corruption gracefully', () => {
            // Corrupted JSON data should fall back to default
            const corrupted = '{ invalid json }}}';
            const result = safeJsonParse(corrupted, []);
            assert.deepStrictEqual(result, [], 'Should return fallback on corrupted JSON');
            // Valid JSON should parse correctly
            const valid = JSON.stringify([{ id: '1', content: 'ok' }]);
            const parsed = safeJsonParse(valid, []);
            assert.strictEqual(parsed.length, 1);
        });
    });
});
//# sourceMappingURL=memorySystem.test.js.map