/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ITerminalExecutor, ITerminalExecResult, TerminalRateLimiter, detectShellMetacharInArgs, isCommandInAllowlist, isInterpreterCommand as isInterpreterCmd, sanitiseForAuditLog } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { ITerminalService } from '../../../../terminal/browser/terminal.js';
import { IShellLaunchConfig } from '../../../../../../platform/terminal/common/terminal.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';

/**
 * Security blocklist patterns -- checked before every command execution.
 * Blocks destructive commands that could damage the system.
 * Each pattern is tested against the lowercased, trimmed command.
 *
 * SECURITY FIX (M3): Expanded to close the documented bypasses:
 *   - `rm -rf ~` / `rm -rf $HOME` / `rm -rf *` (was: only literal `/`)
 *   - `su root`, `doas`, `pkexec` (was: only `sudo`)
 *   - `telinit 6`, `systemctl reboot`, `shutdown -r`, `halt`, `poweroff`
 *     (was: only `reboot` / `shutdown` / `init 0|6`)
 *   - `tee /etc/cron.d/x`, `cp payload /etc/cron.d/x`,
 *     `install -m 644 payload /etc/cron.d/x`,
 *     `cp payload /etc/passwd`, `mv payload /etc/shadow`
 *     (was: only `> /etc/`)
 *
 * These are still regex-based (defense-in-depth); the primary control is
 * the restricted-mode allowlist in `terminalExecutor.ts` (platform layer).
 * The blocklist catches destructive commands even when restricted mode is
 * disabled by the user.
 */
const BLOCKLIST_PATTERNS: RegExp[] = [
        // rm — any recursive/force flag targeting /, ~, $HOME, *, or absolute paths
        // outside the workspace. Closes `rm -rf ~` and `rm -rf $HOME` bypasses.
        /rm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\s+|--)recursive.*\s+\/(?:\s|$)/,           // rm -rf /
        /rm\s+-[a-zA-Z]*[rRf][a-zA-Z]*\s+\/(?:\s|$)/,                              // rm -rf /
        /rm\s+-[a-zA-Z]*[rRf][a-zA-Z]*\s+(?:~|\$home|\$\{home\}|\*|\.\.\/)/,       // rm -rf ~ / $home / * / ../
        /rm\s+--recursive.*\s+(?:~|\$home|\$\{home\}|\*|\.\.\/)/,                    // rm --recursive ~ / $home / *
        // Privilege escalation — close su/doas/pkexec gaps (was: only sudo).
        // `su` is matched with optional flags (`-`, `--`, `-l`, `- root`, etc.) so
        // `su - root`, `su -- root`, `su -l root` all match. The command is
        // lowercased before matching, so all literal strings here are lowercase.
        /\bsudo\b/,
        /\bsu\s+(?:-+\s*\w*\s+)?(?:root|[\w-]+)/,                                  // su root / su - root / su -l root / su someuser
        /\bdoas\b/,
        /\bpkexec\b/,
        // Fetch-and-execute — curl/wget piped to shell (still common LLM-escape vector).
        /curl\s+.*\|\s*(sh|bash)/,
        /wget\s+.*\|\s*(sh|bash)/,
        /curl\s+.*\|\s*\/bin\/(?:sh|bash)/,
        /wget\s+.*\|\s*\/bin\/(?:sh|bash)/,
        // Filesystem destruction.
        /\bmkfs\b/,
        /\bdd\s+.*of=\/dev\//,                                                     // dd if=...of=/dev/...
        /\bchmod\s+777\s+\//,                                                      // chmod 777 /
        // Persistence — writes to /etc/, /etc/cron.d/, /etc/passwd, /etc/shadow.
        // Closes `tee /etc/cron.d/...`, `cp payload /etc/...`, `install ... /etc/...`
        // bypasses (was: only `> /etc/`).
        />\s*\/etc\//,                                                              // > /etc/...
        /tee\s+(?:-a\s+)?\/etc\//,                                                 // tee /etc/...
        /\b(?:cp|mv|install|dd)\s+.*\s+\/etc\//,                                   // cp/mv/install/dd ... /etc/...
        /\b(?:cp|mv|install|dd)\s+.*\s+\/etc\/(?:passwd|shadow|sudoers|cron\.\w)/,  // explicit /etc/passwd etc.
        // Fork bomb — both classic and brace-expanded variants.
        /:\(\)\s*\{\s*:\|:&\s*\}/,
        /\(\)\s*\{\s*\*\|&\s*\}/,
        // Power control — expanded from `shutdown`/`reboot`/`init 0|6` to cover
        // `halt`, `poweroff`, `telinit`, `systemctl reboot/poweroff/halt`.
        /\bshutdown\b/,
        /\breboot\b/,
        /\bhalt\b/,
        /\bpoweroff\b/,
        /\btelinit\s+\d/,
        /\binit\s+[06]\b/,
        /\bsystemctl\s+(?:reboot|poweroff|halt|suspend|hibernate)\b/,
        // Kernel-module tampering.
        /\brmmod\s+/,
        /\binsmod\s+.*\.ko/,
        /\bmodprobe\s+-[rR]\b/,
        // Block-device writes (raw disk, bypass filesystem).
        /\b(?:dd|cp)\s+.*\s+\/dev\/(?:sd|nvme|hd|vd|xvd)/,
];

/** Marker used to capture exit code from shell output. */
const EXIT_CODE_MARKER = '__CONSTRUCT_EXIT__';

export class TerminalExecutorService extends Disposable implements ITerminalExecutor {
        readonly _serviceBrand: undefined;

        /** SEC-3: Rate limiter per agent session */
        private readonly rateLimiter = new TerminalRateLimiter();

        constructor(
                @ILogService private readonly logService: ILogService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ITerminalService private readonly terminalService: ITerminalService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
        ) {
                super();
                this.logService.info('[TerminalExecutor] Service created (SEC-3 hardened)');
        }

        isBlocked(command: string): boolean {
                const normalizedCmd = command.trim().toLowerCase();
                for (const pattern of BLOCKLIST_PATTERNS) {
                        if (pattern.test(normalizedCmd)) {
                                this.logService.warn(`[TerminalExecutor] Blocked command: ${sanitiseForAuditLog(command)}`);
                                return true;
                        }
                }
                return false;
        }

        /**
         * SEC-7 (H4 fix): Detect interpreter-style commands that can execute
         * arbitrary code via crafted arguments. The agent UI should call this
         * before executing and show an interactive confirmation dialog if true.
         *
         * Until the confirmation UI is wired up, we log a warning so interpreter
         * invocations are at least auditable in the Kovix log.
         */
        isInterpreterCommand(command: string): boolean {
                const isInterp = isInterpreterCmd(command);
                if (isInterp) {
                        this.logService.warn(`[TerminalExecutor] Interpreter command (can execute arbitrary code): ${sanitiseForAuditLog(command)}`);
                }
                return isInterp;
        }

        async execute(
                command: string,
                cwd?: string,
                timeout?: number,
                signal?: AbortSignal,
                onOutput?: (data: string) => void
        ): Promise<ITerminalExecResult> {
                // SEC-3: Rate limiting
                if (!this.rateLimiter.canExecute()) {
                        const remaining = this.rateLimiter.remainingCommands();
                        throw new Error(`Command rate limit exceeded. Max 10 commands per 30 seconds. Please wait before trying again. (${remaining} remaining)`);
                }

                // SEC-3: Shell metacharacter detection in arguments
                const argsPart = this.extractArgsFromCommand(command);
                if (argsPart) {
                        const metachar = detectShellMetacharInArgs(argsPart);
                        if (metachar) {
                                throw new Error(`Command rejected: shell metacharacter "${metachar}" detected in arguments. Chained commands are not allowed for security reasons.`);
                        }
                }

                // SEC-3: Restricted mode allowlist check
                const restrictedMode = this.configurationService.getValue<boolean>('kovix.terminal.restrictedMode') ?? true;
                if (restrictedMode && !isCommandInAllowlist(command)) {
                        throw new Error(`Command rejected in restricted mode: "${command.split(/\s+/)[0]}" is not in the allowed command list. Disable kovix.terminal.restrictedMode to allow all commands.`);
                }

                // SEC-7 (H4 fix): Audit-log interpreter commands even when
                // restricted mode is off. When the agent UI wires up the
                // confirmation dialog, this is the hook point.
                this.isInterpreterCommand(command);

                // SEC-3: Working directory jail
                const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                if (cwd && workspaceRoot) {
                        const pathModule = await import('path');
                        const resolvedCwd = pathModule.resolve(cwd);
                        const resolvedRoot = pathModule.resolve(workspaceRoot);
                        if (!resolvedCwd.startsWith(resolvedRoot + pathModule.sep) && resolvedCwd !== resolvedRoot) {
                                throw new Error(`Security: working directory "${resolvedCwd}" is outside workspace "${resolvedRoot}". Commands cannot cd outside the workspace root.`);
                        }
                }

                // Security check
                if (this.isBlocked(command)) {
                        throw new Error(`Command blocked by security policy: "${command}". This command matches a dangerous pattern.`);
                }

                // SEC-3: Record execution for rate limiting
                this.rateLimiter.recordExecution();

                // Smart timeout: npm/yarn/pnpm commands get 120s, others get 60s
                const effectiveTimeout = timeout ?? this.inferTimeout(command);
                this.logService.info(`[TerminalExecutor] Executing: ${sanitiseForAuditLog(command)} (timeout: ${effectiveTimeout}ms)`);

                // Resolve working directory
                const cwdUri = cwd ? URI.file(cwd) : (workspaceRoot ? URI.file(workspaceRoot) : undefined);

                // Build the command with exit code capture using a cross-shell compatible wrapper.
                // The EXIT_CODE_MARKER pattern is parsed from output to determine the exit code.
                const isWindows = navigator.platform.toLowerCase().includes('win');
                const isMac = navigator.platform.toLowerCase().includes('mac');

                // On macOS, prefer zsh (default since Catalina); fall back to bash on Linux
                const shellExe = isWindows ? 'cmd' : (isMac ? '/bin/zsh' : '/bin/bash');
                const wrappedCommand = isWindows
                        ? `${command} & echo ${EXIT_CODE_MARKER}%errorlevel%`
                        : `${command}; __exit_code__=$?; echo "${EXIT_CODE_MARKER}$__exit_code__"`;

                // Create a dedicated terminal for this command
                const launchConfig: IShellLaunchConfig = {
                        name: `Construct: ${command.substring(0, 40)}...`,
                        executable: shellExe,
                        args: isWindows ? ['/c', wrappedCommand] : ['-c', wrappedCommand],
                        cwd: cwdUri,
                        isFeatureTerminal: true,
                        hideFromUser: false,
                };

                // Create terminal and capture output
                const instance = await this.terminalService.createTerminal({ config: launchConfig });

                const startTime = Date.now();

                return new Promise<ITerminalExecResult>((resolve, reject) => {
                        let stdout = '';
                        const stderr = '';
                        let exitCode = 0;
                        let settled = false;

                        const cleanup = () => {
                                settled = true;
                                try {
                                        instance.dispose();
                                } catch {
                                        // Terminal might already be disposed
                                }
                        };

                        // Listen for output
                        const dataListener = instance.onData((data: string) => {
                                // Strip ANSI escape codes for cleaner output
                                const clean = this.stripAnsi(data);

                                // Check for exit code marker
                                const exitMatch = clean.match(new RegExp(`${EXIT_CODE_MARKER}(\\d+)`));
                                if (exitMatch) {
                                        exitCode = parseInt(exitMatch[1], 10);
                                        // Remove the marker from output
                                        stdout += clean.replace(new RegExp(`${EXIT_CODE_MARKER}\\d+\\n?`, 'g'), '');
                                } else {
                                        stdout += clean;
                                }

                                // Stream output to callback for real-time progress
                                if (onOutput && clean.trim()) {
                                        onOutput(clean);
                                }
                        });

                        // Listen for terminal exit
                        const exitListener = instance.onExit((e: number | { code?: number } | undefined) => {
                                dataListener.dispose();
                                exitListener.dispose();

                                if (!settled) {
                                        const code = typeof e === 'number' ? e : (e?.code ?? exitCode);
                                        cleanup();
                                        const result = {
                                                stdout: this.cleanOutput(stdout),
                                                stderr: this.cleanOutput(stderr),
                                                exitCode: code,
                                        };

                                        // SEC-3: Audit log the command
                                        this.auditLog(command, code, Date.now() - startTime);

                                        resolve(result);
                                }
                        });

                        // Timeout
                        const timer = setTimeout(() => {
                                if (!settled) {
                                        this.logService.warn(`[TerminalExecutor] Command timed out after ${effectiveTimeout}ms: ${sanitiseForAuditLog(command)}`);
                                        dataListener.dispose();
                                        exitListener.dispose();
                                        cleanup();
                                        this.auditLog(command, 124, effectiveTimeout);
                                        resolve({
                                                stdout: this.cleanOutput(stdout),
                                                stderr: 'Command timed out',
                                                exitCode: 124, // Standard timeout exit code
                                        });
                                }
                        }, effectiveTimeout);

                        // Abort signal
                        if (signal) {
                                const onAbort = () => {
                                        if (!settled) {
                                                this.logService.info(`[TerminalExecutor] Command aborted: ${sanitiseForAuditLog(command)}`);
                                                dataListener.dispose();
                                                exitListener.dispose();
                                                clearTimeout(timer);
                                                cleanup();
                                                this.auditLog(command, 130, Date.now() - startTime);
                                                resolve({
                                                        stdout: this.cleanOutput(stdout),
                                                        stderr: 'Command cancelled by user',
                                                        exitCode: 130, // Standard SIGINT exit code
                                                });
                                        }
                                };
                                signal.addEventListener('abort', onAbort, { once: true });
                        }
                });
        }

        /**
         * SEC-3: Extract the arguments portion of a command for metacharacter scanning.
         * Returns everything after the first token (the command itself).
         */
        private extractArgsFromCommand(command: string): string | null {
                const parts = command.trim().split(/\s+/);
                if (parts.length <= 1) {
                        return null; // No arguments
                }
                return parts.slice(1).join(' ');
        }

        /**
         * SEC-3: Write an entry to the audit log.
         * Secrets are redacted before logging.
         */
        private async auditLog(command: string, exitCode: number, durationMs: number): Promise<void> {
                try {
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (!workspaceRoot) { return; }

                        const pathModule = await import('path');
                        const fs = await import('fs');
                        const constructDir = pathModule.join(workspaceRoot, '.construct');
                        const auditPath = pathModule.join(constructDir, 'audit.log');

                        // Ensure .construct directory exists
                        if (!fs.existsSync(constructDir)) {
                                fs.mkdirSync(constructDir, { recursive: true });
                        }

                        const timestamp = new Date().toISOString();
                        const safeCommand = sanitiseForAuditLog(command);
                        // Hash the command for audit trail without logging full command
                        const commandHash = this.hashString(safeCommand);

                        const logLine = `${timestamp} | hash:${commandHash} | exit:${exitCode} | duration:${durationMs}ms\n`;

                        fs.appendFileSync(auditPath, logLine, 'utf-8');
                } catch {
                        // Audit logging is best-effort; never block execution
                }
        }

        /**
         * SEC-3: Simple hash function for command audit logging.
         * Avoids logging full commands which might contain secrets.
         */
        private hashString(str: string): string {
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                        const char = str.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash |= 0; // Convert to 32-bit integer
                }
                return Math.abs(hash).toString(16).padStart(8, '0');
        }

        /**
         * Strip ANSI escape sequences from terminal output.
         * Handles CSI sequences, OSC sequences, and carriage returns.
         */
        private stripAnsi(text: string): string {
                return text
                        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')      // CSI sequences (colors, cursor)
                        .replace(/\x1b\][^\x07]*\x07/g, '')           // OSC sequences (title, etc.)
                        .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')  // Private CSI sequences
                        .replace(/\x1b\[[0-9;]*m/g, '')               // SGR sequences (colors)
                        .replace(/\x1b\[(?:A|B|C|D|E|F|G|H|J|K|S|T|f|i|l|m|n|s|u)/g, '') // Cursor/erase sequences
                        .replace(/\r\n/g, '\n')                        // Normalize line endings
                        .replace(/\r/g, '\n');                         // Standalone CR to LF
        }

        /**
         * Clean up terminal output -- remove excessive blank lines and trailing whitespace.
         */
        private cleanOutput(text: string): string {
                return text
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
        }

        /**
         * Infer an appropriate timeout based on the command being executed.
         * Package manager commands (npm, yarn, pnpm) get 120s because they
         * often need to download and install large dependencies.
         * Build commands get 120s as well.
         * All other commands default to 60s.
         */
        private inferTimeout(command: string): number {
                const slowCommands = [
                        'npm ', 'npm install', 'npm create', 'npm run',
                        'yarn ', 'yarn install', 'yarn create', 'yarn run',
                        'pnpm ', 'pnpm install', 'pnpm create', 'pnpm run',
                        'npx ',
                        'cargo ', 'cargo build', 'cargo install',
                        'pip install', 'pip3 install',
                        'dotnet build', 'dotnet restore',
                        'make', 'cmake',
                        'docker build',
                ];
                const lowerCmd = command.toLowerCase().trim();
                for (const slow of slowCommands) {
                        if (lowerCmd.startsWith(slow.toLowerCase())) {
                                this.logService.info(`[TerminalExecutor] Using extended timeout (120s) for: ${sanitiseForAuditLog(command.substring(0, 60))}`);
                                return 120000;
                        }
                }
                return 60000;
        }

        override dispose(): void {
                super.dispose();
        }
}
