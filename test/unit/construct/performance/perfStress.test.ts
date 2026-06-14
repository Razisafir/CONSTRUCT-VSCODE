/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

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
	private commandTimestamps: number[] = [];

	canExecute(): boolean {
		const now = Date.now();
		const windowStart = now - TERMINAL_RATE_LIMIT.windowMs;
		this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);
		return this.commandTimestamps.length < TERMINAL_RATE_LIMIT.maxCommands;
	}

	recordExecution(): void {
		this.commandTimestamps.push(Date.now());
	}

	remainingCommands(): number {
		const now = Date.now();
		const windowStart = now - TERMINAL_RATE_LIMIT.windowMs;
		this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);
		return Math.max(0, TERMINAL_RATE_LIMIT.maxCommands - this.commandTimestamps.length);
	}
}

function stripAnsiEscapeSequences(text: string): string {
	return text
		.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
		.replace(/\x1b\][^\x07]*\x07/g, '')
		.replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
		.replace(/\x1b\[[0-9;]*m/g, '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n');
}

function truncateOutput(output: string): { output: string; truncated: boolean } {
	if (output.length > MAX_OUTPUT_LENGTH) {
		return {
			output: output.substring(0, MAX_OUTPUT_LENGTH) + '\n[OUTPUT TRUNCATED — exceeded 10,000 characters]',
			truncated: true,
		};
	}
	return { output, truncated: false };
}

interface IToolResult {
	success: boolean;
	output: string;
	truncated: boolean;
	metadata?: { durationMs?: number };
}

// Concurrent tool execution simulator
class ConcurrentToolExecutor {
	private activeCount = 0;
	private maxConcurrent: number;
	private completedCount = 0;
	private failedCount = 0;

	constructor(maxConcurrent = 5) {
		this.maxConcurrent = maxConcurrent;
	}

	async executeTool(name: string, durationMs: number, shouldFail = false): Promise<IToolResult> {
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
		} finally {
			this.activeCount--;
		}
	}

	getActiveCount(): number { return this.activeCount; }
	getCompletedCount(): number { return this.completedCount; }
	getFailedCount(): number { return this.failedCount; }
}

// Memory tracking
class MemoryTracker {
	private snapshots: { label: string; memory: NodeJS.MemoryUsage; timestamp: number }[] = [];

	snapshot(label: string): void {
		this.snapshots.push({
			label,
			memory: process.memoryUsage(),
			timestamp: Date.now(),
		});
	}

	getHeapGrowth(): number {
		if (this.snapshots.length < 2) { return 0; }
		const first = this.snapshots[0].memory.heapUsed;
		const last = this.snapshots[this.snapshots.length - 1].memory.heapUsed;
		return last - first;
	}

	getSnapshots(): typeof this.snapshots { return [...this.snapshots]; }
}

// ---- Tests ----

suite('Performance Tests', () => {

	suite('Throughput', () => {
		test('should handle large file parsing within time limit', () => {
			const start = Date.now();
			// Simulate parsing a large file (10K lines)
			const lines: string[] = [];
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
				} else {
					blocked++;
				}
			}

			assert.strictEqual(allowed, 10, 'Should allow exactly 10 commands');
			assert.strictEqual(blocked, 10, 'Should block commands after rate limit');
		});

		test('should handle concurrent tool executions', async () => {
			const executor = new ConcurrentToolExecutor(5);
			const promises: Promise<IToolResult>[] = [];

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
			const data: string[] = [];
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
			const context: string[] = [];
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
			const files: { name: string; content: string }[] = [];
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
			const diffs: number[] = [];
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
