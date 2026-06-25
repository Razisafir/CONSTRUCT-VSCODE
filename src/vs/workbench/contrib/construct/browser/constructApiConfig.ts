/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';

const apiConfiguration: IConfigurationNode = {
                id: 'kovix.anthropic',
                order: 99,
                title: localize('kovix.anthropic', "Kovix — Anthropic API"),
                type: 'object',
                properties: {
                                'kovix.anthropic.apiKey': {
                                                type: 'string',
                                                default: '',
                                                description: localize('kovix.anthropic.apiKey', "Anthropic API key for the Construct agent. Get your key at https://console.anthropic.com/. This is required for the agent to function."),
                                                scope: 1 /* ConfigurationScope.APPLICATION */
                                },
                                'kovix.anthropic.model': {
                                                type: 'string',
                                                default: 'claude-sonnet-4-20250514',
                                                description: localize('kovix.anthropic.model', "Anthropic model to use for the Construct agent. Available options: claude-sonnet-4-20250514, claude-3-5-sonnet-20241022, claude-3-opus-20240229."),
                                                enum: [
                                                                'claude-sonnet-4-20250514',
                                                                'claude-3-5-sonnet-20241022',
                                                                'claude-3-opus-20240229'
                                                ]
                                }
                }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(apiConfiguration);

// --- Phase 1: AI Provider Layer Configuration ---

const ollamaConfiguration: IConfigurationNode = {
                id: 'kovix.ollama',
                order: 100,
                title: localize('kovix.ollama', "Kovix — Ollama (Local)"),
                type: 'object',
                properties: {
                                'kovix.ollama.baseUrl': {
                                                type: 'string',
                                                default: 'http://localhost:11434',
                                                description: localize('kovix.ollama.baseUrl', "Base URL for the Ollama API. Defaults to localhost:11434. Change this if you run Ollama on a different host or port. SEC-7: Application-scoped to prevent malicious workspaces from redirecting API calls to an attacker-controlled endpoint."),
                                                scope: 1 /* ConfigurationScope.APPLICATION */
                                },
                                'kovix.ollama.model': {
                                                type: 'string',
                                                default: 'llama3.2',
                                                description: localize('kovix.ollama.model', "Default Ollama model. If set, this model is used instead of auto-selecting from available models."),
                                                scope: 4 /* ConfigurationScope.WINDOW */
                                }
                }
};

const xenovaConfiguration: IConfigurationNode = {
                id: 'kovix.xenova',
                order: 101,
                title: localize('kovix.xenova', "Kovix — Xenova (In-Process)"),
                type: 'object',
                properties: {
                                'kovix.xenova.model': {
                                                type: 'string',
                                                default: 'Xenova/Qwen1.5-0.5B-Chat',
                                                description: localize('kovix.xenova.model', "ONNX model to load via @xenova/transformers for in-process inference. This is the offline fallback when Ollama is not available."),
                                                enum: [
                                                                'Xenova/Qwen1.5-0.5B-Chat',
                                                                'Xenova/Phi-3-mini-4k-instruct',
                                                                'Xenova/codellama-7b-instruct',
                                                                'Xenova/starcoder2-3b'
                                                ]
                                }
                }
};

const cloudConfiguration: IConfigurationNode = {
                id: 'kovix.cloud',
                order: 102,
                title: localize('kovix.cloud', "Kovix — Cloud (OpenAI-Compatible)"),
                type: 'object',
                properties: {
                                'kovix.cloud.baseUrl': {
                                                type: 'string',
                                                default: 'https://api.openai.com/v1',
                                                description: localize('kovix.cloud.baseUrl', "Base URL for the OpenAI-compatible cloud API. Supports OpenAI, Together AI, Groq, LM Studio, or any LiteLLM proxy. SEC-7: Application-scoped to prevent malicious workspaces from redirecting API calls (and the user's API key) to an attacker-controlled endpoint."),
                                                scope: 1 /* ConfigurationScope.APPLICATION */
                                },
                                'kovix.cloud.apiKey': {
                                                type: 'string',
                                                default: '',
                                                description: localize('kovix.cloud.apiKey', "API key for the cloud provider. Required for cloud inference."),
                                                scope: 1 /* ConfigurationScope.APPLICATION */
                                },
                                'kovix.cloud.model': {
                                                type: 'string',
                                                default: 'gpt-4o-mini',
                                                description: localize('kovix.cloud.model', "Model ID to use with the cloud provider. Must be available from the /v1/models endpoint.")
                                }
                }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(ollamaConfiguration);
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(xenovaConfiguration);
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(cloudConfiguration);

// --- Phase 6: Security Tools Configuration ---

const securityConfiguration: IConfigurationNode = {
        id: 'kovix.security',
        order: 103,
        title: localize('kovix.security', "Kovix — Security Tools"),
        type: 'object',
        properties: {
                'kovix.enableSecurityTools': {
                        type: 'boolean',
                        default: false,
                        description: localize('kovix.enableSecurityTools', "Enable security scanning tools (nmap, Ghidra, Nuclei). Phase 5: defaults to false -- security tools are now provided by the Kovix Security Tools extension (extensions/kovix-security-tools). Install and enable the extension, then set this to true to register nmap_scan, ghidra_decompile, and nuclei_scan with the agent. Without the extension installed, this setting has no effect."),
                        scope: 4 /* ConfigurationScope.WINDOW */
                },
                'kovix.security.allowExternalTargets': {
                        type: 'boolean',
                        default: false,
                        description: localize('kovix.security.allowExternalTargets', "Allow nmap and Nuclei to scan non-loopback / non-private (RFC1918) targets. Default false for safety. Enable only if you understand the legal and ethical implications of scanning external hosts. SEC-7: Application-scoped to prevent malicious workspaces from enabling external scans without the user's explicit consent."),
                        scope: 1 /* ConfigurationScope.APPLICATION */
                }
        }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(securityConfiguration);

// --- Phase 7: MCP Server Configuration ---

const mcpConfiguration: IConfigurationNode = {
        id: 'kovix.mcp',
        order: 104,
        title: localize('kovix.mcp', "Kovix — MCP Servers"),
        type: 'object',
        properties: {
                'kovix.mcp.servers': {
                        type: 'array',
                        default: [
                                {
                                        name: 'agent-reach',
                                        command: 'node',
                                        args: ['${extensionPath}/node_modules/@agent-reach/mcp-server/dist/index.js'],
                                        env: {},
                                        enabled: true,
                                        isBuiltin: true
                                },
                                {
                                        name: 'goclaw',
                                        command: 'node',
                                        args: ['${extensionPath}/node_modules/goclaw-mcp/dist/index.js'],
                                        env: {},
                                        enabled: false,
                                        isBuiltin: true
                                }
                        ],
                        description: localize('kovix.mcp.servers', "MCP server configurations. The agent-reach server is pre-configured for internet research tools (webpage reading, YouTube, GitHub, Twitter, Reddit, Bilibili, Xiaohongshu, Exa search, RSS). Install it with: npm install -g @agent-reach/mcp-server. SEC-9: When loaded from a workspace (scope:4) settings.json, isBuiltin and userApproved are always stripped — only Application-scope config may mark a server as builtin or pre-approved. Workspace Trust also gates loading: untrusted workspaces cannot contribute MCP server definitions at all."),
                        // SEC-9 (K2-C2 fix): scope:4 (WINDOW) is intentional — we DO
                        // want workspaces to be able to *contribute* MCP server
                        // definitions (e.g. a repo that ships a project-specific
                        // MCP server in .vscode/settings.json). But:
                        //   - restricted:true tells VS Code Workspace Trust to
                        //     gate this setting — untrusted workspaces cannot
                        //     contribute server defs at all.
                        //   - MCPServerRegistry.loadServers() strips isBuiltin
                        //     and userApproved from any def coming from a
                        //     workspace-scoped config — only Application scope
                        //     may set them. This closes the K2-C2 PoC where a
                        //     malicious cloned workspace ships:
                        //       {"kovix.mcp.servers":[{...,"isBuiltin":true,"userApproved":true,"enabled":true}]}
                        //     and auto-spawns arbitrary commands on workspace open.
                        scope: 4,
                        restricted: true,
                        items: {
                                type: 'object',
                                properties: {
                                        name: { type: 'string', description: 'Server name' },
                                        command: { type: 'string', description: 'Command to start the server' },
                                        args: { type: 'array', items: { type: 'string', description: 'Argument' }, description: 'Command arguments' },
                                        env: { type: 'object', description: 'Environment variables' },
                                        enabled: { type: 'boolean', description: 'Whether this MCP server is enabled', default: true },
                                        isBuiltin: { type: 'boolean', description: 'Whether this is a built-in server managed by KOVIX (Application scope only — workspace values are ignored)', default: false }
                                },
                                required: ['name', 'command']
                        }
                }
        }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(mcpConfiguration);

// --- Phase 4 Patch A: Tab Autocomplete Configuration ---

const autocompleteConfiguration: IConfigurationNode = {
        id: 'kovix.autocomplete',
        order: 105,
        title: localize('kovix.autocomplete', "Kovix — Tab Autocomplete"),
        type: 'object',
        properties: {
                'kovix.autocomplete.enabled': {
                        type: 'boolean',
                        default: true,
                        description: localize('kovix.autocomplete.enabled', "Enable Kovix tab autocomplete. When enabled, the editor shows ghost-text suggestions as you type. Press Tab to accept."),
                        scope: 4 /* ConfigurationScope.WINDOW */
                },
                'kovix.autocomplete.debounceMs': {
                        type: 'number',
                        default: 200,
                        minimum: 50,
                        maximum: 2000,
                        description: localize('kovix.autocomplete.debounceMs', "Delay in milliseconds between the last keystroke and the autocomplete request. Higher values reduce API calls but feel slower; lower values feel snappier but may overload the provider."),
                        scope: 4 /* ConfigurationScope.WINDOW */
                },
                'kovix.autocomplete.maxTokens': {
                        type: 'number',
                        default: 32,
                        minimum: 8,
                        maximum: 256,
                        description: localize('kovix.autocomplete.maxTokens', "Maximum number of tokens to generate per autocomplete request. Higher values allow longer suggestions but take more time."),
                        scope: 4 /* ConfigurationScope.WINDOW */
                },
                'kovix.autocomplete.temperature': {
                        type: 'number',
                        default: 0.2,
                        minimum: 0,
                        maximum: 1,
                        description: localize('kovix.autocomplete.temperature', "Sampling temperature for autocomplete. Lower values (0.0-0.2) produce more deterministic suggestions; higher values (0.5-1.0) produce more varied suggestions."),
                        scope: 4 /* ConfigurationScope.WINDOW */
                }
        }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(autocompleteConfiguration);

