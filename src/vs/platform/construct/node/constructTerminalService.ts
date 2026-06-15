// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalExecutor, ITerminalExecResult, sanitiseForAuditLog, TerminalRateLimiter,
        detectShellMetacharInArgs, isCommandInAllowlist, isDangerousCommand } from '../common/terminal/terminalExecutor.js';
import { ILogService } from '../../log/common/log.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Node-layer terminal execution service.
 * Executes shell commands with full OS access via child_process.
 * This replaces the browser-layer child_process usage (P0-4 fix).
 *
 * SEC-3 hardened with:
 * - Unified dangerous command blocklist (isDangerousCommand)
 * - Shell metacharacter detection in arguments
 * - Restricted mode allowlist
 * - Working directory jail
 * - Rate limiting
 * - Audit logging with secret redaction
 */
export class TerminalNodeService extends Disposable implements ITerminalExecutor {
        declare readonly _serviceBrand: undefined;

        private readonly _rateLimiter = new TerminalRateLimiter();

        constructor(
                @ILogService private readonly logService: ILogService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
        ) {
                super();
                this.logService.info('[TerminalNode] Service created (SEC-3 hardened)');
        }

        isBlocked(command: string): boolean {
                // SEC-6: Use the unified dangerous command patterns from common module
                return isDangerousCommand(command);
        }

        async execute(
                command: string,
                cwd?: string,
                timeout?: number,
                signal?: AbortSignal,
                onOutput?: (data: string) => void
        ): Promise<ITerminalExecResult> {
                // SEC-3: Shell metacharacter detection in arguments
                const parts = command.trim().split(/\s+/);
                if (parts.length > 1) {
                        const argsPart = parts.slice(1).join(' ');
                        const metachar = detectShellMetacharInArgs(argsPart);
                        if (metachar) {
                                this.logService.error(`[TerminalNode] Blocked shell metacharacter "${metachar}" in arguments`);
                                throw new Error(`Command rejected: shell metacharacter "${metachar}" detected in arguments. Chained commands are not allowed for security reasons.`);
                        }
                }

                // SEC-3: Restricted mode allowlist check
                const restrictedMode = this.configurationService?.getValue<boolean>('construct.terminal.restrictedMode') ?? true;
                if (restrictedMode && !isCommandInAllowlist(command)) {
                        this.logService.error(`[TerminalNode] Command rejected in restricted mode: ${sanitiseForAuditLog(command).substring(0, 60)}`);
                        throw new Error(`Command rejected in restricted mode: "${command.split(/\s+/)[0]}" is not in the allowed command list.`);
                }

                // SEC-6: Check unified blocklist
                if (this.isBlocked(command)) {
                        const msg = `[TerminalNode] Blocked dangerous command: ${sanitiseForAuditLog(command).substring(0, 80)}`;
                        this.logService.error(msg);
                        throw new Error('Command blocked by security policy');
                }

                // SEC-3: Working directory jail
                if (cwd) {
                        // In a workspace context, verify cwd is within workspace root
                        // This is a basic safeguard — the browser layer enforces the full jail
                        if (path.isAbsolute(cwd) && cwd.includes('..')) {
                                this.logService.error(`[TerminalNode] Path traversal in cwd: ${sanitiseForAuditLog(cwd)}`);
                                throw new Error('Security: path traversal in working directory is not allowed');
                        }
                }

                // Security: check rate limit
                if (!this._rateLimiter.canExecute()) {
                        this.logService.warn('[TerminalNode] Rate limit exceeded');
                        throw new Error('Terminal rate limit exceeded — too many commands');
                }

                // Security: audit log (redacted)
                this.logService.info(`[TerminalNode] Executing: ${sanitiseForAuditLog(command).substring(0, 100)}`);
                this._rateLimiter.recordExecution();

                // SEC-3: Write to audit log file
                this.writeAuditLog(command, cwd);

                return new Promise((resolve) => {
                        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
                        const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

                        const child = execFile(shell, shellArgs, {
                                cwd,
                                timeout: timeout ?? 60000,
                                maxBuffer: 1024 * 1024 * 10, // 10MB
                        }, (error, stdout, stderr) => {
                                const exitCode = error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0;
                                if (error) {
                                        this.logService.warn(`[TerminalNode] Command failed (exit ${exitCode}): ${sanitiseForAuditLog(command).substring(0, 50)}`);
                                }
                                resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: typeof exitCode === 'number' ? exitCode : 1 });
                        });

                        // Handle abort signal
                        if (signal) {
                                const onAbort = () => {
                                        child.kill('SIGTERM');
                                        signal.removeEventListener('abort', onAbort);
                                };
                                signal.addEventListener('abort', onAbort);
                                child.on('exit', () => {
                                        signal.removeEventListener('abort', onAbort);
                                });
                        }

                        // Stream output if callback provided
                        if (onOutput) {
                                child.stdout?.on('data', (data: Buffer) => {
                                        // Strip ANSI escape codes for clean output
                                        const cleaned = data.toString().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
                                        if (cleaned) { onOutput(cleaned); }
                                });
                        }
                });
        }

        /**
         * SEC-3: Write an entry to the audit log file.
         * Best-effort — never blocks execution.
         */
        private writeAuditLog(command: string, cwd?: string): void {
                try {
                        const auditDir = cwd ? path.join(cwd, '.construct') : undefined;
                        if (!auditDir) { return; }

                        if (!fs.existsSync(auditDir)) {
                                fs.mkdirSync(auditDir, { recursive: true });
                        }

                        const auditPath = path.join(auditDir, 'audit.log');
                        const timestamp = new Date().toISOString();
                        const safeCommand = sanitiseForAuditLog(command);
                        const logLine = `${timestamp} | cmd:${safeCommand.substring(0, 100)} | cwd:${cwd ?? 'default'}\n`;
                        fs.appendFileSync(auditPath, logLine, 'utf-8');
                } catch {
                        // Audit logging is best-effort; never block execution
                }
        }
}
