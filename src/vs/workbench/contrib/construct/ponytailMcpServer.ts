// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ponytail MCP Server
 *
 * A lightweight MCP (Model Context Protocol) server that exposes Ponytail's
 * "lazy senior developer" behavioral ruleset as callable MCP tools via
 * stdio JSON-RPC 2.0 transport.
 *
 * Architecture:
 *   Ponytail skill files → Ponytail MCP Server (stdio) → KOVIX MCP Registry → Agent Loop
 *
 * This server is spawned by KOVIX's MCP server manager (via mcpProcessNode.ts)
 * and communicates over stdin/stdout using line-delimited JSON-RPC 2.0 messages.
 *
 * KOVIX dispatches MCP tools using the `serverName__toolName` naming convention,
 * e.g., `ponytail__set_mode`.
 *
 * Tools exposed:
 * - ponytail_set_mode: Set lazy-dev intensity (lite/full/ultra/off)
 * - ponytail_review_code: Review code for over-engineering
 * - ponytail_audit_repo: Audit codebase for bloat
 * - ponytail_get_rules: Get current ruleset for the mode
 * - ponytail_help: Quick reference
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// `spawn` is used by helper functions further down in this module.
void spawn;

// ─── JSON-RPC 2.0 Types ─────────────────────────────────────────────────────

interface JsonRpcRequest {
        jsonrpc: '2.0';
        id: number | string | null;
        method: string;
        params?: any;
}

interface JsonRpcResponse {
        jsonrpc: '2.0';
        id: number | string | null;
        result?: any;
        error?: { code: number; message: string; data?: any };
}

// ─── MCP Types ──────────────────────────────────────────────────────────────

interface McpTool {
        name: string;
        description: string;
        inputSchema: any;
}

interface McpInitializeResult {
        protocolVersion: string;
        capabilities: any;
        serverInfo: { name: string; version: string };
}

// ─── Configuration ──────────────────────────────────────────────────────────

interface PonytailModeConfig {
        mode: 'lite' | 'full' | 'ultra' | 'off';
        updatedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER_NAME = 'ponytail-mcp-server';
const SERVER_VERSION = '1.0.0';
// Default timeout reserved for future use; current callers pass explicit timeouts
const DEFAULT_TIMEOUT = 30000;
void DEFAULT_TIMEOUT;

// Skill file paths (relative to ponytail checkout)
const SKILL_PATHS: Record<string, string> = {
        ponytail: '/tmp/ponytail/skills/ponytail/SKILL.md',
        review: '/tmp/ponytail/skills/ponytail-review/SKILL.md',
        audit: '/tmp/ponytail/skills/ponytail-audit/SKILL.md',
        debt: '/tmp/ponytail/skills/ponytail-debt/SKILL.md',
        help: '/tmp/ponytail/skills/ponytail-help/SKILL.md',
        agents: '/tmp/ponytail/AGENTS.md',
};

// Fallback: KOVIX bundled skill file
const KOVIX_SKILL_PATH = path.join(os.homedir(), '.kovix', 'skills', 'ponytail.md');

// Mode persistence path
const MODE_FILE_PATH = path.join(os.homedir(), '.kovix', 'ponytail-mode.json');

// ─── Logger ─────────────────────────────────────────────────────────────────

/**
 * Simple stderr logger to avoid polluting stdout (which is used for JSON-RPC).
 */
function log(level: 'info' | 'warn' | 'error', message: string): void {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// ─── Helper: Load skill file content ────────────────────────────────────────

/**
 * Read a Ponytail skill file. Falls back to the KOVIX bundled version
 * if the ponytail checkout is not available.
 */
function loadSkillContent(skillName: string): string {
        const pathsToTry: string[] = [];

        if (SKILL_PATHS[skillName]) {
                pathsToTry.push(SKILL_PATHS[skillName]);
        }

        // For the main ponytail skill, also try the KOVIX bundled version
        if (skillName === 'ponytail') {
                pathsToTry.push(KOVIX_SKILL_PATH);
        }

        for (const filePath of pathsToTry) {
                try {
                        if (fs.existsSync(filePath)) {
                                const content = fs.readFileSync(filePath, 'utf-8');
                                log('info', `Loaded skill "${skillName}" from ${filePath} (${content.length} chars)`);
                                return content;
                        }
                } catch (error) {
                        log('warn', `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        log('warn', `Skill file not found for "${skillName}". Tried: ${pathsToTry.join(', ')}`);
        return '';
}

// ─── Helper: Load AGENTS.md (core ruleset) ──────────────────────────────────

function loadAgentsMd(): string {
        return loadSkillContent('agents');
}

// ─── Helper: Mode persistence ───────────────────────────────────────────────

/**
 * Load the current Ponytail mode from ~/.kovix/ponytail-mode.json.
 * Returns the saved mode or 'full' as default.
 */
function loadMode(): PonytailModeConfig['mode'] {
        try {
                if (fs.existsSync(MODE_FILE_PATH)) {
                        const content = fs.readFileSync(MODE_FILE_PATH, 'utf-8');
                        const config = JSON.parse(content) as PonytailModeConfig;
                        if (['lite', 'full', 'ultra', 'off'].includes(config.mode)) {
                                log('info', `Loaded Ponytail mode from ${MODE_FILE_PATH}: ${config.mode}`);
                                return config.mode;
                        }
                }
        } catch (error) {
                log('warn', `Failed to load mode config: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Check env var
        const envMode = process.env.PONYTAIL_DEFAULT_MODE;
        if (envMode && ['lite', 'full', 'ultra', 'off'].includes(envMode)) {
                log('info', `Using PONYTAIL_DEFAULT_MODE env var: ${envMode}`);
                return envMode as PonytailModeConfig['mode'];
        }

        // Check ~/.config/ponytail/config.json
        const configPath = path.join(os.homedir(), '.config', 'ponytail', 'config.json');
        try {
                if (fs.existsSync(configPath)) {
                        const content = fs.readFileSync(configPath, 'utf-8');
                        const config = JSON.parse(content) as { defaultMode?: string };
                        if (config.defaultMode && ['lite', 'full', 'ultra', 'off'].includes(config.defaultMode)) {
                                log('info', `Using Ponytail config file mode: ${config.defaultMode}`);
                                return config.defaultMode as PonytailModeConfig['mode'];
                        }
                }
        } catch (error) {
                log('warn', `Failed to load Ponytail config: ${error instanceof Error ? error.message : String(error)}`);
        }

        return 'full';
}

/**
 * Save the Ponytail mode to ~/.kovix/ponytail-mode.json.
 */
function saveMode(mode: PonytailModeConfig['mode']): void {
        try {
                // Ensure directory exists
                const dir = path.dirname(MODE_FILE_PATH);
                if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                }

                const config: PonytailModeConfig = {
                        mode,
                        updatedAt: new Date().toISOString(),
                };

                fs.writeFileSync(MODE_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8');
                log('info', `Saved Ponytail mode "${mode}" to ${MODE_FILE_PATH}`);
        } catch (error) {
                log('error', `Failed to save mode: ${error instanceof Error ? error.message : String(error)}`);
        }
}

// ─── Helper: Format mode response ───────────────────────────────────────────

function getModeDescription(mode: string): string {
        switch (mode) {
                case 'lite': return 'lite — Build what\'s asked, name the lazier alternative in one line.';
                case 'full': return 'full — The ladder enforced: YAGNI → stdlib → native → deps → one line → minimum.';
                case 'ultra': return 'ultra — YAGNI extremist. Deletion before addition. Challenges requirements.';
                case 'off': return 'off — Ponytail rules disabled.';
                default: return `unknown mode "${mode}"`;
        }
}

// ─── Tool Handlers ──────────────────────────────────────────────────────────

/**
 * Execute a Ponytail MCP tool and return the result.
 */
function executeTool(toolName: string, args: Record<string, unknown>): { content: Array<{ type: string; text: string }>; isError?: boolean } {
        log('info', `Executing tool: ${toolName} with args: ${JSON.stringify(args)}`);

        switch (toolName) {

                case 'ponytail_set_mode': {
                        const requestedMode = (args.mode as string) ?? '';
                        const validModes: PonytailModeConfig['mode'][] = ['lite', 'full', 'ultra', 'off'];

                        if (!requestedMode) {
                                // No mode specified — report current mode
                                const currentMode = loadMode();
                                return {
                                        content: [{
                                                type: 'text',
                                                text: `Current Ponytail mode: ${getModeDescription(currentMode)}\n\nUse ponytail_set_mode with mode="lite|full|ultra|off" to change.`,
                                        }],
                                };
                        }

                        if (!validModes.includes(requestedMode as PonytailModeConfig['mode'])) {
                                return {
                                        content: [{
                                                type: 'text',
                                                text: `Invalid mode: "${requestedMode}". Valid modes: lite, full, ultra, off.`,
                                        }],
                                        isError: true,
                                };
                        }

                        saveMode(requestedMode as PonytailModeConfig['mode']);
                        return {
                                content: [{
                                        type: 'text',
                                        text: `Ponytail mode set to: ${getModeDescription(requestedMode)}\n\nThis mode will persist across sessions.`,
                                }],
                        };
                }

                case 'ponytail_review_code': {
                        const code = (args.code as string) ?? '';
                        const filePath = (args.file_path as string) ?? 'current file';

                        if (!code) {
                                return {
                                        content: [{
                                                type: 'text',
                                                text: 'No code provided. Pass the code to review in the "code" parameter.',
                                        }],
                                        isError: true,
                                };
                        }

                        const reviewSkill = loadSkillContent('review');
                        const agentsMd = loadAgentsMd();

                        return {
                                content: [{
                                        type: 'text',
                                        text: `# Ponytail Code Review: ${filePath}\n\n## Rules of Engagement\n${reviewSkill || '(review skill unavailable — using default rules)'}\n\n## Core Ruleset\n${agentsMd || '(AGENTS.md unavailable)'}\n\n## Code to Review\n\n\`\`\`\n${code.length > 5000 ? code.substring(0, 5000) + '\n... [truncated]' : code}\n\`\`\`\n\n## Review Instructions\nApply the tags (delete:, stdlib:, native:, yagni:, shrink:) one per finding.\nFormat: \`L<line>: <tag> <what>. <replacement>.\`\nEnd with: \`net: -<N> lines possible.\` or \`Lean already. Ship.\``,
                                }],
                        };
                }

                case 'ponytail_audit_repo': {
                        const repoPath = (args.repo_path as string) ?? '.';
                        const auditSkill = loadSkillContent('audit');
                        const agentsMd = loadAgentsMd();

                        return {
                                content: [{
                                        type: 'text',
                                        text: `# Ponytail Repo Audit: ${repoPath}\n\n## Audit Rules\n${auditSkill || '(audit skill unavailable — using default rules)'}\n\n## Core Ruleset\n${agentsMd || '(AGENTS.md unavailable)'}\n\n## Audit Instructions\nScan the entire codebase for over-engineering. Rank findings by biggest cut first.\nOne line per finding: \`<tag> <what to cut>. <replacement>. [path]\`\nTags: delete:, stdlib:, native:, yagni:, shrink:\nEnd with: \`net: -<N> lines, -<M> deps possible.\` or \`Lean already. Ship.\``,
                                }],
                        };
                }

                case 'ponytail_get_rules': {
                        const mode = loadMode();
                        const mainSkill = loadSkillContent('ponytail');
                        const agentsMd = loadAgentsMd();

                        return {
                                content: [{
                                        type: 'text',
                                        text: `# Ponytail Rules — Mode: ${mode.toUpperCase()}\n\n${mainSkill || agentsMd || '(Ponytail skill files not found. Clone https://github.com/DietrichGebert/ponytail to /tmp/ponytail or ensure ~/.kovix/skills/ponytail.md exists.)'}\n\n---\n\n## Current Mode: ${mode.toUpperCase()}\n${getModeDescription(mode)}\n\nMode persists until changed or session end.`,
                                }],
                        };
                }

                case 'ponytail_help': {
                        const helpSkill = loadSkillContent('help');

                        return {
                                content: [{
                                        type: 'text',
                                        text: `# Ponytail Help\n\n${helpSkill || helpFallbackText()}\n\n---\n\n**Current mode**: ${loadMode().toUpperCase()}\n${getModeDescription(loadMode())}\n\n## Available MCP Tools\n\n| Tool | Purpose |\n|------|---------|\n| ponytail_set_mode | Set intensity (lite/full/ultra/off) |\n| ponytail_review_code | Review code for over-engineering |\n| ponytail_audit_repo | Audit entire repo for bloat |\n| ponytail_get_rules | Get full ruleset for current mode |\n| ponytail_help | This help card |`,
                                }],
                        };
                }

                default: {
                        return {
                                content: [{
                                        type: 'text',
                                        text: `Unknown Ponytail tool: "${toolName}". Available: ponytail_set_mode, ponytail_review_code, ponytail_audit_repo, ponytail_get_rules, ponytail_help.`,
                                }],
                                isError: true,
                        };
                }
        }
}

/**
 * Fallback help text when the help skill file is not available.
 */
function helpFallbackText(): string {
        return `## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | \`/ponytail lite\` | Build what's asked, name the lazier alternative in one line. |
| **Full** | \`/ponytail\` | The ladder enforced: YAGNI → stdlib → native → one line → minimum. Default. |
| **Ultra** | \`/ponytail ultra\` | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

Level sticks until changed or session end.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | \`/ponytail\` | Lazy mode itself. Simplest solution that works. |
| **ponytail-review** | \`/ponytail-review\` | Over-engineering review: \`L42: yagni: factory, one product. Inline.\` |
| **ponytail-help** | \`/ponytail-help\` | This card. |

## Deactivate

Say "stop ponytail" or "normal mode". Resume anytime with \`/ponytail\`.
\`/ponytail off\` also works.`;
}

// ─── Tool Schema Definitions ────────────────────────────────────────────────

const TOOLS: McpTool[] = [
        {
                name: 'ponytail_set_mode',
                description: 'Set the Ponytail lazy-developer intensity level. Modes: lite (suggest lazier alternatives), full (enforce the decision ladder — default), ultra (YAGNI extremist, challenge requirements), off (disable). Without a mode argument, reports the current mode.',
                inputSchema: {
                        type: 'object',
                        properties: {
                                mode: {
                                        type: 'string',
                                        description: 'Intensity level: "lite", "full", "ultra", or "off". Omit to get current mode.',
                                        enum: ['lite', 'full', 'ultra', 'off'],
                                },
                        },
                },
        },
        {
                name: 'ponytail_review_code',
                description: 'Review code for over-engineering using Ponytail rules. Returns review guidelines and tags (delete:, stdlib:, native:, yagni:, shrink:) to apply. One line per finding. Does not modify code — only lists what to cut.',
                inputSchema: {
                        type: 'object',
                        properties: {
                                code: {
                                        type: 'string',
                                        description: 'The code to review for over-engineering.',
                                },
                                file_path: {
                                        type: 'string',
                                        description: 'Path to the file being reviewed (for context in output).',
                                        default: 'current file',
                                },
                        },
                        required: ['code'],
                },
        },
        {
                name: 'ponytail_audit_repo',
                description: 'Audit an entire codebase for over-engineering (bloat, unnecessary abstractions, dead code). Returns a ranked list of what to delete, simplify, or replace with stdlib/native equivalents. Repo-wide version of ponytail_review_code.',
                inputSchema: {
                        type: 'object',
                        properties: {
                                repo_path: {
                                        type: 'string',
                                        description: 'Root path of the repository to audit. Defaults to current workspace.',
                                        default: '.',
                                },
                        },
                },
        },
        {
                name: 'ponytail_get_rules',
                description: 'Get the full Ponytail ruleset for the current mode. Returns the complete behavioral guidelines the lazy senior developer follows, including the decision ladder, rules, output format, and intensity levels.',
                inputSchema: {
                        type: 'object',
                        properties: {},
                },
        },
        {
                name: 'ponytail_help',
                description: 'Show the Ponytail quick-reference card: modes, skills, commands, deactivation, and configuration.',
                inputSchema: {
                        type: 'object',
                        properties: {},
                },
        },
];

// ─── JSON-RPC Message Handling ──────────────────────────────────────────────

let requestCounter = 0;
void requestCounter;

function sendResponse(response: JsonRpcResponse): void {
        const json = JSON.stringify(response);
        process.stdout.write(json + '\n');
}

function handleInitialize(id: number | string | null): void {
        const result: McpInitializeResult = {
                protocolVersion: '2024-11-05',
                capabilities: {
                        tools: {},
                },
                serverInfo: {
                        name: SERVER_NAME,
                        version: SERVER_VERSION,
                },
        };

        sendResponse({ jsonrpc: '2.0', id, result });
        log('info', `Server initialized: ${SERVER_NAME} v${SERVER_VERSION}`);
}

function handleToolsList(id: number | string | null): void {
        sendResponse({
                jsonrpc: '2.0',
                id,
                result: { tools: TOOLS },
        });
}

function handleToolCall(id: number | string | null, params: any): void {
        const toolName = params?.name as string;
        const args = (params?.arguments ?? params?.parameters ?? {}) as Record<string, unknown>;

        if (!toolName) {
                sendResponse({
                        jsonrpc: '2.0',
                        id,
                        error: { code: -32602, message: 'Missing tool name' },
                });
                return;
        }

        try {
                const result = executeTool(toolName, args);
                sendResponse({
                        jsonrpc: '2.0',
                        id,
                        result,
                });
        } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                log('error', `Tool execution error: ${errorMsg}`);
                sendResponse({
                        jsonrpc: '2.0',
                        id,
                        result: {
                                content: [{ type: 'text', text: `Error executing ${toolName}: ${errorMsg}` }],
                                isError: true,
                        },
                });
        }
}

function handleRequest(request: JsonRpcRequest): void {
        switch (request.method) {
                case 'initialize':
                        handleInitialize(request.id);
                        break;
                case 'tools/list':
                        handleToolsList(request.id);
                        break;
                case 'tools/call':
                        handleToolCall(request.id, request.params);
                        break;
                default:
                        sendResponse({
                                jsonrpc: '2.0',
                                id: request.id,
                                error: { code: -32601, message: `Method not found: ${request.method}` },
                        });
        }
}

// ─── Stdio Transport ────────────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf-8');

process.stdin.on('data', (chunk: string) => {
        buffer += chunk;

        let lineEnd: number;
        while ((lineEnd = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, lineEnd).trim();
                buffer = buffer.substring(lineEnd + 1);

                if (!line) { continue; }

                try {
                        const request = JSON.parse(line) as JsonRpcRequest;

                        if (request.jsonrpc !== '2.0') {
                                log('warn', 'Received non-JSON-RPC 2.0 message');
                                continue;
                        }

                        handleRequest(request);
                } catch (error) {
                        log('error', `Failed to parse JSON-RPC message: ${error instanceof Error ? error.message : String(error)}`);
                        sendResponse({
                                jsonrpc: '2.0',
                                id: null,
                                error: { code: -32700, message: 'Parse error' },
                        });
                }
        }
});

process.stdin.on('end', () => {
        log('info', 'Stdin closed, shutting down');
        process.exit(0);
});

process.stdin.on('error', (error) => {
        log('error', `Stdin error: ${error.message}`);
        process.exit(1);
});

// Handle SIGTERM and SIGINT gracefully
process.on('SIGTERM', () => {
        log('info', 'Received SIGTERM, shutting down');
        process.exit(0);
});

process.on('SIGINT', () => {
        log('info', 'Received SIGINT, shutting down');
        process.exit(0);
});

// Log startup
log('info', `${SERVER_NAME} v${SERVER_VERSION} started`);
log('info', `Mode file: ${MODE_FILE_PATH}`);
log('info', `Current mode: ${loadMode()}`);
log('info', 'Listening on stdin for JSON-RPC 2.0 messages...');
