// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Pure-logic helpers for the local usage log service.
 *
 *  Extracted to a separate file with ZERO VS Code imports so that the unit
 *  tests can exercise this logic without dragging in the service layer.
 *  The service implementation in localUsageLog.ts uses these helpers.
 *
 *  Tier 1, item 1.7 of the KOVIX Technical Audit roadmap.
 *--------------------------------------------------------------------------------------------*/

/** Default log file location relative to the user home directory. */
export const DEFAULT_LOG_RELATIVE_PATH = '.kovix/logs/usage.jsonl';

/** Maximum log file size before rotation (10 MB). */
export const MAX_LOG_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum events to retain in memory for getRecentEvents(). */
export const MAX_IN_MEMORY_EVENTS = 1000;

/**
 * Patterns that should be redacted from any string field before logging.
 */
export const REDACTION_PATTERNS: readonly RegExp[] = [
        // API keys
        /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
        /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
        /\b(ghp_[A-Za-z0-9]{36,})\b/g,
        /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
        /\b(xoxb-[A-Za-z0-9-]{20,})\b/g,
        /\b(AKIA[0-9A-Z]{16})\b/g,
        // Bearer tokens
        /\b(Bearer\s+[A-Za-z0-9_.\-/+=]{20,})\b/gi,
        // Email addresses
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        // IP addresses
        /\b(\d{1,3}\.){3}\d{1,3}\b/g,
        // File paths that look like they contain usernames
        /(\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+)/g,
];

/**
 * Redact sensitive patterns from a string.
 */
export function redactString(input: string): string {
        let result = input;
        for (const pattern of REDACTION_PATTERNS) {
                result = result.replace(pattern, (match) => {
                        if (match.length <= 8) {
                                return '[REDACTED]';
                        }
                        return match.substring(0, 4) + '...' + match.substring(match.length - 2) + '[REDACTED]';
                });
        }
        return result;
}

/**
 * Recursively redact an object's string values.
 */
export function redactObject<T>(obj: T): T {
        if (typeof obj === 'string') {
                return redactString(obj) as unknown as T;
        }
        if (Array.isArray(obj)) {
                return obj.map(redactObject) as unknown as T;
        }
        if (obj && typeof obj === 'object') {
                const result: Record<string, unknown> = {};
                const sensitiveFields = ['apikey', 'token', 'password', 'secret', 'cookie', 'authorization'];
                for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
                        if (sensitiveFields.includes(key.toLowerCase())) {
                                result[key] = '[REDACTED]';
                        } else {
                                result[key] = redactObject(value);
                        }
                }
                return result as unknown as T;
        }
        return obj;
}

/**
 * Format an event as a single JSONL line.
 */
export function formatEventLine(event: {
        timestamp: string;
        event: string;
        properties?: Record<string, unknown>;
        measurements?: Record<string, number>;
}): string {
        const redacted = redactObject(event);
        return JSON.stringify(redacted);
}

/**
 * Build the absolute path to the usage log file using simple string joining.
 * (Avoids importing 'path' so this file has zero non-standard deps.)
 */
export function buildLogPath(homeDir: string, relativePath: string = DEFAULT_LOG_RELATIVE_PATH): string {
        // Handle both Unix and Windows separators
        const sep = homeDir.includes('\\') ? '\\' : '/';
        const parts = relativePath.split(/[\/\\]/);
        return [homeDir, ...parts].join(sep);
}

/**
 * Decide whether the log file should be rotated based on its current size.
 */
export function shouldRotateLog(fileSizeBytes: number, maxSizeBytes: number = MAX_LOG_FILE_SIZE_BYTES): boolean {
        return fileSizeBytes >= maxSizeBytes;
}

/**
 * A single usage event entry, as stored in the JSONL log.
 */
export interface IUsageLogEntry {
        timestamp: string;
        event: string;
        properties?: Record<string, unknown>;
        measurements?: Record<string, number>;
        sessionId?: string;
}

/**
 * Summary statistics computed from the local usage log.
 */
export interface IUsageStats {
        totalEvents: number;
        earliestEvent: string | null;
        latestEvent: string | null;
        topEvents: Array<{ event: string; count: number }>;
        fileSizeBytes: number;
        errorCount: number;
}

/**
 * Parse a JSONL log file content into an array of entries.
 * Malformed lines are skipped (with a count returned for debugging).
 *
 * Exported for unit testing and for the service implementation.
 */
export function parseJsonlLog(logContent: string): { entries: IUsageLogEntry[]; malformedLineCount: number } {
        const lines = logContent.split('\n').filter(l => l.trim().length > 0);
        const entries: IUsageLogEntry[] = [];
        let malformed = 0;
        for (const line of lines) {
                try {
                        entries.push(JSON.parse(line) as IUsageLogEntry);
                } catch {
                        malformed++;
                }
        }
        return { entries, malformedLineCount: malformed };
}

/**
 * Compute usage statistics from a list of log entries.
 *
 * Exported for unit testing.
 */
export function computeUsageStats(entries: IUsageLogEntry[], fileSizeBytes: number): IUsageStats {
        if (entries.length === 0) {
                return {
                        totalEvents: 0,
                        earliestEvent: null,
                        latestEvent: null,
                        topEvents: [],
                        fileSizeBytes,
                        errorCount: 0,
                };
        }

        const eventCounts = new Map<string, number>();
        let errorCount = 0;
        let earliest = entries[0]!.timestamp;
        let latest = entries[0]!.timestamp;

        for (const entry of entries) {
                eventCounts.set(entry.event, (eventCounts.get(entry.event) ?? 0) + 1);
                // Count events that look like errors: name contains 'error' (case-insensitive)
                // or 'failed' (case-insensitive) — covers 'error.occurred', 'agent.taskFailed',
                // 'provider.connectionFailed', etc.
                const lowerEvent = entry.event.toLowerCase();
                if (lowerEvent.includes('error') || lowerEvent.includes('failed')) {
                        errorCount++;
                }
                if (entry.timestamp < earliest) {
                        earliest = entry.timestamp;
                }
                if (entry.timestamp > latest) {
                        latest = entry.timestamp;
                }
        }

        const topEvents = Array.from(eventCounts.entries())
                .map(([event, count]) => ({ event, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

        return {
                totalEvents: entries.length,
                earliestEvent: earliest,
                latestEvent: latest,
                topEvents,
                fileSizeBytes,
                errorCount,
        };
}
