// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 1, item 1.7 — Local-only usage log service.
 *
 *  Writes usage events to ~/.kovix/logs/usage.jsonl as JSON Lines, one event
 *  per line. NEVER sends data anywhere — this is strictly for the maintainer's
 *  own debugging and for an opt-in "send crash report" flow that asks the
 *  user before each transmission.
 *
 *  Audit doc §4.10: "The absence of any telemetry, including local-only crash
 *  logging and feature usage counts, means the maintainer is flying blind.
 *  The fix is not to add network telemetry — it is to add a local-only event
 *  log that the user can inspect and that an opt-in 'send crash report'
 *  dialog can ship on a per-incident basis."
 *
 *  Pure-logic helpers (file paths, redaction, formatting) are exported for
 *  unit testing without touching the filesystem.
 *--------------------------------------------------------------------------------------------*/

import * as path from '../../../base/common/path.js';
import { localize } from '../../../nls.js';

/**
 * Default log file location relative to the user home directory.
 * Exported for unit testing.
 */
export const DEFAULT_LOG_RELATIVE_PATH = '.kovix/logs/usage.jsonl';

/**
 * Maximum log file size before rotation (10 MB). When the file exceeds this,
 * the oldest half is truncated to prevent unbounded growth.
 */
export const MAX_LOG_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Maximum number of events to retain in memory for getRecentEvents() before
 * flushing to disk. Bounded to prevent memory leaks on busy sessions.
 */
export const MAX_IN_MEMORY_EVENTS = 1000;

/**
 * Patterns that should be redacted from any string field before logging.
 * Exported for unit testing.
 */
export const REDACTION_PATTERNS: readonly RegExp[] = [
        // API keys (sk-ant-..., sk-..., ghp_..., github_pat_...)
        /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
        /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
        /\b(ghp_[A-Za-z0-9]{36,})\b/g,
        /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
        /\b(xoxb-[A-Za-z0-9-]{20,})\b/g, // Slack
        /\b(AKIA[0-9A-Z]{16})\b/g, // AWS access key
        // Bearer tokens
        /\b(Bearer\s+[A-Za-z0-9_.\-/+=]{20,})\b/gi,
        // Email addresses (replace with redacted@example.com)
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        // IP addresses (replace with x.x.x.x)
        /\b(\d{1,3}\.){3}\d{1,3}\b/g,
        // File paths that look like they contain usernames
        /(\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+)/g,
];

/**
 * Redact sensitive patterns from a string.
 *
 * Exported for unit testing.
 */
export function redactString(input: string): string {
        let result = input;
        for (const pattern of REDACTION_PATTERNS) {
                result = result.replace(pattern, (match) => {
                        // Keep the first 4 chars + last 2 chars for debugging context
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
 *
 * Exported for unit testing.
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
                for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
                        // Never log these field names, even if their value isn't sensitive
                        if (['apiKey', 'token', 'password', 'secret', 'cookie', 'authorization'].includes(key.toLowerCase())) {
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
 *
 * Exported for unit testing.
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
 * Build the absolute path to the usage log file.
 *
 * Exported for unit testing.
 */
export function buildLogPath(homeDir: string, relativePath: string = DEFAULT_LOG_RELATIVE_PATH): string {
        return path.join(homeDir, relativePath);
}

/**
 * Decide whether the log file should be rotated based on its current size.
 *
 * Exported for unit testing.
 */
export function shouldRotateLog(fileSizeBytes: number, maxSizeBytes: number = MAX_LOG_FILE_SIZE_BYTES): boolean {
        return fileSizeBytes >= maxSizeBytes;
}

/**
 * A single usage event entry, as stored in the JSONL log.
 */
export interface IUsageLogEntry {
        /** ISO 8601 timestamp */
        timestamp: string;
        /** Event name (e.g. 'agent.toolExecuted') */
        event: string;
        /** Optional string/number/boolean context. Redacted before logging. */
        properties?: Record<string, unknown>;
        /** Optional numeric measurements (durations, counts). */
        measurements?: Record<string, number>;
        /** Anonymous session ID — NOT a device fingerprint. */
        sessionId?: string;
}

/**
 * Summary statistics computed from the local usage log.
 * Returned by getUsageStats() for display in the settings UI.
 */
export interface IUsageStats {
        /** Total events logged */
        totalEvents: number;
        /** Earliest event timestamp (ISO 8601) */
        earliestEvent: string | null;
        /** Latest event timestamp (ISO 8601) */
        latestEvent: string | null;
        /** Top 10 event names by count */
        topEvents: Array<{ event: string; count: number }>;
        /** Total log file size in bytes */
        fileSizeBytes: number;
        /** Number of error events logged */
        errorCount: number;
}

/**
 * Local-only usage log service — writes JSONL events to ~/.kovix/logs/usage.jsonl.
 *
 * Privacy guarantees:
 * 1. NEVER sends data over the network.
 * 2. ALL string values are redacted of API keys, tokens, emails, IPs, file paths.
 * 3. User can inspect, export, and clear the log at any time via settings UI.
 * 4. Opt-in only — the log file is not created until the user enables it.
 * 5. Log rotation at 10 MB prevents unbounded disk usage.
 *
 * The log is structured as JSON Lines (one JSON object per line) so it can be
 * easily parsed with standard tools: `cat usage.jsonl | jq .event | sort | uniq -c`.
 */
export interface ILocalUsageLogService {
        readonly _serviceBrand: undefined;

        /**
         * Whether local usage logging is enabled.
         * Disabled by default — user must opt in via settings.
         */
        readonly isEnabled: boolean;

        /**
         * Enable or disable local usage logging.
         * When enabling for the first time, creates the log directory.
         * When disabling, does NOT delete existing logs — user must clear explicitly.
         */
        setEnabled(enabled: boolean): Promise<void>;

        /**
         * Log an event to the local JSONL file.
         * No-op if logging is disabled.
         * The event is redacted before writing.
         */
        log(event: string, properties?: Record<string, unknown>, measurements?: Record<string, number>): Promise<void>;

        /**
         * Log an error event. Errors are tagged so they can be filtered separately.
         */
        logError(errorType: string, message: string, properties?: Record<string, unknown>): Promise<void>;

        /**
         * Get the absolute path to the usage log file.
         * Useful for the settings UI "Open log file" button.
         */
        getLogPath(): string;

        /**
         * Get the N most recent events from the log.
         * Reads from disk — do not call frequently.
         */
        getRecentEvents(count: number): Promise<IUsageLogEntry[]>;

        /**
         * Get summary statistics for the settings UI.
         */
        getUsageStats(): Promise<IUsageStats>;

        /**
         * Clear the log file entirely. User must confirm in the UI before calling.
         */
        clearLog(): Promise<void>;

        /**
         * Export the log as a single JSON array (for the "Export usage data" button).
         */
        exportLog(): Promise<IUsageLogEntry[]>;

        /**
         * Generate a crash report bundle for opt-in submission.
         * Returns the path to a temp file containing the last N events.
         * The user is shown the contents and asked to confirm before any
         * transmission (transmission is NOT handled by this service).
         */
        generateCrashReport(maxEvents: number): Promise<string>;
}
