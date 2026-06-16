// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * UI-UX Pro Max MCP Server
 *
 * A lightweight MCP (Model Context Protocol) server that wraps the UI-UX Pro Max
 * Python search engine, exposing design intelligence capabilities as MCP tools via
 * stdio JSON-RPC 2.0 transport.
 *
 * Architecture:
 *   UI-UX Pro Max Python Engine → UI-UX Pro Max MCP Server (stdio) → KOVIX MCP Registry → Agent Loop
 *
 * This server is spawned by KOVIX's MCP server manager (via mcpProcessNode.ts)
 * and communicates over stdin/stdout using line-delimited JSON-RPC 2.0 messages.
 *
 * KOVIX dispatches MCP tools using the `serverName__toolName` naming convention,
 * e.g., `uiux_pro_max__search_style`.
 *
 * Tools exposed:
 * - uiux_search_style: Search UI styles by keyword (67 styles)
 * - uiux_search_color: Search color palettes (161 palettes)
 * - uiux_search_typography: Search font pairings (57 pairings)
 * - uiux_search_ux: Search UX guidelines (99 guidelines)
 * - uiux_generate_design_system: Generate complete design system
 * - uiux_get_stack_guidelines: Get framework-specific guidelines (16 stacks)
 */

import { spawn } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

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

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER_NAME = 'uiux-pro-max-mcp-server';
const SERVER_VERSION = '1.0.0';
const DEFAULT_TIMEOUT = 30000;  // 30s
const LONG_TIMEOUT = 60000;     // 60s for design system generation

// ─── Logger ─────────────────────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error', message: string): void {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// ─── Helper: Resolve skill path ─────────────────────────────────────────────

/**
 * Resolve the path to the UI-UX Pro Max skill installation.
 * Checks the workspace .kovix directory, then falls back to bundled location.
 */
function resolveSkillPath(): string | null {
        const candidates = [
                // Workspace-local installation
                path.join(process.cwd(), '.kovix', 'skills', 'ui-ux-pro-max'),
                // Global installation
                path.join(os.homedir(), '.kovix', 'skills', 'ui-ux-pro-max'),
        ];

        for (const candidate of candidates) {
                const scriptPath = path.join(candidate, 'scripts', 'search.py');
                if (fs.existsSync(scriptPath)) {
                        return candidate;
                }
        }

        return null;
}

// ─── Helper: Execute Python search script ───────────────────────────────────

/**
 * Execute the UI-UX Pro Max Python search script with given arguments.
 */
function executeSearch(
        skillPath: string,
        args: string[],
        timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        return new Promise((resolve) => {
                const startTime = Date.now();
                const scriptPath = path.join(skillPath, 'scripts', 'search.py');

                log('info', `Executing: python3 ${scriptPath} ${args.join(' ')} (timeout: ${timeout}ms)`);

                const child = spawn('python3', [scriptPath, ...args], {
                        env: {
                                ...process.env as Record<string, string>,
                                PYTHONPATH: skillPath,
                        },
                        stdio: ['pipe', 'pipe', 'pipe'],
                        shell: false,
                        cwd: skillPath,
                });

                let stdout = '';
                let stderr = '';
                let killed = false;

                const timeoutTimer = setTimeout(() => {
                        killed = true;
                        log('warn', `Command timed out after ${timeout}ms`);
                        try {
                                child.kill('SIGKILL');
                        } catch {
                                // Process may have already exited
                        }
                        resolve({
                                stdout,
                                stderr: `${stderr}\n[ERROR] Command timed out after ${timeout}ms`.trim(),
                                exitCode: 124,
                        });
                }, timeout);

                child.stdout?.on('data', (data: Buffer) => {
                        stdout += data.toString('utf-8');
                });

                child.stderr?.on('data', (data: Buffer) => {
                        stderr += data.toString('utf-8');
                });

                child.stdin?.end();

                child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
                        if (killed) { return; }
                        clearTimeout(timeoutTimer);

                        const duration = Date.now() - startTime;
                        log('info', `Command completed in ${duration}ms with exitCode=${code}, signal=${signal}`);

                        resolve({
                                stdout,
                                stderr,
                                exitCode: code ?? (signal ? -1 : 0),
                        });
                });

                child.on('error', (error: Error) => {
                        if (killed) { return; }
                        clearTimeout(timeoutTimer);

                        const errorMsg = error instanceof Error ? error.message : String(error);
                        log('error', `Command failed: ${errorMsg}`);

                        resolve({
                                stdout,
                                stderr: `${stderr}\n[ERROR] ${errorMsg}`.trim(),
                                exitCode: -1,
                        });
                });
        });
}

// ─── Tool Command Map ───────────────────────────────────────────────────────

const TOOL_COMMANDS: Record<string, (args: any, skillPath: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>> = {
        /**
         * uiux_search_style — Search UI styles by keyword.
         * Searches across 67 UI styles (Minimalism, Glassmorphism, Brutalism, etc.)
         */
        'uiux_search_style': async (args, skillPath) => {
                const query = args.query as string;
                const maxResults = Math.min(Math.max(parseInt(args.max_results as string || '3', 10), 1), 10);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                return executeSearch(skillPath, [query, '--domain', 'style', '--max-results', String(maxResults)], DEFAULT_TIMEOUT);
        },

        /**
         * uiux_search_color — Search color palettes by product type or mood.
         * Searches across 161 curated color palettes.
         */
        'uiux_search_color': async (args, skillPath) => {
                const query = args.query as string;
                const maxResults = Math.min(Math.max(parseInt(args.max_results as string || '3', 10), 1), 10);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                return executeSearch(skillPath, [query, '--domain', 'color', '--max-results', String(maxResults)], DEFAULT_TIMEOUT);
        },

        /**
         * uiux_search_typography — Search font pairings by mood or style.
         * Searches across 57 curated heading/body font pairings with Google Fonts URLs.
         */
        'uiux_search_typography': async (args, skillPath) => {
                const query = args.query as string;
                const maxResults = Math.min(Math.max(parseInt(args.max_results as string || '3', 10), 1), 10);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                return executeSearch(skillPath, [query, '--domain', 'typography', '--max-results', String(maxResults)], DEFAULT_TIMEOUT);
        },

        /**
         * uiux_search_ux — Search UX guidelines and accessibility best practices.
         * Searches across 99 UX guidelines covering WCAG, touch targets, navigation, etc.
         */
        'uiux_search_ux': async (args, skillPath) => {
                const query = args.query as string;
                const maxResults = Math.min(Math.max(parseInt(args.max_results as string || '3', 10), 1), 10);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                return executeSearch(skillPath, [query, '--domain', 'ux', '--max-results', String(maxResults)], DEFAULT_TIMEOUT);
        },

        /**
         * uiux_generate_design_system — Generate a complete design system recommendation.
         * Multi-domain search + reasoning to produce a full design system with colors,
         * typography, style, layout pattern, and component specs.
         */
        'uiux_generate_design_system': async (args, skillPath) => {
                const query = args.query as string;
                const projectName = args.project_name as string || 'Project';
                const format = args.format as string || 'markdown';
                const persist = args.persist as boolean || false;
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                const searchArgs = [query, '--design-system', '-p', projectName, '--format', format];
                if (persist) {
                        searchArgs.push('--persist');
                }
                return executeSearch(skillPath, searchArgs, LONG_TIMEOUT);
        },

        /**
         * uiux_get_stack_guidelines — Get framework-specific UI guidelines.
         * Searches stack-specific guidelines for 16 supported frameworks.
         */
        'uiux_get_stack_guidelines': async (args, skillPath) => {
                const query = args.query as string;
                const stack = args.stack as string;
                const maxResults = Math.min(Math.max(parseInt(args.max_results as string || '3', 10), 1), 10);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                if (!stack) {
                        throw new Error('Missing required parameter: "stack". Available: react, nextjs, vue, svelte, astro, swiftui, react-native, flutter, nuxtjs, nuxt-ui, html-tailwind, shadcn, jetpack-compose, threejs, angular, laravel');
                }
                return executeSearch(skillPath, [query, '--stack', stack, '--max-results', String(maxResults)], DEFAULT_TIMEOUT);
        },
};

// ─── Tool: List available tools ─────────────────────────────────────────────

function handleListTools(): { tools: McpTool[] } {
        return {
                tools: [
                        {
                                name: 'uiux_search_style',
                                description: 'Search UI/UX styles by keyword. Returns matching styles from a database of 67 UI styles including Minimalism, Glassmorphism, Brutalism, Neumorphism, Aurora, Flat Design, and more. Each result includes style category, keywords, primary colors, effects, animation recommendations, best use cases, framework compatibility, and implementation checklist.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query for UI styles (e.g., "glassmorphism dashboard", "minimalist SaaS", "dark mode gaming")',
                                                },
                                                max_results: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-10, default: 3)',
                                                        default: 3,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'uiux_search_color',
                                description: 'Search color palettes by product type, mood, or keyword. Returns matching palettes from 161 curated color schemes. Each result includes primary, secondary, accent, background, foreground, muted, border, destructive, and ring colors with hex values and CSS variable names.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query for color palettes (e.g., "SaaS blue", "fintech professional", "healthcare calming", "gaming neon")',
                                                },
                                                max_results: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-10, default: 3)',
                                                        default: 3,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'uiux_search_typography',
                                description: 'Search font pairings by mood, style, or use case. Returns matching pairings from 57 curated heading/body font combinations. Each result includes font names, category, mood keywords, best use cases, Google Fonts URL, CSS import code, and Tailwind config.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query for font pairings (e.g., "modern serif heading", "clean sans-serif", "playful startup", "elegant luxury")',
                                                },
                                                max_results: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-10, default: 3)',
                                                        default: 3,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'uiux_search_ux',
                                description: 'Search UX guidelines and accessibility best practices. Returns matching guidelines from 99 UX rules covering WCAG compliance, touch targets, scroll behavior, navigation patterns, keyboard support, animation preferences, and mobile usability. Each result includes category, issue description, do/don\'t examples, code examples, and severity level.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query for UX guidelines (e.g., "touch target size", "keyboard navigation", "focus states", "reduced motion")',
                                                },
                                                max_results: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-10, default: 3)',
                                                        default: 3,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'uiux_generate_design_system',
                                description: 'Generate a complete design system recommendation for a project. This is the main powerhouse tool — it performs multi-domain searches across product type, UI style, color palette, typography, and landing page patterns, then applies reasoning rules to produce a comprehensive design system. Output includes pattern structure, style recommendation, full color palette with hex values, typography pairing, key effects, anti-patterns to avoid, and a pre-delivery checklist.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Description of the project to generate a design system for (e.g., "SaaS dashboard", "e-commerce luxury store", "fintech mobile app", "healthcare portal")',
                                                },
                                                project_name: {
                                                        type: 'string',
                                                        description: 'Optional project name for the design system output. Defaults to the query text.',
                                                        default: 'Project',
                                                },
                                                format: {
                                                        type: 'string',
                                                        description: 'Output format: "ascii" (Unicode box art) or "markdown". Default: "markdown"',
                                                        enum: ['ascii', 'markdown'],
                                                        default: 'markdown',
                                                },
                                                persist: {
                                                        type: 'boolean',
                                                        description: 'If true, save the design system to design-system/MASTER.md in the workspace. Default: false',
                                                        default: false,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'uiux_get_stack_guidelines',
                                description: 'Get framework-specific UI guidelines for a tech stack. Searches stack-specific CSV data for 16 supported frameworks including React, Vue, Svelte, Next.js, Astro, SwiftUI, Flutter, React Native, and more. Returns guidelines for component structure, styling patterns, animation, accessibility, and performance.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query for stack guidelines (e.g., "component structure", "styling patterns", "animation", "routing")',
                                                },
                                                stack: {
                                                        type: 'string',
                                                        description: 'Tech stack identifier. Must be one of: react, nextjs, vue, svelte, astro, swiftui, react-native, flutter, nuxtjs, nuxt-ui, html-tailwind, shadcn, jetpack-compose, threejs, angular, laravel',
                                                },
                                                max_results: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-10, default: 3)',
                                                        default: 3,
                                                },
                                        },
                                        required: ['query', 'stack'],
                                },
                        },
                ],
        };
}

// ─── Tool: Execute a tool call ──────────────────────────────────────────────

async function handleToolCall(
        name: string,
        args: any,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
        log('info', `Tool call: ${name} with args: ${JSON.stringify(args)}`);

        // Resolve skill path
        const skillPath = resolveSkillPath();
        if (!skillPath) {
                return {
                        content: [{
                                type: 'text',
                                text: 'UI-UX Pro Max skill not found. Please ensure the skill is installed at .kovix/skills/ui-ux-pro-max/',
                        }],
                        isError: true,
                };
        }

        try {
                // Validate tool name
                if (!TOOL_COMMANDS[name]) {
                        return {
                                content: [{ type: 'text', text: `Unknown tool: "${name}". Available tools: ${Object.keys(TOOL_COMMANDS).join(', ')}` }],
                                isError: true,
                        };
                }

                // Execute the tool
                const result = await TOOL_COMMANDS[name](args, skillPath);

                // Check for errors
                if (result.exitCode !== 0 && result.exitCode !== 124) {
                        const errorMsg = result.stderr || `Command exited with code ${result.exitCode}`;
                        return {
                                content: [{ type: 'text', text: `[${name}] Error: ${errorMsg}\n\nstdout: ${result.stdout}` }],
                                isError: true,
                        };
                }

                // Return stdout content
                return {
                        content: [{ type: 'text', text: result.stdout || result.stderr || '(no output)' }],
                };

        } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                log('error', `Tool ${name} failed: ${errorMsg}`);
                return {
                        content: [{ type: 'text', text: `[${name}] Error: ${errorMsg}` }],
                        isError: true,
                };
        }
}

// ─── Request Router ─────────────────────────────────────────────────────────

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const { id, method, params } = request;

        // Required by MCP spec: respond to initialize
        if (method === 'initialize') {
                return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                                protocolVersion: '2024-11-05',
                                capabilities: {
                                        tools: {},
                                },
                                serverInfo: {
                                        name: SERVER_NAME,
                                        version: SERVER_VERSION,
                                },
                        } as McpInitializeResult,
                };
        }

        // Required by MCP spec: respond to initialized notification (no response needed)
        if (method === 'initialized') {
                return { jsonrpc: '2.0', id: null, result: {} };
        }

        if (method === 'tools/list') {
                return {
                        jsonrpc: '2.0',
                        id,
                        result: handleListTools(),
                };
        }

        if (method === 'tools/call') {
                const toolName = params?.name as string;
                const toolArgs = params?.arguments as Record<string, unknown>;
                const toolResult = await handleToolCall(toolName, toolArgs);

                return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                                content: toolResult.content,
                                isError: toolResult.isError ?? false,
                        },
                };
        }

        return {
                jsonrpc: '2.0',
                id,
                error: {
                        code: -32601,
                        message: `Method not found: ${method}`,
                },
        };
}

// ─── Main: stdio JSON-RPC 2.0 loop ──────────────────────────────────────────

function main(): void {
        log('info', `${SERVER_NAME} v${SERVER_VERSION} starting...`);

        const skillPath = resolveSkillPath();
        if (skillPath) {
                log('info', `UI-UX Pro Max skill found at: ${skillPath}`);
        } else {
                log('warn', 'UI-UX Pro Max skill not found. Tools will return an error. Install the skill to .kovix/skills/ui-ux-pro-max/');
        }

        const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: false,
        });

        rl.on('line', async (line: string) => {
                let request: JsonRpcRequest;
                try {
                        request = JSON.parse(line) as JsonRpcRequest;
                } catch {
                        log('error', `Invalid JSON: ${line.substring(0, 200)}`);
                        const response: JsonRpcResponse = {
                                jsonrpc: '2.0',
                                id: null,
                                error: { code: -32700, message: 'Parse error' },
                        };
                        console.log(JSON.stringify(response));
                        return;
                }

                // Notifications have no id — don't respond
                if (request.id === undefined || request.id === null) {
                        if (request.method === 'initialized') {
                                log('info', 'Client initialized');
                        }
                        return;
                }

                const response = await handleRequest(request);
                console.log(JSON.stringify(response));
        });

        rl.on('close', () => {
                log('info', 'stdin closed, exiting');
                process.exit(0);
        });

        // Keep alive
        setInterval(() => { }, 60_000);
}

main();
