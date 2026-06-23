/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const ISecureKeyManager = createDecorator<ISecureKeyManager>('kovix.secureKeyManager');

/**
 * Supported LLM providers for API key management.
 *
 * Kovix v1.2.0 expanded this enum from 5 to 12 first-class providers,
 * covering all major OpenAI-compatible endpoints. The 'custom' type is
 * retained for user-defined endpoints that don't match any of the
 * built-in presets.
 *
 * Provider → endpoint mapping lives in SecureKeyManagerService.DEFAULT_ENDPOINTS.
 * Provider → label mapping lives in SecureKeyManagerService.PROVIDER_LABELS.
 */
export type LLMProvider =
        | 'anthropic'    // Claude API (api.anthropic.com) — native Anthropic format
        | 'openai'       // OpenAI API (api.openai.com) — OpenAI Chat Completions
        | 'nvidia'       // NVIDIA NIM (integrate.api.nvidia.com/v1) — OpenAI-compatible
        | 'openrouter'   // OpenRouter (openrouter.ai/api/v1) — OpenAI-compatible, multi-model router
        | 'lmstudio'     // LM Studio local (localhost:1234/v1) — OpenAI-compatible, no auth
        | 'together'     // Together AI (api.together.xyz/v1) — OpenAI-compatible
        | 'groq'         // Groq (api.groq.com/openai/v1) — OpenAI-compatible, fast inference
        | 'mistral'      // Mistral AI (api.mistral.ai/v1) — OpenAI-compatible
        | 'gemini'       // Google Gemini (generativelanguage.googleapis.com/v1beta/openai) — OpenAI-compatible mode
        | 'deepseek'     // DeepSeek (api.deepseek.com/v1) — OpenAI-compatible
        | 'ollama'       // Ollama local (localhost:11434) — native Ollama API
        | 'litellm'      // LiteLLM proxy (user-defined) — OpenAI-compatible router
        | 'custom';      // Custom OpenAI-compatible endpoint (user-defined)

/**
 * Configuration for a provider endpoint.
 */
export interface IProviderConfig {
        /** Unique identifier for this provider configuration. */
        id: string;
        /** Display name shown in settings UI. */
        name: string;
        /** Provider type. */
        provider: LLMProvider;
        /** API endpoint URL. Defaults to provider's standard endpoint if not specified. */
        endpoint?: string;
        /** Whether this provider is currently active/selected. */
        isActive: boolean;
        /** Additional provider-specific settings (e.g., Ollama model list). */
        extra?: Record<string, unknown>;
}

/**
 * Result of a provider health check / connection test.
 */
export interface IProviderHealthResult {
        /** Whether the connection was successful. */
        healthy: boolean;
        /** Latency in milliseconds for the round-trip test. */
        latencyMs: number;
        /** Error message if the connection failed. */
        error?: string;
        /** Available models if the provider responded with a model list. */
        models?: string[];
}

/**
 * Masked key display format (e.g., "sk-ant-...XXXX").
 */
export interface IMaskedKey {
        /** The masked display string safe for UI rendering. */
        display: string;
        /** The provider this key belongs to. */
        provider: LLMProvider;
        /** Whether a key is stored for this provider. */
        hasKey: boolean;
}

/**
 * Service for securely managing LLM provider API keys.
 *
 * Keys are stored in the OS keychain via VS Code's SecretStorage API.
 * No plaintext keys are ever written to settings.json, environment variables,
 * or log files. Only masked previews are stored in configuration.
 */
export interface ISecureKeyManager {
        readonly _serviceBrand: undefined;

        /**
         * Store an API key for a provider in the OS keychain.
         * The key is validated against provider-specific format rules before storage.
         *
         * @param provider The LLM provider.
         * @param key The API key to store.
         * @throws Error if the key format is invalid for the provider.
         */
        setKey(provider: LLMProvider, key: string): Promise<void>;

        /**
         * Retrieve an API key for a provider from the OS keychain.
         *
         * @param provider The LLM provider.
         * @returns The API key, or null if none is stored.
         */
        getKey(provider: LLMProvider): Promise<string | null>;

        /**
         * Delete the stored API key for a provider.
         *
         * @param provider The LLM provider.
         */
        deleteKey(provider: LLMProvider): Promise<void>;

        /**
         * Get a masked display version of the stored key.
         * Format: first 7 chars + "..." + last 4 chars (e.g., "sk-ant-...XXXX").
         * Returns { hasKey: false } if no key is stored.
         *
         * @param provider The LLM provider.
         */
        getMaskedKey(provider: LLMProvider): Promise<IMaskedKey>;

        /**
         * Validate an API key format without storing it.
         * Checks provider-specific patterns:
         * - Anthropic: must start with "sk-ant-"
         * - OpenAI: must start with "sk-"
         * - Ollama: no key required (always valid)
         * - LiteLLM/custom: non-empty string
         *
         * @param provider The LLM provider.
         * @param key The API key to validate.
         * @returns Whether the key format is valid, and an error message if not.
         */
        validateKey(provider: LLMProvider, key: string): { valid: boolean; error?: string };

        /**
         * Test the connection to a provider using the stored key.
         * Sends a minimal request to verify the key works and the endpoint is reachable.
         *
         * - Anthropic: GET /v1/models (or minimal messages request)
         * - OpenAI: GET /v1/models
         * - Ollama: GET /api/tags
         * - LiteLLM/custom: GET /health or GET /v1/models
         *
         * @param providerConfig Provider configuration including endpoint.
         * @returns Health check result with latency and available models.
         */
        testConnection(providerConfig: IProviderConfig): Promise<IProviderHealthResult>;

        /**
         * Get all configured providers with their masked keys.
         */
        getAllProviders(): Promise<IProviderConfig[]>;

        /**
         * Set the active provider configuration.
         *
         * @param providerConfig The provider config to make active.
         */
        setActiveProvider(providerConfig: IProviderConfig): Promise<void>;

        /**
         * Get the currently active provider configuration.
         */
        getActiveProvider(): Promise<IProviderConfig | null>;

        /**
         * Event fired when a key is added, removed, or changed.
         */
        readonly onDidChangeKey: Event<LLMProvider>;

        /**
         * Event fired when the active provider changes.
         */
        readonly onDidChangeActiveProvider: Event<IProviderConfig>;
}
