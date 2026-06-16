// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';

const apiConfiguration: IConfigurationNode = {
                id: 'construct.anthropic',
                order: 99,
                title: localize('construct.anthropic', "Construct -- Anthropic API"),
                type: 'object',
                properties: {
                                'construct.anthropic.apiKey': {
                                                type: 'string',
                                                default: '',
                                                description: localize('construct.anthropic.apiKey', "Anthropic API key for the Construct agent. Get your key at https://console.anthropic.com/. This is required for the agent to function."),
                                                scope: 1 /* ConfigurationScope.APPLICATION */
                                },
                                'construct.anthropic.model': {
                                                type: 'string',
                                                default: 'claude-sonnet-4-20250514',
                                                description: localize('construct.anthropic.model', "Anthropic model to use for the Construct agent. Available options: claude-sonnet-4-20250514, claude-3-5-sonnet-20241022, claude-3-opus-20240229."),
                                                enum: [
                                                                'claude-sonnet-4-20250514',
                                                                'claude-3-5-sonnet-20241022',
                                                                'claude-3-opus-20240229'
                                                ]
                                },
                                'construct.anthropic.maxTokens': {
                                                type: 'number',
                                                default: 8192,
                                                minimum: 1024,
                                                maximum: 32768,
                                                description: localize('construct.anthropic.maxTokens', "Maximum number of tokens the LLM can generate per response. Higher values allow longer responses but cost more.")
                                }
                }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(apiConfiguration);

// --- Phase 1: AI Provider Layer Configuration ---

const ollamaConfiguration: IConfigurationNode = {
                id: 'construct.ollama',
                order: 100,
                title: localize('construct.ollama', "Construct -- Ollama (Local)"),
                type: 'object',
                properties: {
                                'construct.ollama.baseUrl': {
                                                type: 'string',
                                                default: 'http://localhost:11434',
                                                description: localize('construct.ollama.baseUrl', "Base URL for the Ollama API. Defaults to localhost:11434. Change this if you run Ollama on a different host or port."),
                                                scope: 4 /* ConfigurationScope.WINDOW */
                                },
                                'construct.ollama.model': {
                                                type: 'string',
                                                default: 'llama3.2',
                                                description: localize('construct.ollama.model', "Default Ollama model. If set, this model is used instead of auto-selecting from available models."),
                                                scope: 4 /* ConfigurationScope.WINDOW */
                                }
                }
};

const xenovaConfiguration: IConfigurationNode = {
                id: 'construct.xenova',
                order: 101,
                title: localize('construct.xenova', "Construct -- Xenova (In-Process)"),
                type: 'object',
                properties: {
                                'construct.xenova.model': {
                                                type: 'string',
                                                default: 'Xenova/Qwen1.5-0.5B-Chat',
                                                description: localize('construct.xenova.model', "ONNX model to load via @xenova/transformers for in-process inference. This is the offline fallback when Ollama is not available."),
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
                id: 'construct.cloud',
                order: 102,
                title: localize('construct.cloud', "Construct -- Cloud (OpenAI-Compatible)"),
                type: 'object',
                properties: {
                                'construct.cloud.baseUrl': {
                                                type: 'string',
                                                default: 'https://api.openai.com/v1',
                                                description: localize('construct.cloud.baseUrl', "Base URL for the OpenAI-compatible cloud API. Supports OpenAI, Together AI, Groq, LM Studio, or any LiteLLM proxy."),
                                                scope: 4 /* ConfigurationScope.WINDOW */
                                },
                                'construct.cloud.apiKey': {
                                                type: 'string',
                                                default: '',
                                                description: localize('construct.cloud.apiKey', "API key for the cloud provider. Required for cloud inference."),
                                                scope: 1 /* ConfigurationScope.APPLICATION */
                                },
                                'construct.cloud.model': {
                                                type: 'string',
                                                default: 'gpt-4o-mini',
                                                description: localize('construct.cloud.model', "Model ID to use with the cloud provider. Must be available from the /v1/models endpoint.")
                                }
                }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(ollamaConfiguration);
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(xenovaConfiguration);
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(cloudConfiguration);

// --- Phase 6: Security Tools Configuration ---

const securityConfiguration: IConfigurationNode = {
        id: 'construct.security',
        order: 103,
        title: localize('construct.security', "Construct -- Security Tools"),
        type: 'object',
        properties: {
                'construct.enableSecurityTools': {
                        type: 'boolean',
                        default: true,
                        description: localize('construct.enableSecurityTools', "Enable security scanning tools (nmap, Ghidra, Nuclei). When disabled, security tools are not registered."),
                        scope: 4 /* ConfigurationScope.WINDOW */
                }
        }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(securityConfiguration);

// --- Phase 7: MCP Server Configuration ---

const mcpConfiguration: IConfigurationNode = {
        id: 'construct.mcp',
        order: 104,
        title: localize('construct.mcp', "Construct -- MCP Servers"),
        type: 'object',
        properties: {
                'construct.mcp.servers': {
                        type: 'array',
                        default: [],
                        description: localize('construct.mcp.servers', "MCP server configurations."),
                        scope: 4,
                        items: {
                                type: 'object',
                                properties: {
                                        name: { type: 'string', description: 'Server name' },
                                        command: { type: 'string', description: 'Command to start the server' },
                                        args: { type: 'array', items: { type: 'string', description: 'Argument' }, description: 'Command arguments' },
                                        env: { type: 'object', description: 'Environment variables' }
                                },
                                required: ['name', 'command']
                        }
                }
        }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(mcpConfiguration);

// --- Phase 21: Web Search Configuration (F-009 fix) ---

const webSearchConfiguration: IConfigurationNode = {
        id: 'construct.webSearch',
        order: 105,
        title: localize('construct.webSearch', "Construct -- Web Search"),
        type: 'object',
        properties: {
                'construct.webSearch.provider': {
                        type: 'string',
                        enum: ['disabled', 'tavily'],
                        default: 'disabled',
                        enumDescriptions: [
                                localize('construct.webSearch.provider.disabled', "Web search is disabled. The web_search tool will return a clear error message when invoked."),
                                localize('construct.webSearch.provider.tavily', "Use the Tavily Search API (https://tavily.com) — purpose-built for AI agents, returns clean markdown snippets."),
                        ],
                        description: localize('construct.webSearch.provider', "Web search backend used by the agent's web_search tool. The tool is only functional when a provider is configured AND the corresponding API key is set."),
                        scope: 1 /* ConfigurationScope.APPLICATION */
                },
                'construct.webSearch.apiKey': {
                        type: 'string',
                        default: '',
                        description: localize('construct.webSearch.apiKey', "API key for the configured web search provider. Required for the web_search tool to function. For Tavily, get a key at https://tavily.com."),
                        scope: 1 /* ConfigurationScope.APPLICATION */
                },
                'construct.webSearch.maxResults': {
                        type: 'number',
                        default: 5,
                        minimum: 1,
                        maximum: 20,
                        description: localize('construct.webSearch.maxResults', "Maximum number of search results to return per query. Higher values increase context length and API cost."),
                        scope: 4 /* ConfigurationScope.WINDOW */
                },
                'construct.webSearch.cacheTtlMs': {
                        type: 'number',
                        default: 600000,
                        minimum: 0,
                        description: localize('construct.webSearch.cacheTtlMs', "Cache duration in milliseconds for repeated queries. Set to 0 to disable caching. Default: 10 minutes."),
                        scope: 4 /* ConfigurationScope.WINDOW */
                }
        }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(webSearchConfiguration);
