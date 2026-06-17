/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for the Tier 1.7 local usage log service pure-logic helpers.
 *
 * The ILocalUsageLogService implementation requires filesystem access and
 * VS Code services, so it is exercised by integration tests. The pure-logic
 * helpers (redaction, formatting, path building, rotation decision) are
 * tested here in isolation.
 */

import * as assert from 'assert';
import {
        redactString,
        redactObject,
        formatEventLine,
        buildLogPath,
        shouldRotateLog,
        parseJsonlLog,
        computeUsageStats,
        DEFAULT_LOG_RELATIVE_PATH,
        MAX_LOG_FILE_SIZE_BYTES,
        MAX_IN_MEMORY_EVENTS,
        REDACTION_PATTERNS,
} from '../../../../src/vs/platform/construct/common/telemetry/localUsageLogHelpers.js';

suite('LocalUsageLog', () => {

        suite('redactString', () => {

                test('redacts Anthropic API keys', () => {
                        const input = 'Using key sk-ant-api03-1234567890abcdefghijklmnopqrstuv';
                        const result = redactString(input);
                        assert.ok(!result.includes('sk-ant-api03-1234567890abcdefghijklmnopqrstuv'));
                        assert.ok(result.includes('[REDACTED]'));
                });

                test('redacts OpenAI API keys', () => {
                        const input = 'Using key sk-proj1234567890abcdefghijklmnopqrstuv';
                        const result = redactString(input);
                        assert.ok(!result.includes('sk-proj1234567890abcdefghijklmnopqrstuv'));
                        assert.ok(result.includes('[REDACTED]'));
                });

                test('redacts GitHub PATs', () => {
                        const input = 'Using token ghp_1234567890abcdefghijklmnopqrstuv1234567890';
                        const result = redactString(input);
                        assert.ok(!result.includes('ghp_1234567890abcdefghijklmnopqrstuv1234567890'));
                        assert.ok(result.includes('[REDACTED]'));
                });

                test('redacts email addresses', () => {
                        const input = 'Contact user@example.com for help';
                        const result = redactString(input);
                        assert.ok(!result.includes('user@example.com'));
                });

                test('redacts IP addresses', () => {
                        const input = 'Connecting to 192.168.1.100 on port 8080';
                        const result = redactString(input);
                        assert.ok(!result.includes('192.168.1.100'));
                });

                test('redacts file paths containing usernames', () => {
                        const input = 'Reading /Users/alice/secret/file.txt';
                        const result = redactString(input);
                        assert.ok(!result.includes('/Users/alice'));
                });

                test('preserves non-sensitive content', () => {
                        const input = 'Tool read_file executed in 42ms on file src/index.ts';
                        const result = redactString(input);
                        assert.strictEqual(result, input);
                });

                test('handles empty string', () => {
                        assert.strictEqual(redactString(''), '');
                });

                test('handles string with no sensitive content', () => {
                        const input = 'Just a normal log message with no secrets';
                        assert.strictEqual(redactString(input), input);
                });

                test('redacts multiple patterns in one string', () => {
                        const input = 'Auth with Bearer abc123def456ghi789jkl012mno345pqr678stu901 and key sk-ant-api03-1234567890abcdefghijklmnopqrstuv';
                        const result = redactString(input);
                        assert.ok(!result.includes('abc123def456ghi789jkl012mno345pqr678stu901'));
                        assert.ok(!result.includes('sk-ant-api03-1234567890abcdefghijklmnopqrstuv'));
                });
        });

        suite('redactObject', () => {

                test('redacts string values in nested objects', () => {
                        const input = {
                                message: 'Using key sk-ant-api03-1234567890abcdefghijklmnopqrstuv',
                                nested: { deep: 'email: user@example.com' },
                        };
                        const result = redactObject(input);
                        assert.ok(!JSON.stringify(result).includes('sk-ant-api03-1234567890abcdefghijklmnopqrstuv'));
                        assert.ok(!JSON.stringify(result).includes('user@example.com'));
                });

                test('redacts known sensitive field names entirely', () => {
                        const input = {
                                apiKey: 'my-secret-key',
                                token: 'my-token',
                                password: 'hunter2',
                                normal: 'normal-value',
                        };
                        const result = redactObject(input);
                        assert.strictEqual((result as any).apiKey, '[REDACTED]');
                        assert.strictEqual((result as any).token, '[REDACTED]');
                        assert.strictEqual((result as any).password, '[REDACTED]');
                        assert.strictEqual((result as any).normal, 'normal-value');
                });

                test('handles arrays', () => {
                        const input = {
                                items: ['sk-ant-api03-1234567890abcdefghijklmnopqrstuv', 'normal'],
                        };
                        const result = redactObject(input);
                        assert.ok(!JSON.stringify(result).includes('sk-ant-api03-1234567890abcdefghijklmnopqrstuv'));
                });

                test('handles primitive values', () => {
                        assert.strictEqual(redactObject(42), 42);
                        assert.strictEqual(redactObject(true), true);
                        assert.strictEqual(redactObject(null), null);
                        assert.strictEqual(redactObject(undefined), undefined);
                });

                test('handles case-insensitive sensitive field names', () => {
                        const input = { ApiKey: 'secret', TOKEN: 'secret' };
                        const result = redactObject(input);
                        assert.strictEqual((result as any).ApiKey, '[REDACTED]');
                        assert.strictEqual((result as any).TOKEN, '[REDACTED]');
                });

                test('preserves object structure', () => {
                        const input = { a: 1, b: { c: 2 }, d: [1, 2, 3] };
                        const result = redactObject(input);
                        assert.deepStrictEqual(result, input);
                });
        });

        suite('formatEventLine', () => {

                test('formats a basic event as JSON', () => {
                        const event = {
                                timestamp: '2026-06-17T00:00:00.000Z',
                                event: 'agent.toolExecuted',
                        };
                        const line = formatEventLine(event);
                        const parsed = JSON.parse(line);
                        assert.strictEqual(parsed.timestamp, '2026-06-17T00:00:00.000Z');
                        assert.strictEqual(parsed.event, 'agent.toolExecuted');
                });

                test('includes properties when provided', () => {
                        const event = {
                                timestamp: '2026-06-17T00:00:00.000Z',
                                event: 'agent.toolExecuted',
                                properties: { tool: 'read_file', duration: 42 },
                        };
                        const line = formatEventLine(event);
                        const parsed = JSON.parse(line);
                        assert.strictEqual(parsed.properties.tool, 'read_file');
                });

                test('redacts sensitive values in properties', () => {
                        const event = {
                                timestamp: '2026-06-17T00:00:00.000Z',
                                event: 'provider.connectionTested',
                                properties: { apiKey: 'sk-ant-api03-1234567890abcdefghijklmnopqrstuv' },
                        };
                        const line = formatEventLine(event);
                        assert.ok(!line.includes('sk-ant-api03-1234567890abcdefghijklmnopqrstuv'));
                        assert.ok(line.includes('[REDACTED]'));
                });

                test('produces single-line output (JSONL)', () => {
                        const event = {
                                timestamp: '2026-06-17T00:00:00.000Z',
                                event: 'test',
                                properties: { multi: 'line\nvalue' },
                        };
                        const line = formatEventLine(event);
                        assert.ok(!line.includes('\n'), 'JSONL must be single-line');
                });
        });

        suite('buildLogPath', () => {

                test('joins home directory with default relative path', () => {
                        const result = buildLogPath('/home/user');
                        assert.ok(result.includes('/home/user'));
                        assert.ok(result.includes('.kovix/logs/usage.jsonl'));
                });

                test('accepts custom relative path', () => {
                        const result = buildLogPath('/home/user', 'custom/path.jsonl');
                        assert.ok(result.includes('/home/user'));
                        assert.ok(result.includes('custom/path.jsonl'));
                });

                test('handles Windows-style paths', () => {
                        const result = buildLogPath('C:\\Users\\alice');
                        assert.ok(result.includes('C:\\Users\\alice'));
                });
        });

        suite('shouldRotateLog', () => {

                test('returns false for small files', () => {
                        assert.strictEqual(shouldRotateLog(1024), false);
                        assert.strictEqual(shouldRotateLog(0), false);
                });

                test('returns true when file exceeds max size', () => {
                        assert.strictEqual(shouldRotateLog(MAX_LOG_FILE_SIZE_BYTES + 1), true);
                        assert.strictEqual(shouldRotateLog(MAX_LOG_FILE_SIZE_BYTES * 2), true);
                });

                test('returns false at exactly the threshold', () => {
                        // >= triggers rotation, so exactly at threshold returns true
                        assert.strictEqual(shouldRotateLog(MAX_LOG_FILE_SIZE_BYTES), true);
                        assert.strictEqual(shouldRotateLog(MAX_LOG_FILE_SIZE_BYTES - 1), false);
                });

                test('accepts custom max size', () => {
                        assert.strictEqual(shouldRotateLog(500, 1000), false);
                        assert.strictEqual(shouldRotateLog(1500, 1000), true);
                });
        });

        suite('constants', () => {

                test('DEFAULT_LOG_RELATIVE_PATH is under .kovix/logs/', () => {
                        assert.ok(DEFAULT_LOG_RELATIVE_PATH.startsWith('.kovix/logs/'));
                        assert.ok(DEFAULT_LOG_RELATIVE_PATH.endsWith('.jsonl'));
                });

                test('MAX_LOG_FILE_SIZE_BYTES is 10 MB', () => {
                        assert.strictEqual(MAX_LOG_FILE_SIZE_BYTES, 10 * 1024 * 1024);
                });

                test('MAX_IN_MEMORY_EVENTS is bounded', () => {
                        assert.ok(MAX_IN_MEMORY_EVENTS > 0);
                        assert.ok(MAX_IN_MEMORY_EVENTS <= 10000);
                });

                test('REDACTION_PATTERNS is non-empty', () => {
                        assert.ok(REDACTION_PATTERNS.length >= 5);
                });
        });

	suite('parseJsonlLog', () => {

		test('parses a single valid entry', () => {
			const content = '{"timestamp":"2026-06-17T00:00:00.000Z","event":"test"}';
			const result = parseJsonlLog(content);
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.malformedLineCount, 0);
			assert.strictEqual(result.entries[0]!.event, 'test');
		});

		test('parses multiple entries separated by newlines', () => {
			const content = [
				'{"timestamp":"2026-06-17T00:00:00.000Z","event":"a"}',
				'{"timestamp":"2026-06-17T00:00:01.000Z","event":"b"}',
				'{"timestamp":"2026-06-17T00:00:02.000Z","event":"c"}',
			].join('\n');
			const result = parseJsonlLog(content);
			assert.strictEqual(result.entries.length, 3);
			assert.strictEqual(result.malformedLineCount, 0);
		});

		test('skips malformed lines and counts them', () => {
			const content = [
				'{"timestamp":"2026-06-17T00:00:00.000Z","event":"a"}',
				'this is not json',
				'{"timestamp":"2026-06-17T00:00:01.000Z","event":"b"}',
				'{broken json',
			].join('\n');
			const result = parseJsonlLog(content);
			assert.strictEqual(result.entries.length, 2);
			assert.strictEqual(result.malformedLineCount, 2);
		});

		test('handles empty content', () => {
			assert.strictEqual(parseJsonlLog('').entries.length, 0);
		});

		test('handles content with only whitespace lines', () => {
			const result = parseJsonlLog('  \n  \n  ');
			assert.strictEqual(result.entries.length, 0);
			assert.strictEqual(result.malformedLineCount, 0);
		});

		test('preserves properties and measurements', () => {
			const content = '{"timestamp":"2026-06-17T00:00:00.000Z","event":"test","properties":{"tool":"read"},"measurements":{"durationMs":42}}';
			const result = parseJsonlLog(content);
			assert.strictEqual(result.entries[0]!.properties?.tool, 'read');
			assert.strictEqual(result.entries[0]!.measurements?.durationMs, 42);
		});
	});

	suite('computeUsageStats', () => {

		test('returns empty stats for empty entries', () => {
			const stats = computeUsageStats([], 0);
			assert.strictEqual(stats.totalEvents, 0);
			assert.strictEqual(stats.earliestEvent, null);
			assert.strictEqual(stats.latestEvent, null);
			assert.strictEqual(stats.topEvents.length, 0);
			assert.strictEqual(stats.errorCount, 0);
		});

		test('counts total events', () => {
			const entries = [
				{ timestamp: '2026-06-17T00:00:00.000Z', event: 'a' },
				{ timestamp: '2026-06-17T00:00:01.000Z', event: 'b' },
				{ timestamp: '2026-06-17T00:00:02.000Z', event: 'a' },
			];
			const stats = computeUsageStats(entries, 1000);
			assert.strictEqual(stats.totalEvents, 3);
		});

		test('finds earliest and latest timestamps', () => {
			const entries = [
				{ timestamp: '2026-06-17T00:01:00.000Z', event: 'a' },
				{ timestamp: '2026-06-17T00:00:00.000Z', event: 'b' },
				{ timestamp: '2026-06-17T00:02:00.000Z', event: 'c' },
			];
			const stats = computeUsageStats(entries, 1000);
			assert.strictEqual(stats.earliestEvent, '2026-06-17T00:00:00.000Z');
			assert.strictEqual(stats.latestEvent, '2026-06-17T00:02:00.000Z');
		});

		test('counts error events', () => {
			const entries = [
				{ timestamp: '2026-06-17T00:00:00.000Z', event: 'agent.taskCompleted' },
				{ timestamp: '2026-06-17T00:00:01.000Z', event: 'agent.taskFailed' },
				{ timestamp: '2026-06-17T00:00:02.000Z', event: 'error.occurred' },
				{ timestamp: '2026-06-17T00:00:03.000Z', event: 'agent.toolExecuted' },
			];
			const stats = computeUsageStats(entries, 1000);
			assert.strictEqual(stats.errorCount, 2);
		});

		test('computes top events sorted by count', () => {
			const entries = [
				{ timestamp: '2026-06-17T00:00:00.000Z', event: 'a' },
				{ timestamp: '2026-06-17T00:00:01.000Z', event: 'b' },
				{ timestamp: '2026-06-17T00:00:02.000Z', event: 'a' },
				{ timestamp: '2026-06-17T00:00:03.000Z', event: 'a' },
				{ timestamp: '2026-06-17T00:00:04.000Z', event: 'c' },
			];
			const stats = computeUsageStats(entries, 1000);
			assert.strictEqual(stats.topEvents[0]!.event, 'a');
			assert.strictEqual(stats.topEvents[0]!.count, 3);
			assert.strictEqual(stats.topEvents[1]!.event, 'b');
			assert.strictEqual(stats.topEvents[1]!.count, 1);
		});

		test('limits top events to 10', () => {
			const entries: Array<{ timestamp: string; event: string }> = [];
			for (let i = 0; i < 20; i++) {
				entries.push({ timestamp: `2026-06-17T00:00:${i.toString().padStart(2, '0')}.000Z`, event: `event_${i}` });
			}
			const stats = computeUsageStats(entries, 1000);
			assert.strictEqual(stats.topEvents.length, 10);
		});

		test('reports file size', () => {
			const stats = computeUsageStats([], 42_000);
			assert.strictEqual(stats.fileSizeBytes, 42_000);
		});
	});
});
