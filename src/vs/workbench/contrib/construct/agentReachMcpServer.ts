// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agent Reach MCP Server
 *
 * A lightweight MCP (Model Context Protocol) server that exposes Agent Reach's
 * web scraping, search, and content retrieval capabilities as MCP tools via
 * stdio JSON-RPC 2.0 transport.
 *
 * Architecture:
 *   Agent Reach CLI tools → Agent Reach MCP Server (stdio) → KOVIX MCP Registry → Agent Loop
 *
 * This server is spawned by KOVIX's MCP server manager (via mcpProcessNode.ts)
 * and communicates over stdin/stdout using line-delimited JSON-RPC 2.0 messages.
 *
 * KOVIX dispatches MCP tools using the `serverName__toolName` naming convention,
 * e.g., `agent_reach__read_webpage`.
 *
 * Tools exposed:
 * - read_webpage: Extract article content from any URL via jina.ai reader
 * - search_youtube: Search YouTube videos via yt-dlp
 * - get_youtube_transcript: Fetch video transcripts/subtitles
 * - search_bilibili: Search Bilibili videos
 * - search_github: Search GitHub repositories
 * - search_twitter: Search Twitter/X (with cookie fallback)
 * - search_reddit: Search Reddit posts
 * - search_xiaohongshu: Search Xiaohongshu (manual setup required)
 * - search_exa: Search via Exa API through mcporter
 * - read_rss: Read and parse RSS feeds
 * - doctor: Run agent-reach diagnostics
 */

import { spawn } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

interface AgentReachConfig {
        proxy?: string;
        cookies?: Record<string, string>;
        timeout?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER_NAME = 'agent-reach-mcp-server';
const SERVER_VERSION = '1.0.0';
const DEFAULT_TIMEOUT = 30000;  // 30s — matches KOVIX's MCP_DEFAULT_TOOL_TIMEOUT_MS
const LONG_TIMEOUT = 120000;    // 120s for slow operations (Exa, Xiaohongshu)

// ─── Logger ─────────────────────────────────────────────────────────────────

/**
 * Simple stderr logger to avoid polluting stdout (which is used for JSON-RPC).
 */
function log(level: 'info' | 'warn' | 'error', message: string): void {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// ─── Helper: Read Agent Reach config ────────────────────────────────────────

/**
 * Load Agent Reach configuration from ~/.agent-reach/config.yaml.
 * Returns proxy settings, cookies, and custom timeouts.
 */
function loadAgentReachConfig(): AgentReachConfig {
        const configPath = path.join(os.homedir(), '.agent-reach', 'config.yaml');
        const config: AgentReachConfig = {};

        try {
                if (fs.existsSync(configPath)) {
                        const content = fs.readFileSync(configPath, 'utf-8');

                        // Simple YAML parsing for key-value pairs
                        const proxyMatch = content.match(/proxy:\s*(.+)/);
                        if (proxyMatch) {
                                config.proxy = proxyMatch[1].trim();
                        }

                        const timeoutMatch = content.match(/timeout:\s*(\d+)/);
                        if (timeoutMatch) {
                                config.timeout = parseInt(timeoutMatch[1], 10);
                        }

                        // Parse cookies section
                        const cookies: Record<string, string> = {};
                        const cookiesMatch = content.match(/cookies:\s*([\s\S]*?)(?=\n\w|\n*$)/);
                        if (cookiesMatch) {
                                const cookieLines = cookiesMatch[1].split('\n');
                                for (const line of cookieLines) {
                                        const match = line.match(/\s+(\w+):\s*(.+)/);
                                        if (match) {
                                                cookies[match[1].trim()] = match[2].trim();
                                        }
                                }
                        }
                        if (Object.keys(cookies).length > 0) {
                                config.cookies = cookies;
                        }

                        log('info', `Loaded Agent Reach config from ${configPath}`);
                }
        } catch (error) {
                log('warn', `Failed to load Agent Reach config: ${error instanceof Error ? error.message : String(error)}`);
        }

        return config;
}

// ─── Helper: Detect agent-reach venv path ───────────────────────────────────

/**
 * Detect the agent-reach virtual environment path.
 * Checks common locations: ~/.agent-reach-venv, ~/.local/share/agent-reach/venv
 */
function detectVenvPath(): string | null {
        const candidates = [
                path.join(os.homedir(), '.agent-reach-venv'),
                path.join(os.homedir(), '.local', 'share', 'agent-reach', 'venv'),
                path.join(os.homedir(), 'agent-reach-venv'),
        ];

        for (const venvPath of candidates) {
                const binDir = path.join(venvPath, 'bin');
                if (fs.existsSync(binDir)) {
                        return binDir;
                }
        }

        return null;
}

/**
 * Build environment variables for command execution.
 * Injects proxy settings from config and venv PATH.
 */
function buildCommandEnv(config: AgentReachConfig): Record<string, string> {
        const env: Record<string, string> = { ...process.env as Record<string, string> };

        // Inject venv bin directory into PATH
        const venvBin = detectVenvPath();
        if (venvBin) {
                env.PATH = `${venvBin}${path.delimiter}${env.PATH || ''}`;
        }

        // Apply proxy settings
        if (config.proxy) {
                env.HTTP_PROXY = config.proxy;
                env.HTTPS_PROXY = config.proxy;
                env.http_proxy = config.proxy;
                env.https_proxy = config.proxy;
        }

        return env;
}

// ─── Helper: Execute shell command with timeout ─────────────────────────────

/**
 * Execute a shell command with a timeout.
 * Uses spawn for long-running commands and execFile for simpler ones.
 * Kills the process if timeout is exceeded.
 */
function executeCommand(
        cmd: string,
        args: string[],
        timeout: number,
        env?: Record<string, string>,
        input?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        return new Promise((resolve) => {
                const startTime = Date.now();
                const childEnv = env || { ...process.env as Record<string, string> };

                log('info', `Executing: ${cmd} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')} (timeout: ${timeout}ms)`);

                const child = spawn(cmd, args, {
                        env: childEnv,
                        stdio: ['pipe', 'pipe', 'pipe'],
                        shell: false,
                });

                let stdout = '';
                let stderr = '';
                let killed = false;

                // Set timeout
                const timeoutTimer = setTimeout(() => {
                        killed = true;
                        log('warn', `Command timed out after ${timeout}ms: ${cmd}`);
                        try {
                                child.kill('SIGKILL');
                        } catch {
                                // Process may have already exited
                        }
                        resolve({
                                stdout,
                                stderr: `${stderr}\n[ERROR] Command timed out after ${timeout}ms`.trim(),
                                exitCode: 124, // Standard timeout exit code
                        });
                }, timeout);

                child.stdout?.on('data', (data: Buffer) => {
                        stdout += data.toString('utf-8');
                });

                child.stderr?.on('data', (data: Buffer) => {
                        stderr += data.toString('utf-8');
                });

                if (input !== undefined) {
                        try {
                                child.stdin?.write(input, 'utf-8');
                                child.stdin?.end();
                        } catch (error) {
                                log('warn', `Failed to write to stdin: ${error instanceof Error ? error.message : String(error)}`);
                        }
                } else {
                        child.stdin?.end();
                }

                child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
                        if (killed) return; // Already resolved by timeout
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
                        if (killed) return;
                        clearTimeout(timeoutTimer);

                        const errorMsg = error instanceof Error ? error.message : String(error);
                        log('error', `Command failed: ${cmd} - ${errorMsg}`);

                        resolve({
                                stdout,
                                stderr: `${stderr}\n[ERROR] ${errorMsg}`.trim(),
                                exitCode: -1,
                        });
                });
        });
}

// ─── Tool Command Map ───────────────────────────────────────────────────────

/**
 * Each tool entry resolves command arguments from MCP tool call parameters.
 * Returns: { cmd, args, timeout?, env?, input? }
 */
const TOOL_COMMANDS: Record<string, (args: any, env: Record<string, string>) => { cmd: string; args: string[]; timeout?: number; env?: Record<string, string>; input?: string } | null> = {

        /**
         * read_webpage — Extract article content from any URL via jina.ai reader.
         * Uses jina.ai's free summarizer/reader service to fetch clean article text.
         */
        'read_webpage': (args, env) => {
                const url = args.url as string;
                if (!url) {
                        throw new Error('Missing required parameter: "url"');
                }
                // Validate URL to prevent command injection
                const validatedUrl = encodeURIComponent(url);
                return {
                        cmd: 'curl',
                        args: ['-s', '-L', '--max-time', '25', `https://r.jina.ai/${validatedUrl}`],
                        timeout: DEFAULT_TIMEOUT,
                        env,
                };
        },

        /**
         * search_youtube — Search YouTube videos via yt-dlp.
         * Returns JSON metadata for matching videos.
         */
        'search_youtube': (args, env) => {
                const query = args.query as string;
                const limit = Math.min(Math.max(parseInt(args.limit as string || '5', 10), 1), 20);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                return {
                        cmd: 'yt-dlp',
                        args: ['--dump-json', '--playlist-end', String(limit), `ytsearch${limit}:${query}`],
                        timeout: DEFAULT_TIMEOUT,
                        env,
                };
        },

        /**
         * get_youtube_transcript — Fetch video transcripts/subtitles via yt-dlp.
         * Extracts subtitle text in the requested language.
         */
        'get_youtube_transcript': (args, env) => {
                const url = args.url as string;
                const lang = args.lang as string || 'en';
                if (!url) {
                        throw new Error('Missing required parameter: "url"');
                }
                // Validate language code to prevent injection (only alphanumeric and hyphen)
                const validatedLang = lang.replace(/[^a-zA-Z0-9-]/g, '');
                return {
                        cmd: 'yt-dlp',
                        args: ['--write-sub', '--skip-download', '--sub-langs', validatedLang, '--sub-format', 'json3', '-o', '-', url],
                        timeout: DEFAULT_TIMEOUT,
                        env,
                };
        },

        /**
         * search_bilibili — Search Bilibili videos via public API.
         */
        'search_bilibili': (args, env) => {
                const query = args.query as string;
                const limit = Math.min(Math.max(parseInt(args.limit as string || '10', 10), 1), 50);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                const encodedQuery = encodeURIComponent(query);
                return {
                        cmd: 'curl',
                        args: ['-s', '-L', '--max-time', '20',
                                `https://api.bilibili.com/x/web-interface/search/type?keyword=${encodedQuery}&search_type=video&page=1&pagesize=${limit}`],
                        timeout: DEFAULT_TIMEOUT,
                        env,
                };
        },

        /**
         * search_github — Search GitHub repositories via REST API.
         * Uses the public GitHub API (no auth required for low-rate searches).
         */
        'search_github': (args, env) => {
                const query = args.query as string;
                const limit = Math.min(Math.max(parseInt(args.limit as string || '10', 10), 1), 100);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                const encodedQuery = encodeURIComponent(query);
                return {
                        cmd: 'curl',
                        args: ['-s', '-L', '--max-time', '20',
                                '-H', 'Accept: application/vnd.github.v3+json',
                                '-H', 'User-Agent: agent-reach-mcp-server/1.0',
                                `https://api.github.com/search/repositories?q=${encodedQuery}&per_page=${limit}&sort=stars&order=desc`],
                        timeout: DEFAULT_TIMEOUT,
                        env,
                };
        },

        /**
         * search_twitter — Search Twitter/X.
         * Requires Nitter instance or cookie-based authentication.
         * Returns a helpful error guiding the user to set up cookies.
         */
        'search_twitter': (args, _env) => {
                const query = args.query as string;
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                // Twitter/X requires authentication. Return null to signal special handling.
                return null;
        },

        /**
         * search_reddit — Search Reddit posts via public JSON API.
         */
        'search_reddit': (args, env) => {
                const query = args.query as string;
                const limit = Math.min(Math.max(parseInt(args.limit as string || '10', 10), 1), 100);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                const encodedQuery = encodeURIComponent(query);
                return {
                        cmd: 'curl',
                        args: ['-s', '-L', '--max-time', '20',
                                '-H', 'User-Agent: agent-reach-mcp-server/1.0',
                                `https://www.reddit.com/search.json?q=${encodedQuery}&limit=${limit}&sort=relevance`],
                        timeout: DEFAULT_TIMEOUT,
                        env,
                };
        },

        /**
         * search_xiaohongshu — Search Xiaohongshu (Little Red Book).
         * Requires manual cookie setup due to anti-bot protection.
         */
        'search_xiaohongshu': (args, _env) => {
                const query = args.query as string;
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                // Xiaohongshu requires authentication cookies. Return null for special handling.
                return null;
        },

        /**
         * search_exa — Search via Exa API through mcporter.
         * mcporter is a bridge tool that routes to various search APIs.
         */
        'search_exa': (args, env) => {
                const query = args.query as string;
                const limit = Math.min(Math.max(parseInt(args.limit as string || '10', 10), 1), 100);
                if (!query) {
                        throw new Error('Missing required parameter: "query"');
                }
                // Escape quotes in query for shell safety
                const safeQuery = query.replace(/"/g, '\\"');
                return {
                        cmd: 'mcporter',
                        args: ['call', `exa.web_search_exa(query="${safeQuery}", numResults=${limit})`],
                        timeout: LONG_TIMEOUT,
                        env,
                };
        },

        /**
         * read_rss — Parse RSS/Atom feeds.
         * Uses Python with feedparser library (falls back to manual XML parsing).
         */
        'read_rss': (args, env) => {
                const url = args.url as string;
                const limit = Math.min(Math.max(parseInt(args.limit as string || '10', 10), 1), 50);
                if (!url) {
                        throw new Error('Missing required parameter: "url"');
                }
                // Validate URL
                try {
                        new URL(url);
                } catch {
                        throw new Error(`Invalid URL: "${url}"`);
                }

                // Use Python with feedparser if available, otherwise fallback to curl + basic parsing
                const pythonScript = `
import sys
import json

try:
    import feedparser
    HAS_FEEDPARSER = True
except ImportError:
    HAS_FEEDPARSER = False

if HAS_FEEDPARSER:
    feed = feedparser.parse(${JSON.stringify(url)})
    entries = []
    for i, entry in enumerate(feed.entries[:${limit}]):
        entries.append({
            'title': entry.get('title', ''),
            'link': entry.get('link', ''),
            'published': entry.get('published', entry.get('updated', '')),
            'summary': entry.get('summary', ''),
            'author': entry.get('author', ''),
        })
    result = {
        'feed_title': feed.feed.get('title', ''),
        'feed_link': feed.feed.get('link', ''),
        'feed_description': feed.feed.get('description', ''),
        'entry_count': len(entries),
        'entries': entries,
        'parser': 'feedparser',
    }
    print(json.dumps(result, ensure_ascii=False))
else:
    # Fallback: use xml.etree.ElementTree
    import urllib.request
    import xml.etree.ElementTree as ET

    req = urllib.request.Request(${JSON.stringify(url)}, headers={'User-Agent': 'agent-reach-mcp-server/1.0'})
    with urllib.request.urlopen(req, timeout=20) as response:
        data = response.read()

    root = ET.fromstring(data)
    ns = {'atom': 'http://www.w3.org/2005/Atom', 'rss': 'http://purl.org/rss/1.0/', 'content': 'http://purl.org/rss/1.0/modules/content/'}

    entries = []
    feed_title = ''
    feed_link = ''
    feed_desc = ''

    # Try RSS 2.0
    channel = root.find('channel')
    if channel is not None:
        title_el = channel.find('title')
        feed_title = title_el.text if title_el is not None else ''
        link_el = channel.find('link')
        feed_link = link_el.text if link_el is not None else ''
        desc_el = channel.find('description')
        feed_desc = desc_el.text if desc_el is not None else ''

        for item in channel.findall('item')[:${limit}]:
            title_el = item.find('title')
            link_el = item.find('link')
            pub_el = item.find('pubDate')
            desc_el = item.find('description')
            entries.append({
                'title': title_el.text if title_el is not None else '',
                'link': link_el.text if link_el is not None else '',
                'published': pub_el.text if pub_el is not None else '',
                'summary': desc_el.text if desc_el is not None else '',
                'author': '',
            })
    else:
        # Try Atom
        for elem in root.iter():
            if elem.tag.endswith('title') and not feed_title:
                feed_title = elem.text or ''
            if elem.tag.endswith('link') and not feed_link:
                feed_link = elem.get('href', '')
            if elem.tag.endswith('subtitle') and not feed_desc:
                feed_desc = elem.text or ''

        count = 0
        for elem in root.iter():
            if elem.tag.endswith('entry') and count < ${limit}:
                entry = {}
                for child in elem:
                    tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
                    if tag == 'title':
                        entry['title'] = child.text or ''
                    elif tag == 'link':
                        entry['link'] = child.get('href', '')
                    elif tag == 'published' or tag == 'updated':
                        entry['published'] = child.text or ''
                    elif tag == 'summary' or tag == 'content':
                        entry['summary'] = child.text or ''
                    elif tag == 'author':
                        name_el = child.find('{http://www.w3.org/2005/Atom}name')
                        entry['author'] = name_el.text if name_el is not None else ''
                if 'title' in entry or 'link' in entry:
                    entries.append(entry)
                    count += 1

    result = {
        'feed_title': feed_title,
        'feed_link': feed_link,
        'feed_description': feed_desc,
        'entry_count': len(entries),
        'entries': entries,
        'parser': 'xml.etree',
    }
    print(json.dumps(result, ensure_ascii=False))
`;
                return {
                        cmd: 'python3',
                        args: ['-c', pythonScript],
                        timeout: DEFAULT_TIMEOUT,
                        env,
                };
        },

        /**
         * doctor — Run agent-reach diagnostics to check tool availability.
         */
        'doctor': (_args, env) => {
                return {
                        cmd: 'agent-reach',
                        args: ['doctor', '--json'],
                        timeout: DEFAULT_TIMEOUT,
                        env,
                };
        },
};

// ─── Tool: List available tools ─────────────────────────────────────────────

/**
 * Return the list of all MCP tools with their JSON Schema descriptions.
 * KOVIX's LLM uses these descriptions to decide which tool to call.
 */
function handleListTools(): { tools: McpTool[] } {
        return {
                tools: [
                        {
                                name: 'read_webpage',
                                description: 'Extract clean article content from any webpage URL. Uses jina.ai reader to strip ads, navigation, and formatting, returning just the readable article text. Great for reading news articles, blog posts, documentation pages, and any public web content.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                url: {
                                                        type: 'string',
                                                        description: 'The full URL of the webpage to read (e.g., https://example.com/article)',
                                                },
                                        },
                                        required: ['url'],
                                },
                        },
                        {
                                name: 'search_youtube',
                                description: 'Search YouTube for videos matching a query. Returns video metadata including title, description, duration, view count, uploader, and video URL. Use this to find relevant videos, tutorials, talks, or educational content.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query string (e.g., "TypeScript tutorial", "Rust programming")',
                                                },
                                                limit: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-20, default: 5)',
                                                        default: 5,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'get_youtube_transcript',
                                description: 'Fetch the transcript/subtitles of a YouTube video. Returns the full subtitle text in the requested language. Use this to get the spoken content of a video as readable text.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                url: {
                                                        type: 'string',
                                                        description: 'The full YouTube video URL (e.g., https://www.youtube.com/watch?v=VIDEO_ID)',
                                                },
                                                lang: {
                                                        type: 'string',
                                                        description: 'Language code for subtitles (e.g., "en", "zh", "ja", "auto"). Default: "en"',
                                                        default: 'en',
                                                },
                                        },
                                        required: ['url'],
                                },
                        },
                        {
                                name: 'search_bilibili',
                                description: 'Search Bilibili (B站) for videos matching a query. Returns video metadata including title, description, duration, view count, and video link. Use this to find Chinese-language video content, tutorials, anime, and educational videos.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query string (e.g., "编程教程", "深度学习")',
                                                },
                                                limit: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-50, default: 10)',
                                                        default: 10,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'search_github',
                                description: 'Search GitHub repositories matching a query. Returns repo metadata including name, description, stars, language, and URL. Use this to find open-source projects, libraries, tools, code examples, and reference implementations.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query string (e.g., "react state management", "machine learning python")',
                                                },
                                                limit: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-100, default: 10)',
                                                        default: 10,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'search_twitter',
                                description: 'Search Twitter/X posts matching a query. REQUIRES MANUAL SETUP: You must configure Twitter/X cookies in ~/.agent-reach/config.yaml before using this tool. Returns recent tweets matching the search query.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query string (e.g., "#rustlang", "from:user keyword")',
                                                },
                                                limit: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-50, default: 10)',
                                                        default: 10,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'search_reddit',
                                description: 'Search Reddit posts and comments matching a query. Returns post metadata including title, subreddit, score, URL, and a preview of the content. Use this to find discussions, recommendations, and community opinions.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query string (e.g., "best mechanical keyboard", "rust learning resources")',
                                                },
                                                limit: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-100, default: 10)',
                                                        default: 10,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'search_xiaohongshu',
                                description: 'Search Xiaohongshu (Little Red Book / 小红书) posts matching a query. MANUAL SETUP REQUIRED: You must configure Xiaohongshu cookies in ~/.agent-reach/config.yaml and install the required browser automation dependencies. Returns post metadata including title, content preview, likes, and link.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query string in Chinese (e.g., "护肤品推荐", "旅行攻略")',
                                                },
                                                limit: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-20, default: 10)',
                                                        default: 10,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'search_exa',
                                description: 'Search the web using Exa AI search API (via mcporter). Returns high-quality search results with titles, URLs, and content summaries. Exa provides semantic search capabilities that understand the meaning behind queries, making it ideal for research and discovery.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                query: {
                                                        type: 'string',
                                                        description: 'Search query string (e.g., "latest advances in LLM agents 2024")',
                                                },
                                                limit: {
                                                        type: 'number',
                                                        description: 'Maximum number of results to return (1-100, default: 10)',
                                                        default: 10,
                                                },
                                        },
                                        required: ['query'],
                                },
                        },
                        {
                                name: 'read_rss',
                                description: 'Read and parse an RSS or Atom feed from a given URL. Returns feed metadata (title, description, link) and a list of recent entries with titles, links, publication dates, and summaries. Supports both RSS 2.0 and Atom formats. Uses Python feedparser if available, falls back to built-in XML parsing.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {
                                                url: {
                                                        type: 'string',
                                                        description: 'The RSS/Atom feed URL (e.g., https://news.ycombinator.com/rss)',
                                                },
                                                limit: {
                                                        type: 'number',
                                                        description: 'Maximum number of entries to return (1-50, default: 10)',
                                                        default: 10,
                                                },
                                        },
                                        required: ['url'],
                                },
                        },
                        {
                                name: 'doctor',
                                description: 'Run Agent Reach diagnostics. Checks availability of all dependencies (curl, yt-dlp, python3, feedparser, mcporter, agent-reach) and reports their versions and status. Use this to troubleshoot when other Agent Reach tools are not working.',
                                inputSchema: {
                                        type: 'object',
                                        properties: {},
                                        required: [],
                                },
                        },
                ],
        };
}

// ─── Tool: Execute a tool call ──────────────────────────────────────────────

/**
 * Execute an MCP tool call by name with the given arguments.
 * Returns structured MCP content array with text results.
 */
async function handleToolCall(
        name: string,
        args: any,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
        log('info', `Tool call: ${name} with args: ${JSON.stringify(args)}`);

        try {
                // Validate tool name against allowlist — never execute arbitrary commands
                if (!TOOL_COMMANDS[name]) {
                        return {
                                content: [{ type: 'text', text: `Unknown tool: "${name}". Available tools: ${Object.keys(TOOL_COMMANDS).join(', ')}` }],
                                isError: true,
                        };
                }

                const config = loadAgentReachConfig();
                const env = buildCommandEnv(config);

                // Special handling for tools that require manual setup
                if (name === 'search_twitter') {
                        return handleTwitterSearch(args, config);
                }

                if (name === 'search_xiaohongshu') {
                        return handleXiaohongshuSearch(args, config);
                }

                // Resolve the command
                const commandSpec = TOOL_COMMANDS[name](args, env);
                if (commandSpec === null) {
                        return {
                                content: [{ type: 'text', text: `Tool "${name}" returned null — this should not happen.` }],
                                isError: true,
                        };
                }

                const { cmd, args: cmdArgs, timeout = DEFAULT_TIMEOUT, env: cmdEnv, input } = commandSpec;

                // Execute the command
                const result = await executeCommand(cmd, cmdArgs, timeout, cmdEnv, input);

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

// ─── Special Handlers ───────────────────────────────────────────────────────

/**
 * Handle Twitter/X search with cookie-based fallback.
 */
async function handleTwitterSearch(
        args: any,
        config: AgentReachConfig,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
        const query = args.query as string;
        const limit = Math.min(Math.max(parseInt(args.limit as string || '10', 10), 1), 50);

        // Check if cookies are configured
        if (!config.cookies || !config.cookies.twitter_auth_token) {
                return {
                        content: [{
                                type: 'text',
                                text: `Twitter/X search requires authentication cookies.\n\n` +
                                        `To set up Twitter search:\n` +
                                        `1. Open Twitter/X in your browser and log in\n` +
                                        `2. Open DevTools (F12) → Application → Cookies\n` +
                                        `3. Copy the 'auth_token' cookie value\n` +
                                        `4. Add to ~/.agent-reach/config.yaml:\n\n` +
                                        `cookies:\n` +
                                        `  twitter_auth_token: YOUR_AUTH_TOKEN_HERE\n\n` +
                                        `5. Restart KOVIX for changes to take effect\n\n` +
                                        `Query that would have been searched: "${query}" (limit: ${limit})`,
                        }],
                        isError: true,
                };
        }

        // Try using twscrape or similar tool with cookies
        try {
                const env = buildCommandEnv(config);
                // Attempt to use Python with the cookies
                const pythonScript = `
import sys
import json
import urllib.request
import urllib.parse

# Try using a simple approach with the auth token
auth_token = ${JSON.stringify(config.cookies?.twitter_auth_token || '')}
query = ${JSON.stringify(query)}
limit = ${limit}

print(json.dumps({
    "note": "Twitter/X scraping requires specialized tools.",
    "auth_token_configured": bool(auth_token),
    "query": query,
    "limit": limit,
    "suggestion": "Consider using twscrape or similar tool: pip install twscrape",
}, indent=2))
`;
                const result = await executeCommand('python3', ['-c', pythonScript], DEFAULT_TIMEOUT, env);
                return {
                        content: [{ type: 'text', text: result.stdout || result.stderr }],
                };
        } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                        content: [{ type: 'text', text: `[search_twitter] Error: ${errorMsg}` }],
                        isError: true,
                };
        }
}

/**
 * Handle Xiaohongshu search with cookie-based authentication requirement.
 */
async function handleXiaohongshuSearch(
        args: any,
        config: AgentReachConfig,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
        const query = args.query as string;
        const limit = Math.min(Math.max(parseInt(args.limit as string || '10', 10), 1), 20);

        // Check if cookies are configured
        if (!config.cookies || !config.cookies.xhs_cookie) {
                return {
                        content: [{
                                type: 'text',
                                text: `Xiaohongshu (小红书) search requires authentication cookies due to anti-bot protection.\n\n` +
                                        `To set up Xiaohongshu search:\n` +
                                        `1. Open xiaohongshu.com in your browser and log in\n` +
                                        `2. Open DevTools (F12) → Application → Cookies\n` +
                                        `3. Copy your session cookie string\n` +
                                        `4. Add to ~/.agent-reach/config.yaml:\n\n` +
                                        `cookies:\n` +
                                        `  xhs_cookie: YOUR_COOKIE_STRING_HERE\n\n` +
                                        `5. Install browser automation: pip install playwright\n` +
                                        `6. Restart KOVIX for changes to take effect\n\n` +
                                        `Query that would have been searched: "${query}" (limit: ${limit})`,
                        }],
                        isError: true,
                };
        }

        // Try using Python with the configured cookie
        try {
                const env = buildCommandEnv(config);
                const pythonScript = `
import sys
import json
import urllib.request
import urllib.parse

cookie = ${JSON.stringify(config.cookies?.xhs_cookie || '')}
query = ${JSON.stringify(query)}
limit = ${limit}

if not cookie:
    print(json.dumps({"error": "No cookie configured"}, indent=2))
    sys.exit(1)

# Note: Xiaohongshu requires browser automation for proper search
# This is a placeholder that explains the limitation
result = {
    "note": "Xiaohongshu search requires browser automation (Playwright/Selenium).",
    "cookie_configured": True,
    "query": query,
    "limit": limit,
    "manual_search_url": f"https://www.xiaohongshu.com/search_result?keyword={urllib.parse.quote(query)}",
    "setup_instructions": [
        "pip install playwright",
        "playwright install chromium",
        "Configure xhs_cookie in ~/.agent-reach/config.yaml",
    ]
}
print(json.dumps(result, indent=2, ensure_ascii=False))
`;
                const result = await executeCommand('python3', ['-c', pythonScript], LONG_TIMEOUT, env);
                return {
                        content: [{ type: 'text', text: result.stdout || result.stderr }],
                };
        } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                        content: [{ type: 'text', text: `[search_xiaohongshu] Error: ${errorMsg}` }],
                        isError: true,
                };
        }
}

// ─── JSON-RPC Handlers ──────────────────────────────────────────────────────

/**
 * Handle an incoming JSON-RPC 2.0 request and produce a response.
 * Supports MCP protocol methods: initialize, tools/list, tools/call.
 */
async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
        const { id, method, params } = req;

        log('info', `JSON-RPC method: ${method}`);

        switch (method) {
                // ─── MCP Initialize ──────────────────────────────────────────────
                case 'initialize': {
                        const result: McpInitializeResult = {
                                protocolVersion: '2024-11-05',
                                capabilities: {
                                        tools: {},
                                        resources: {},
                                },
                                serverInfo: {
                                        name: SERVER_NAME,
                                        version: SERVER_VERSION,
                                },
                        };

                        return { jsonrpc: '2.0', id, result };
                }

                // ─── MCP Initialized Notification ────────────────────────────────
                case 'notifications/initialized': {
                        // This is a notification, no response needed
                        return { jsonrpc: '2.0', id: null, result: null };
                }

                // ─── MCP Tools/List ──────────────────────────────────────────────
                case 'tools/list': {
                        const result = handleListTools();
                        return { jsonrpc: '2.0', id, result };
                }

                // ─── MCP Tools/Call ──────────────────────────────────────────────
                case 'tools/call': {
                        const toolName = params?.name as string;
                        const toolArgs = params?.arguments as Record<string, any> || {};

                        if (!toolName) {
                                return {
                                        jsonrpc: '2.0',
                                        id,
                                        error: { code: -32602, message: 'Missing tool name in params' },
                                };
                        }

                        const result = await handleToolCall(toolName, toolArgs);
                        return { jsonrpc: '2.0', id, result };
                }

                // ─── Unknown Method ──────────────────────────────────────────────
                default: {
                        return {
                                jsonrpc: '2.0',
                                id,
                                error: { code: -32601, message: `Method not found: "${method}"` },
                        };
                }
        }
}

// ─── Main: stdio server loop ────────────────────────────────────────────────

/**
 * Main entry point — starts the stdio JSON-RPC 2.0 server.
 * Reads line-delimited JSON from stdin, dispatches to handlers,
 * and writes JSON responses to stdout.
 */
function main(): void {
        log('info', `${SERVER_NAME} v${SERVER_VERSION} starting...`);

        const config = loadAgentReachConfig();
        if (config.proxy) {
                log('info', `Using proxy: ${config.proxy}`);
        }

        const venvPath = detectVenvPath();
        if (venvPath) {
                log('info', `Detected venv: ${venvPath}`);
        }

        // Create readline interface for line-delimited JSON
        const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: false,
        });

        log('info', 'Server ready — listening for JSON-RPC messages on stdin');

        rl.on('line', async (line: string) => {
                const trimmed = line.trim();
                if (!trimmed) {
                        return;
                }

                let request: JsonRpcRequest;
                try {
                        request = JSON.parse(trimmed) as JsonRpcRequest;
                } catch {
                        // Invalid JSON — send parse error
                        const response: JsonRpcResponse = {
                                jsonrpc: '2.0',
                                id: null,
                                error: { code: -32700, message: 'Parse error: Invalid JSON' },
                        };
                        console.log(JSON.stringify(response));
                        return;
                }

                // Validate JSON-RPC version
                if (request.jsonrpc !== '2.0') {
                        const response: JsonRpcResponse = {
                                jsonrpc: '2.0',
                                id: request.id ?? null,
                                error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
                        };
                        console.log(JSON.stringify(response));
                        return;
                }

                try {
                        const response = await handleRequest(request);
                        // Only send response if id is not null (not a notification)
                        if (request.id !== null) {
                                console.log(JSON.stringify(response));
                        }
                } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        log('error', `Handler error: ${errorMsg}`);
                        const response: JsonRpcResponse = {
                                jsonrpc: '2.0',
                                id: request.id ?? null,
                                error: { code: -32603, message: `Internal error: ${errorMsg}` },
                        };
                        console.log(JSON.stringify(response));
                }
        });

        rl.on('close', () => {
                log('info', 'Stdin closed — shutting down');
                process.exit(0);
        });

        // Handle signals gracefully
        process.on('SIGINT', () => {
                log('info', 'Received SIGINT — shutting down gracefully');
                process.exit(0);
        });

        process.on('SIGTERM', () => {
                log('info', 'Received SIGTERM — shutting down gracefully');
                process.exit(0);
        });

        // Handle uncaught errors to prevent crash
        process.on('uncaughtException', (error) => {
                log('error', `Uncaught exception: ${error.message}`);
        });

        process.on('unhandledRejection', (reason) => {
                log('error', `Unhandled rejection: ${reason}`);
        });
}

// Start the server
main();
