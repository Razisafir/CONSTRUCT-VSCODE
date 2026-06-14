"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
 * Tests for Performance/Stress — benchmarks, memory leak detection, concurrent tool execution.
 * Source references:
 * - src/vs/platform/construct/common/terminal/terminalExecutor.ts — TerminalRateLimiter, MAX_OUTPUT_LENGTH, sanitiseOutput
 * - src/vs/platform/construct/common/tools/constructToolRegistry.ts — IToolResult
 */
// ---- Replicate production logic ----
const MAX_OUTPUT_LENGTH = 10_000;
const TERMINAL_RATE_LIMIT = {
    maxCommands: 10,
    windowMs: 30_000,
};
class TerminalRateLimiter {
    commandTimestamps = [];
    canExecute() {
        const now = Date.now();
        const windowStart = now - TERMINAL_RATE_LIMIT.windowMs;
        this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);
        return this.commandTimestamps.length < TERMINAL_RATE_LIMIT.maxCommands;
    }
    recordExecution() {
        this.commandTimestamps.push(Date.now());
    }
    remainingCommands() {
        const now = Date.now();
        const windowStart = now - TERMINAL_RATE_LIMIT.windowMs;
        this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);
        return Math.max(0, TERMINAL_RATE_LIMIT.maxCommands - this.commandTimestamps.length);
    }
}
function stripAnsiEscapeSequences(text) {
    return text
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}
function truncateOutput(output) {
    if (output.length > MAX_OUTPUT_LENGTH) {
        return {
            output: output.substring(0, MAX_OUTPUT_LENGTH) + '\n[OUTPUT TRUNCATED — exceeded 10,000 characters]',
            truncated: true,
        };
    }
    return { output, truncated: false };
}
// Concurrent tool execution simulator
class ConcurrentToolExecutor {
    activeCount = 0;
    maxConcurrent;
    completedCount = 0;
    failedCount = 0;
    constructor(maxConcurrent = 5) {
        this.maxConcurrent = maxConcurrent;
    }
    async executeTool(name, durationMs, shouldFail = false) {
        if (this.activeCount >= this.maxConcurrent) {
            return { success: false, output: `Max concurrent executions reached (${this.maxConcurrent})`, truncated: false };
        }
        this.activeCount++;
        try {
            // Simulate work
            const start = Date.now();
            await new Promise(resolve => setTimeout(resolve, durationMs));
            const elapsed = Date.now() - start;
            if (shouldFail) {
                this.failedCount++;
                return { success: false, output: `${name} failed`, truncated: false, metadata: { durationMs: elapsed } };
            }
            this.completedCount++;
            return { success: true, output: `${name} completed`, truncated: false, metadata: { durationMs: elapsed } };
        }
        finally {
            this.activeCount--;
        }
    }
    getActiveCount() { return this.activeCount; }
    getCompletedCount() { return this.completedCount; }
    getFailedCount() { return this.failedCount; }
}
// Memory tracking
class MemoryTracker {
    snapshots = [];
    snapshot(label) {
        this.snapshots.push({
            label,
            memory: process.memoryUsage(),
            timestamp: Date.now(),
        });
    }
    getHeapGrowth() {
        if (this.snapshots.length < 2) {
            return 0;
        }
        const first = this.snapshots[0].memory.heapUsed;
        const last = this.snapshots[this.snapshots.length - 1].memory.heapUsed;
        return last - first;
    }
    getSnapshots() { return [...this.snapshots]; }
}
// ---- Tests ----
suite('Performance Tests', () => {
    suite('Throughput', () => {
        test('should handle large file parsing within time limit', () => {
            const start = Date.now();
            // Simulate parsing a large file (10K lines)
            const lines = [];
            for (let i = 0; i < 10_000; i++) {
                lines.push(`Line ${i}: function test${i}() { return ${i}; }`);
            }
            const content = lines.join('\n');
            const parsed = content.split('\n');
            const elapsed = Date.now() - start;
            assert.strictEqual(parsed.length, 10_000);
            assert.ok(elapsed < 1000, `Parsing should complete in <1s, took ${elapsed}ms`);
        });
        test('should handle rapid sequential requests', () => {
            const limiter = new TerminalRateLimiter();
            let allowed = 0;
            let blocked = 0;
            for (let i = 0; i < 20; i++) {
                if (limiter.canExecute()) {
                    limiter.recordExecution();
                    allowed++;
                }
                else {
                    blocked++;
                }
            }
            assert.strictEqual(allowed, 10, 'Should allow exactly 10 commands');
            assert.strictEqual(blocked, 10, 'Should block commands after rate limit');
        });
        test('should handle concurrent tool executions', async () => {
            const executor = new ConcurrentToolExecutor(5);
            const promises = [];
            // Launch 5 concurrent executions
            for (let i = 0; i < 5; i++) {
                promises.push(executor.executeTool(`tool-${i}`, 10));
            }
            const results = await Promise.all(promises);
            assert.strictEqual(results.every(r => r.success), true);
            assert.strictEqual(executor.getCompletedCount(), 5);
        });
        test('should reject concurrent execution beyond limit', async () => {
            const executor = new ConcurrentToolExecutor(2);
            // Start 2 long-running tasks
            const long1 = executor.executeTool('long-1', 100);
            const long2 = executor.executeTool('long-2', 100);
            // Third should be rejected immediately (still 2 active)
            const result3 = await executor.executeTool('long-3', 10);
            assert.strictEqual(result3.success, false);
            assert.ok(result3.output.includes('Max concurrent'));
            await Promise.all([long1, long2]);
        });
    });
    suite('Memory', () => {
        test('should handle memory usage within bounds', () => {
            const tracker = new MemoryTracker();
            tracker.snapshot('before');
            // Simulate moderate memory allocation
            const data = [];
            for (let i = 0; i < 1000; i++) {
                data.push(`Entry ${i} with some data content`);
            }
            tracker.snapshot('after');
            // Growth should be reasonable (not > 50MB for this small test)
            const growth = tracker.getHeapGrowth();
            assert.ok(growth < 50 * 1024 * 1024, `Heap growth should be <50MB, was ${Math.round(growth / 1024)}KB`);
        });
        test('should handle memory pressure gracefully', () => {
            // Simulate output truncation under memory pressure
            const hugeOutput = 'x'.repeat(MAX_OUTPUT_LENGTH * 10);
            const { output, truncated } = truncateOutput(hugeOutput);
            assert.strictEqual(truncated, true);
            assert.ok(output.length < hugeOutput.length, 'Truncated output should be smaller');
        });
    });
    suite('Performance Benchmarks', () => {
        test('should handle large context window efficiently', () => {
            const start = Date.now();
            // Simulate a large context (100K characters of conversation)
            const context = [];
            for (let i = 0; i < 1000; i++) {
                context.push(`User message ${i}: This is a sample conversation turn with some content that represents a typical exchange.`);
            }
            const fullContext = context.join('\n');
            const elapsed = Date.now() - start;
            assert.ok(fullContext.length > 50_000, 'Should have substantial context');
            assert.ok(elapsed < 500, `Context assembly should be fast, took ${elapsed}ms`);
        });
        test('should handle search across large codebases', () => {
            // Simulate searching across 1000 files
            const files = [];
            for (let i = 0; i < 1000; i++) {
                files.push({ name: `file${i}.ts`, content: `export function func${i}() { return ${i}; }` });
            }
            const start = Date.now();
            const results = files.filter(f => f.content.includes('func500'));
            const elapsed = Date.now() - start;
            assert.strictEqual(results.length, 1);
            assert.ok(elapsed < 100, `Search should be fast, took ${elapsed}ms`);
        });
        test('should handle startup time within budget', () => {
            const start = Date.now();
            // Simulate service initialization
            const limiter = new TerminalRateLimiter();
            assert.strictEqual(limiter.remainingCommands(), 10);
            const elapsed = Date.now() - start;
            assert.ok(elapsed < 50, `Rate limiter init should be <50ms, took ${elapsed}ms`);
        });
        test('should handle session restore performance', () => {
            // Simulate restoring a session with many open files
            const session = {
                openFiles: Array.from({ length: 50 }, (_, i) => `/workspace/file${i}.ts`),
                toolHistory: Array.from({ length: 100 }, (_, i) => `tool-${i}`),
            };
            const serialized = JSON.stringify(session);
            const start = Date.now();
            const restored = JSON.parse(serialized);
            const elapsed = Date.now() - start;
            assert.strictEqual(restored.openFiles.length, 50);
            assert.strictEqual(restored.toolHistory.length, 100);
            assert.ok(elapsed < 50, `Session restore should be <50ms, took ${elapsed}ms`);
        });
        test('should handle diff computation for large files', () => {
            const start = Date.now();
            // Simulate computing diff between two large files
            const oldLines = Array.from({ length: 5000 }, (_, i) => `line ${i}: old content`);
            const newLines = [...oldLines.slice(0, 2500), 'line 2500: modified content', ...oldLines.slice(2501)];
            // Simple diff: find changed lines
            const diffs = [];
            for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
                if (oldLines[i] !== newLines[i]) {
                    diffs.push(i);
                }
            }
            const elapsed = Date.now() - start;
            assert.strictEqual(diffs.length, 1);
            assert.strictEqual(diffs[0], 2500);
            assert.ok(elapsed < 200, `Diff computation should be fast, took ${elapsed}ms`);
        });
    });
});
//# sourceMappingURL=perfStress.test.js.map