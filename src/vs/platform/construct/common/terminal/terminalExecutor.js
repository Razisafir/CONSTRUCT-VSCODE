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
exports.TerminalRateLimiter = exports.FILE_OPERATION_COMMANDS = exports.MAX_OUTPUT_LENGTH = exports.TERMINAL_RATE_LIMIT = exports.DEFAULT_COMMAND_TIMEOUT_S = exports.PRIVILEGE_ESCALATION_BLOCKLIST = exports.DEFAULT_COMMAND_ALLOWLIST = exports.SHELL_METACHAR_BLOCKLIST = exports.ITerminalExecutor = void 0;
exports.sanitiseForAuditLog = sanitiseForAuditLog;
exports.detectShellMetacharInArgs = detectShellMetacharInArgs;
exports.isCommandInAllowlist = isCommandInAllowlist;
exports.isPathWithinWorkspace = isPathWithinWorkspace;
exports.stripAnsiEscapeSequences = stripAnsiEscapeSequences;
exports.sanitiseOutput = sanitiseOutput;
exports.isPrivilegeEscalation = isPrivilegeEscalation;
const instantiation_js_1 = require("../../../instantiation/common/instantiation.js");
const secretRedactor_js_1 = require("../security/secretRedactor.js");
exports.ITerminalExecutor = (0, instantiation_js_1.createDecorator)('construct.terminalExecutor');
/**
 * SEC-3: Shell metacharacters that could chain commands when combined with
 * user-provided arguments. These are stripped/rejected from ARGUMENTS only
 * (not the command itself).
 */
exports.SHELL_METACHAR_BLOCKLIST = [
    ';', '&&', '||', '|', '`', '$(', ')', '{', '}', '>>', '>', '<', '2>',
];
/**
 * SEC-3: Regex patterns for detecting shell metacharacters in arguments.
 */
const SHELL_METACHAR_REGEX = /(;|&&|\|\||`|\$\(|\$\w|\{|}|\d*>|<<<|<>|<|\n|\r)/;
/**
 * SEC-3: Default allowlist for restricted mode.
 * Only these commands are allowed when construct.terminal.restrictedMode is true.
 */
exports.DEFAULT_COMMAND_ALLOWLIST = [
    'ls', 'dir', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc',
    'npm', 'yarn', 'pnpm', 'npx', 'node', 'python', 'python3', 'pip', 'pip3',
    'git', 'cargo', 'rustc', 'go', 'dotnet', 'java', 'javac', 'mvn', 'gradle',
    'make', 'cmake', 'gcc', 'g++', 'clang', 'cargo',
    'echo', 'pwd', 'whoami', 'which', 'where',
    'curl', 'wget',
    'docker', 'podman', 'kubectl',
    'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
    'mkdir', 'touch', 'cp', 'mv',
    'sed', 'awk', 'sort', 'uniq', 'diff', 'patch',
];
/**
 * SEC-P2: Commands that are ALWAYS blocked, even in unrestricted mode.
 * These privilege escalation commands must never be executed without
 * explicit user confirmation.
 */
exports.PRIVILEGE_ESCALATION_BLOCKLIST = [
    'sudo', 'su', 'pkexec', 'doas', 'gosu', 'run0', 'gksudo', 'kdesu',
];
/**
 * SEC-P2: Default command timeout in seconds.
 * Can be configured via construct.terminal.commandTimeout (range: 10-300).
 */
exports.DEFAULT_COMMAND_TIMEOUT_S = 60;
/**
 * SEC-3: Rate limit configuration for terminal commands.
 * Max 10 terminal commands per 30 seconds per agent session.
 */
exports.TERMINAL_RATE_LIMIT = {
    maxCommands: 10,
    windowMs: 30_000,
};
/**
 * SEC-4.2: Maximum output length returned to the agent (in characters).
 * Output exceeding this limit is truncated with a marker.
 */
exports.MAX_OUTPUT_LENGTH = 10_000;
/**
 * SEC-4.2: Commands that perform file-system mutations or read sensitive files.
 * When these commands are used, the target path must be validated against
 * the workspace boundary.
 */
exports.FILE_OPERATION_COMMANDS = [
    'cat', 'head', 'tail', 'less', 'more',
    'ls', 'dir', 'find', 'stat', 'file',
    'rm', 'rmdir', 'cp', 'mv', 'touch', 'mkdir',
    'chmod', 'chown', 'chgrp',
    'ln', 'symlink',
    'tee', 'dd',
];
/**
 * SEC-3: Secret patterns that must NEVER appear in audit logs.
 */
const SECRET_LOG_PATTERNS = [
    /sk-ant-[A-Za-z0-9_-]{20,}/g,
    /sk-[A-Za-z0-9]{20,}/g,
    /Bearer [A-Za-z0-9_.-]{20,}/g,
    /password=\S+/gi,
    /token=\S+/gi,
    /key=\S+/gi,
];
/**
 * SEC-3: Sanitise a command for audit logging — redact any secret patterns.
 */
function sanitiseForAuditLog(text) {
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
function detectShellMetacharInArgs(args) {
    const match = args.match(SHELL_METACHAR_REGEX);
    return match ? match[0] : null;
}
/**
 * SEC-3: Check if a command is in the allowlist (for restricted mode).
 */
function isCommandInAllowlist(command, allowlist) {
    const list = allowlist ?? exports.DEFAULT_COMMAND_ALLOWLIST;
    // Extract the base command (first token)
    const baseCommand = command.trim().split(/\s+/)[0];
    // Handle path-prefixed commands like /usr/bin/git
    const commandName = baseCommand.split('/').pop() ?? baseCommand;
    return list.some(allowed => commandName === allowed);
}
/**
 * SEC-3: Enforce workspace directory jail — prevent cd to paths outside workspace root.
 */
async function isPathWithinWorkspace(filePath, workspaceRoot) {
    const path = await Promise.resolve().then(() => __importStar(require('path')));
    const resolved = path.resolve(filePath);
    const root = path.resolve(workspaceRoot);
    return resolved.startsWith(root + path.sep) || resolved === root;
}
/**
 * SEC-4.2: Strip ANSI escape sequences from terminal output.
 * Handles CSI sequences, OSC sequences, SGR sequences, and carriage returns.
 * Shared between browser and Node layers for consistent output cleaning.
 */
function stripAnsiEscapeSequences(text) {
    return text
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // CSI sequences (colors, cursor)
        .replace(/\x1b\][^\x07]*\x07/g, '') // OSC sequences (title, etc.)
        .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '') // Private CSI sequences
        .replace(/\x1b\[[0-9;]*m/g, '') // SGR sequences (colors)
        .replace(/\x1b\[(?:A|B|C|D|E|F|G|H|J|K|S|T|f|i|l|m|n|s|u)/g, '') // Cursor/erase sequences
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/\r/g, '\n'); // Standalone CR to LF
}
/**
 * SEC-4.2: Sanitise command output before returning to the agent.
 * 1. Strips ANSI escape sequences
 * 2. Redacts secrets (API keys, tokens, passwords)
 * 3. Truncates output longer than MAX_OUTPUT_LENGTH
 */
function sanitiseOutput(text) {
    // 1. Strip ANSI escape sequences
    let result = stripAnsiEscapeSequences(text);
    // 2. Redact secrets (using comprehensive secretRedactor + audit log patterns)
    result = (0, secretRedactor_js_1.redactSecrets)(result);
    result = sanitiseForAuditLog(result);
    // 3. Truncate if too long
    if (result.length > exports.MAX_OUTPUT_LENGTH) {
        result = result.substring(0, exports.MAX_OUTPUT_LENGTH) + '\n[OUTPUT TRUNCATED — exceeded 10,000 characters]';
    }
    return result;
}
/**
 * SEC-P2: Check if a command uses a privilege escalation tool.
 * These commands (sudo, su, pkexec, doas, gosu, run0) are always
 * blocked from automatic execution, even in unrestricted mode.
 */
function isPrivilegeEscalation(command) {
    const baseCommand = command.trim().split(/\s+/)[0];
    const commandName = baseCommand.split('/').pop() ?? baseCommand;
    return exports.PRIVILEGE_ESCALATION_BLOCKLIST.includes(commandName);
}
/**
 * SEC-3: Rate limiter for terminal command execution.
 * Tracks command timestamps per session.
 */
class TerminalRateLimiter {
    commandTimestamps = [];
    /**
     * Check if a new command can be executed within the rate limit.
     * Returns true if the command is allowed, false if rate limited.
     */
    canExecute() {
        const now = Date.now();
        const windowStart = now - exports.TERMINAL_RATE_LIMIT.windowMs;
        // Remove timestamps outside the window
        this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);
        return this.commandTimestamps.length < exports.TERMINAL_RATE_LIMIT.maxCommands;
    }
    /**
     * Record a command execution timestamp.
     */
    recordExecution() {
        this.commandTimestamps.push(Date.now());
    }
    /**
     * Get the number of remaining commands in the current window.
     */
    remainingCommands() {
        const now = Date.now();
        const windowStart = now - exports.TERMINAL_RATE_LIMIT.windowMs;
        this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);
        return Math.max(0, exports.TERMINAL_RATE_LIMIT.maxCommands - this.commandTimestamps.length);
    }
}
exports.TerminalRateLimiter = TerminalRateLimiter;
//# sourceMappingURL=terminalExecutor.js.map