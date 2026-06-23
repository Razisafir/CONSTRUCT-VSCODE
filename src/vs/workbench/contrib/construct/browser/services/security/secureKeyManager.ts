/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ISecretStorageService } from '../../../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ISecureKeyManager, LLMProvider, IProviderConfig, IProviderHealthResult, IMaskedKey } from '../../../../../../platform/construct/common/security/secureKeyManager.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { AIProviderType } from '../../../../../../platform/construct/common/llm/constructAIProvider.js';

// Storage keys for non-sensitive configuration
const STORAGE_KEY_PREFIX = 'kovix.keyManager';
// P0-2: Generic cloud API key storage key for CloudProvider backward compatibility
const STORAGE_KEY_CLOUD_API_KEY = 'kovix.cloud.apiKey';
const MASKED_KEY_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.maskedKeys`;
const ACTIVE_PROVIDER_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.activeProvider`;
const PROVIDERS_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.providers`;

// Secret storage key prefix for actual API keys
const SECRET_KEY_PREFIX = 'kovix.apiKey';

/**
 * Default endpoints per provider type.
 *
 * Kovix v1.2.0: expanded to cover all major OpenAI-compatible endpoints.
 * Anthropic uses its native API (handled separately in CloudProvider).
 * Ollama uses its native API (handled separately in OllamaProvider).
 * All others are OpenAI-compatible and route through CloudProvider with
 * the appropriate base URL.
 */
export const DEFAULT_ENDPOINTS: Record<LLMProvider, string> = {
        anthropic: 'https://api.anthropic.com',
        openai: 'https://api.openai.com',
        nvidia: 'https://integrate.api.nvidia.com/v1',
        openrouter: 'https://openrouter.ai/api/v1',
        lmstudio: 'http://localhost:1234/v1',
        together: 'https://api.together.xyz/v1',
        groq: 'https://api.groq.com/openai/v1',
        mistral: 'https://api.mistral.ai/v1',
        gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
        deepseek: 'https://api.deepseek.com/v1',
        ollama: 'http://localhost:11434',
        litellm: '',
        custom: '',
};

/**
 * Human-readable labels per provider type.
 * Shown in the provider settings UI and the model picker dropdown.
 */
export const PROVIDER_LABELS: Record<LLMProvider, string> = {
        anthropic: 'Anthropic',
        openai: 'OpenAI',
        nvidia: 'NVIDIA NIM',
        openrouter: 'OpenRouter',
        lmstudio: 'LM Studio',
        together: 'Together AI',
        groq: 'Groq',
        mistral: 'Mistral AI',
        gemini: 'Google Gemini',
        deepseek: 'DeepSeek',
        ollama: 'Ollama',
        litellm: 'LiteLLM',
        custom: 'Custom',
};

/**
 * Whether a provider requires an API key.
 * Local providers (Ollama, LM Studio) don't need keys.
 */
export const REQUIRES_KEY: Record<LLMProvider, boolean> = {
        anthropic: true,
        openai: true,
        nvidia: true,
        openrouter: true,
        lmstudio: false,
        together: true,
        groq: true,
        mistral: true,
        gemini: true,
        deepseek: true,
        ollama: false,
        litellm: false,
        custom: false,
};

/**
 * Whether a provider is local (no internet required).
 * Used to group providers in the settings UI.
 */
export const IS_LOCAL: Record<LLMProvider, boolean> = {
        anthropic: false,
        openai: false,
        nvidia: false,
        openrouter: false,
        lmstudio: true,
        together: false,
        groq: false,
        mistral: false,
        gemini: false,
        deepseek: false,
        ollama: true,
        litellm: true, // assume local proxy
        custom: false,
};

/**
 * Known default models per provider.
 * Used to populate the model picker when the provider's /models endpoint
 * is unreachable or returns no models. These lists are intentionally short
 * (3-6 entries) — the live /models response is preferred when available.
 */
export const DEFAULT_MODELS: Record<LLMProvider, { id: string; displayName: string }[]> = {
        anthropic: [
                { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
                { id: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet' },
                { id: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku' },
        ],
        openai: [
                { id: 'gpt-4o', displayName: 'GPT-4o' },
                { id: 'gpt-4o-mini', displayName: 'GPT-4o mini' },
                { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
                { id: 'o1-preview', displayName: 'o1-preview' },
                { id: 'o1-mini', displayName: 'o1-mini' },
        ],
        nvidia: [
                // Kovix v1.3.1: refreshed against the live NVIDIA NIM catalog (June 2026).
                // Removed stale entries (llama-3.1-405b, qwen2.5-coder-32b, deepseek-r1) that
                // are no longer on the endpoint and would cause "model not found" errors
                // when the /v1/models fetch fails and this fallback list is used.
                { id: 'meta/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B Instruct' },
                { id: 'meta/llama-3.1-70b-instruct', displayName: 'Llama 3.1 70B Instruct' },
                { id: 'meta/llama-3.1-8b-instruct', displayName: 'Llama 3.1 8B Instruct' },
                { id: 'nvidia/llama-3.1-nemotron-70b-instruct', displayName: 'Nemotron 70B Instruct' },
                { id: 'mistralai/mistral-large-2-instruct', displayName: 'Mistral Large 2' },
                { id: 'mistralai/codestral-22b-instruct-v0.1', displayName: 'Codestral 22B (coding)' },
        ],
        openrouter: [
                { id: 'anthropic/claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet (via OpenRouter)' },
                { id: 'openai/gpt-4o', displayName: 'GPT-4o (via OpenRouter)' },
                { id: 'google/gemini-flash-1.5', displayName: 'Gemini Flash 1.5 (via OpenRouter)' },
                { id: 'meta-llama/llama-3.1-405b-instruct', displayName: 'Llama 3.1 405B (via OpenRouter)' },
                { id: 'qwen/qwen-2.5-72b-instruct', displayName: 'Qwen 2.5 72B (via OpenRouter)' },
                { id: 'deepseek/deepseek-chat', displayName: 'DeepSeek Chat (via OpenRouter)' },
        ],
        lmstudio: [
                // LM Studio models are user-loaded; default list is empty.
                // The /v1/models endpoint will return whatever the user has loaded.
        ],
        together: [
                { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', displayName: 'Llama 3.3 70B Turbo' },
                { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', displayName: 'Llama 3.1 405B Turbo' },
                { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', displayName: 'Qwen 2.5 72B Turbo' },
        ],
        groq: [
                { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile' },
                { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant' },
                { id: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B' },
                { id: 'gemma2-9b-it', displayName: 'Gemma 2 9B' },
        ],
        mistral: [
                { id: 'mistral-large-latest', displayName: 'Mistral Large' },
                { id: 'mistral-small-latest', displayName: 'Mistral Small' },
                { id: 'codestral-latest', displayName: 'Codestral' },
                { id: 'open-mixtral-8x22b', displayName: 'Mixtral 8x22B' },
        ],
        gemini: [
                { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
                { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
                { id: 'gemini-2.0-flash-exp', displayName: 'Gemini 2.0 Flash (exp)' },
        ],
        deepseek: [
                { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
                { id: 'deepseek-coder', displayName: 'DeepSeek Coder' },
                { id: 'deepseek-reasoner', displayName: 'DeepSeek R1' },
        ],
        ollama: [
                { id: 'qwen2.5-coder:7b', displayName: 'Qwen2.5 Coder 7B' },
                { id: 'qwen2.5-coder:1.5b', displayName: 'Qwen2.5 Coder 1.5B' },
                { id: 'llama3.2:3b', displayName: 'Llama 3.2 3B' },
                { id: 'codellama:7b', displayName: 'Code Llama 7B' },
                { id: 'deepseek-coder:6.7b', displayName: 'DeepSeek Coder 6.7B' },
        ],
        litellm: [
                // LiteLLM proxy models are user-defined; default list is empty.
        ],
        custom: [
                // Custom endpoint models are user-defined; default list is empty.
        ],
};

/**
 * Service for securely managing LLM provider API keys.
 *
 * Sensitive keys are stored in the OS keychain via VS Code's ISecretStorageService
 * (which delegates to the OS credential store / keychain). No plaintext keys are
 * ever persisted to settings.json or other configuration files. Only masked previews
 * are stored in IStorageService for display purposes.
 */
export class SecureKeyManagerService extends Disposable implements ISecureKeyManager {
        declare readonly _serviceBrand: undefined;

        private readonly _onDidChangeKey = this._register(new Emitter<LLMProvider>());
        readonly onDidChangeKey = this._onDidChangeKey.event;

        private readonly _onDidChangeActiveProvider = this._register(new Emitter<IProviderConfig>());
        readonly onDidChangeActiveProvider = this._onDidChangeActiveProvider.event;

        /** In-memory cache of decrypted keys to avoid repeated keychain reads. */
        private keyCache: Map<LLMProvider, string> = new Map();

        /** Cached lazy reference to IConstructAIService (resolved post-ctor to break DI cycle). */
        private _aiService: IConstructAIService | undefined;

        constructor(
                @ISecretStorageService private readonly secretStorageService: ISecretStorageService,
                @IStorageService private readonly storageService: IStorageService,
                @ILogService private readonly logService: ILogService,
                // BUGFIX (v1.2.0): break the constructor-time DI cycle
                // kovix.aiService ↔ construct.secureKeyManager.
                // Previously @IConstructAIService was injected here directly, and
                // ConstructAIService injected @ISecureKeyManager — the VS Code
                // instantiator cannot satisfy a cycle and throws
                // "Error: cyclic dependency between services", which crashed
                // every Construct workbench contribution (status bar, autocomplete,
                // and the agent panel itself) on Kovix v1.1.0.
                // Fix: take IInstantiationService and lazily resolve
                // IConstructAIService on first use (here only for subscribing to
                // onDidChangeActiveProvider, which we can safely defer).
                @IInstantiationService private readonly _instantiationService: IInstantiationService,
        ) {
                super();

                // Listen for external secret changes (e.g. another window changed the key)
                this._register(this.secretStorageService.onDidChangeSecret(key => {
                        if (key.startsWith(SECRET_KEY_PREFIX)) {
                                const provider = key.slice(SECRET_KEY_PREFIX.length + 1) as LLMProvider;
                                // Invalidate the cache entry so next getKey() reads fresh from keychain
                                this.keyCache.delete(provider);
                                this._onDidChangeKey.fire(provider);
                                this.logService.trace(`[SecureKeyManager] External key change detected for provider: ${provider}`);
                        }
                }));

                // Bridge: when IConstructAIService switches provider, sync the active
                // provider in key manager. This eliminates the split-brain where one
                // system shows "cloud" and the other still shows "ollama".
                //
                // BUGFIX (v1.2.0): This subscription is deferred to a microtask so the
                // SecureKeyManager constructor returns before trying to resolve
                // IConstructAIService. The instantiator will have finished wiring both
                // services by the time the microtask runs.
                setTimeout(() => {
                        try {
                                const aiService = this._resolveAIService();
                                this._register(aiService.onDidChangeActiveProvider((providerType: AIProviderType) => {
                                        const mapping: Partial<Record<AIProviderType, LLMProvider>> = {
                                                ollama: 'ollama',
                                                cloud: 'openai',
                                                xenova: 'ollama', // xenova doesn't need keys; map to ollama
                                        };
                                        const llmProvider = mapping[providerType];
                                        if (llmProvider) {
                                                const config: IProviderConfig = {
                                                        id: `construct-${llmProvider}`,
                                                        name: PROVIDER_LABELS[llmProvider],
                                                        provider: llmProvider,
                                                        endpoint: DEFAULT_ENDPOINTS[llmProvider],
                                                        isActive: true,
                                                };
                                                // Update storage without re-firing the event (avoid infinite loop)
                                                this.storageService.store(ACTIVE_PROVIDER_STORAGE_KEY, JSON.stringify(config), StorageScope.APPLICATION, StorageTarget.USER);
                                                this.logService.info(`[SecureKeyManager] Synced active provider from AIService: ${providerType} -> ${llmProvider}`);
                                        }
                                }));
                        } catch (err) {
                                this.logService.warn('[SecureKeyManager] Deferred AIService bridge subscription failed: ' + (err as Error).message);
                        }
                }, 0);
        }

        /**
         * Lazily resolve IConstructAIService on first use. This MUST NOT be called
         * from the constructor — only from runtime methods or deferred callbacks.
         */
        private _resolveAIService(): IConstructAIService {
                if (!this._aiService) {
                        this._aiService = this._instantiationService.invokeFunction(accessor => accessor.get(IConstructAIService));
                }
                return this._aiService;
        }

        // ─── Key CRUD ────────────────────────────────────────────────────────────────

        async setKey(provider: LLMProvider, key: string): Promise<void> {
                const validation = this.validateKey(provider, key);
                if (!validation.valid) {
                        throw new Error(validation.error ?? `Invalid key format for ${PROVIDER_LABELS[provider]}`);
                }

                const secretKey = this.getSecretKey(provider);
                await this.secretStorageService.set(secretKey, key);

                // Update in-memory cache
                this.keyCache.set(provider, key);

                // Store masked version for display in settings UI
                const masked = this.computeMaskedDisplay(key);
                this.storeMaskedKey(provider, masked);

                // SEC-7 (C1 fix): Removed plaintext IStorageService.store() calls.
                // The OS keychain (ISecretStorageService) is the single source of truth.
                // Writing the key to IStorageService as well defeated the keychain's
                // encryption-at-rest and per-app ACLs — any process with read access
                // to ~/.config/Kovix/User/globalStorage/storage.json could recover
                // every provider key. CloudProvider has been updated to read from
                // SecureKeyManager directly. Legacy plaintext keys left by previous
                // versions are migrated on first read (see getKey() below) and then
                // purged from IStorageService.

                this.logService.info(`[SecureKeyManager] API key stored for provider: ${provider}`);
                this._onDidChangeKey.fire(provider);
        }

        async getKey(provider: LLMProvider): Promise<string | null> {
                // Check cache first
                const cached = this.keyCache.get(provider);
                if (cached !== undefined) {
                        return cached;
                }

                const secretKey = this.getSecretKey(provider);
                const value = await this.secretStorageService.get(secretKey);

                if (value !== undefined && value !== null) {
                        this.keyCache.set(provider, value);
                        return value;
                }

                // SEC-7 (C1 fix): One-time migration of legacy plaintext keys.
                // Previous versions wrote API keys to IStorageService (plaintext JSON
                // on disk) in addition to the OS keychain. If the keychain is empty
                // but a legacy plaintext entry exists, migrate it into the keychain
                // and purge the plaintext copy. This runs at most once per provider
                // per profile — after migration the plaintext entry is gone.
                const legacyStorageKey = `construct.${provider}.apiKey`;
                const legacyValue = this.storageService.get(legacyStorageKey, StorageScope.PROFILE);
                if (legacyValue) {
                        await this.secretStorageService.set(secretKey, legacyValue);
                        this.storageService.remove(legacyStorageKey, StorageScope.PROFILE);
                        // Also purge the generic cloud key if this provider wrote it
                        if (provider === 'openai' || provider === 'anthropic' || provider === 'litellm' || provider === 'custom') {
                                this.storageService.remove(STORAGE_KEY_CLOUD_API_KEY, StorageScope.APPLICATION);
                        }
                        this.keyCache.set(provider, legacyValue);
                        this.logService.info(`[SecureKeyManager] Migrated legacy plaintext key for provider: ${provider} → OS keychain`);
                        return legacyValue;
                }

                // Also check the generic cloud API key (pre-migration CloudProvider wrote here)
                if (provider === 'openai' || provider === 'anthropic' || provider === 'litellm' || provider === 'custom') {
                        const genericValue = this.storageService.get(STORAGE_KEY_CLOUD_API_KEY, StorageScope.APPLICATION);
                        if (genericValue) {
                                await this.secretStorageService.set(secretKey, genericValue);
                                this.storageService.remove(STORAGE_KEY_CLOUD_API_KEY, StorageScope.APPLICATION);
                                this.keyCache.set(provider, genericValue);
                                this.logService.info(`[SecureKeyManager] Migrated legacy generic cloud key for provider: ${provider} → OS keychain`);
                                return genericValue;
                        }
                }

                return null;
        }

        async deleteKey(provider: LLMProvider): Promise<void> {
                const secretKey = this.getSecretKey(provider);
                await this.secretStorageService.delete(secretKey);

                // Clear cache
                this.keyCache.delete(provider);

                // Remove masked display
                this.removeMaskedKey(provider);

                // P0-2 FIX: Clean up IStorageService sync entries on delete
                const storageKey = `construct.${provider}.apiKey`;
                this.storageService.remove(storageKey, StorageScope.PROFILE);
                if (provider === 'openai' || provider === 'anthropic' || provider === 'litellm' || provider === 'custom') {
                        this.storageService.remove(STORAGE_KEY_CLOUD_API_KEY, StorageScope.APPLICATION);
                }

                this.logService.info(`[SecureKeyManager] API key deleted for provider: ${provider}`);
                this._onDidChangeKey.fire(provider);
        }

        async getMaskedKey(provider: LLMProvider): Promise<IMaskedKey> {
                const key = await this.getKey(provider);

                if (!key) {
                        return { display: '', provider, hasKey: false };
                }

                return {
                        display: this.computeMaskedDisplay(key),
                        provider,
                        hasKey: true,
                };
        }

        // ─── Validation ──────────────────────────────────────────────────────────────

        validateKey(provider: LLMProvider, key: string): { valid: boolean; error?: string } {
                // Local providers that don't require a key
                if (!REQUIRES_KEY[provider]) {
                        return { valid: true };
                }

                if (!key || key.trim().length === 0) {
                        return { valid: false, error: `API key for ${PROVIDER_LABELS[provider]} cannot be empty.` };
                }

                switch (provider) {
                        case 'anthropic':
                                if (!key.startsWith('sk-ant-')) {
                                        return { valid: false, error: 'Anthropic API keys must start with "sk-ant-".' };
                                }
                                break;

                        case 'openai':
                                if (!key.startsWith('sk-')) {
                                        return { valid: false, error: 'OpenAI API keys must start with "sk-".' };
                                }
                                break;

                        case 'nvidia':
                                // NVIDIA NIM keys start with "nvapi-"
                                if (!key.startsWith('nvapi-')) {
                                        return { valid: false, error: 'NVIDIA NIM API keys must start with "nvapi-".' };
                                }
                                break;

                        case 'openrouter':
                                // OpenRouter keys start with "sk-or-"
                                if (!key.startsWith('sk-or-')) {
                                        return { valid: false, error: 'OpenRouter API keys must start with "sk-or-".' };
                                }
                                break;

                        case 'groq':
                                // Groq keys are 56-char alphanumeric, typically start with "gsk_"
                                if (!key.startsWith('gsk_')) {
                                        return { valid: false, error: 'Groq API keys typically start with "gsk_".' };
                                }
                                break;

                        case 'together':
                        case 'mistral':
                        case 'gemini':
                        case 'deepseek':
                                // These providers use opaque API keys; non-empty is sufficient
                                break;

                        case 'litellm':
                        case 'custom':
                                // Non-empty string is sufficient
                                break;
                }

                return { valid: true };
        }

        // ─── Connection Testing ──────────────────────────────────────────────────────

        async testConnection(providerConfig: IProviderConfig): Promise<IProviderHealthResult> {
                const startTime = Date.now();
                const provider = providerConfig.provider;

                try {
                        const key = await this.getKey(provider);
                        const endpoint = providerConfig.endpoint ?? DEFAULT_ENDPOINTS[provider];

                        let result: IProviderHealthResult;

                        switch (provider) {
                                case 'anthropic':
                                        result = await this.testAnthropicConnection(key, endpoint);
                                        break;

                                case 'ollama':
                                        result = await this.testOllamaConnection(endpoint);
                                        break;

                                case 'lmstudio':
                                        // LM Studio is OpenAI-compatible with no auth; use generic test
                                        result = await this.testGenericConnection('', endpoint);
                                        break;

                                // Kovix v1.2.0: all OpenAI-compatible cloud providers route
                                // through the same testGenericConnection method. The endpoint
                                // differs per provider (DEFAULT_ENDPOINTS), but the request
                                // shape (GET /models with Bearer auth) is identical.
                                case 'openai':
                                case 'nvidia':
                                case 'openrouter':
                                case 'together':
                                case 'groq':
                                case 'mistral':
                                case 'gemini':
                                case 'deepseek':
                                case 'litellm':
                                case 'custom':
                                        result = await this.testGenericConnection(key, endpoint);
                                        break;

                                default:
                                        result = { healthy: false, latencyMs: Date.now() - startTime, error: `Unknown provider type: ${provider}` };
                        }

                        result.latencyMs = Date.now() - startTime;
                        return result;

                } catch (error) {
                        return {
                                healthy: false,
                                latencyMs: Date.now() - startTime,
                                error: error instanceof Error ? error.message : String(error),
                        };
                }
        }

        // ─── Provider Management ─────────────────────────────────────────────────────

        async getAllProviders(): Promise<IProviderConfig[]> {
                const raw = this.storageService.get(PROVIDERS_STORAGE_KEY, StorageScope.APPLICATION);
                if (!raw) {
                        return [];
                }

                try {
                        return JSON.parse(raw) as IProviderConfig[];
                } catch {
                        this.logService.warn('[SecureKeyManager] Failed to parse stored providers, resetting.');
                        return [];
                }
        }

        async setActiveProvider(providerConfig: IProviderConfig): Promise<void> {
                // Update isActive flag across all providers
                const providers = await this.getAllProviders();
                for (const p of providers) {
                        p.isActive = p.id === providerConfig.id;
                }
                this.storageService.store(PROVIDERS_STORAGE_KEY, JSON.stringify(providers), StorageScope.APPLICATION, StorageTarget.USER);

                // Store the active provider reference separately for quick lookup
                const activeConfig = { ...providerConfig, isActive: true };
                this.storageService.store(ACTIVE_PROVIDER_STORAGE_KEY, JSON.stringify(activeConfig), StorageScope.APPLICATION, StorageTarget.USER);

                // Bridge: sync the AI service provider when the key manager switches.
                // Map LLMProvider types to AIProviderType so IConstructAIService
                // stays in sync with the key manager's active provider.
                //
                // Kovix v1.2.0: All OpenAI-compatible cloud providers route through
                // the 'cloud' AIProviderType (which is CloudProvider under the hood).
                // CloudProvider reads the active provider's endpoint from this service
                // and routes the request accordingly.
                const providerToAIType: Partial<Record<LLMProvider, AIProviderType>> = {
                        ollama: 'ollama',
                        // All cloud providers route through CloudProvider:
                        anthropic: 'cloud',
                        openai: 'cloud',
                        nvidia: 'cloud',
                        openrouter: 'cloud',
                        lmstudio: 'cloud',
                        together: 'cloud',
                        groq: 'cloud',
                        mistral: 'cloud',
                        gemini: 'cloud',
                        deepseek: 'cloud',
                        litellm: 'cloud',
                        custom: 'cloud',
                };
                const aiProviderType = providerToAIType[providerConfig.provider];
                if (aiProviderType) {
                        try {
                                await this._resolveAIService().switchProvider(aiProviderType);
                        } catch (e) {
                                this.logService.warn(`[SecureKeyManager] Could not sync AIService provider: ${e instanceof Error ? e.message : String(e)}`);
                        }
                }

                this.logService.info(`[SecureKeyManager] Active provider set to: ${providerConfig.name} (${providerConfig.provider})`);
                this._onDidChangeActiveProvider.fire(activeConfig);
        }

        async getActiveProvider(): Promise<IProviderConfig | null> {
                const raw = this.storageService.get(ACTIVE_PROVIDER_STORAGE_KEY, StorageScope.APPLICATION);
                if (!raw) {
                        return null;
                }

                try {
                        return JSON.parse(raw) as IProviderConfig;
                } catch {
                        this.logService.warn('[SecureKeyManager] Failed to parse active provider, resetting.');
                        return null;
                }
        }

        // ─── Private Helpers ─────────────────────────────────────────────────────────

        /**
         * Build the secret storage key for a given provider.
         */
        private getSecretKey(provider: LLMProvider): string {
                return `${SECRET_KEY_PREFIX}.${provider}`;
        }

        /**
         * Compute a masked display string: first 7 chars + "..." + last 4 chars.
         * If the key is too short to mask meaningfully, show only the first 3 chars + "...".
         */
        private computeMaskedDisplay(key: string): string {
                if (key.length <= 11) {
                        return `${key.slice(0, 3)}...`;
                }
                return `${key.slice(0, 7)}...${key.slice(-4)}`;
        }

        /**
         * Persist a masked key display string to IStorageService.
         */
        private storeMaskedKey(provider: LLMProvider, maskedDisplay: string): void {
                const allMasked = this.loadAllMaskedKeys();
                allMasked[provider] = maskedDisplay;
                this.storageService.store(MASKED_KEY_STORAGE_KEY, JSON.stringify(allMasked), StorageScope.APPLICATION, StorageTarget.USER);
        }

        /**
         * Remove a masked key entry from IStorageService.
         */
        private removeMaskedKey(provider: LLMProvider): void {
                const allMasked = this.loadAllMaskedKeys();
                delete allMasked[provider];
                this.storageService.store(MASKED_KEY_STORAGE_KEY, JSON.stringify(allMasked), StorageScope.APPLICATION, StorageTarget.USER);
        }

        /**
         * Load all stored masked keys from IStorageService.
         */
        private loadAllMaskedKeys(): Record<string, string> {
                const raw = this.storageService.get(MASKED_KEY_STORAGE_KEY, StorageScope.APPLICATION);
                if (!raw) {
                        return {};
                }
                try {
                        return JSON.parse(raw) as Record<string, string>;
                } catch {
                        return {};
                }
        }

        // ─── Connection Test Implementations ─────────────────────────────────────────

        /**
         * Test Anthropic connection by sending a minimal messages request.
         * A 401 indicates a bad key, a 200/400 with proper shape indicates the key works.
         */
        private async testAnthropicConnection(key: string | null, endpoint: string): Promise<IProviderHealthResult> {
                if (!key) {
                        return { healthy: false, latencyMs: 0, error: 'No API key stored for Anthropic.' };
                }

                try {
                        const response = await fetch(`${endpoint}/v1/messages`, {
                                method: 'POST',
                                headers: {
                                        'Content-Type': 'application/json',
                                        'x-api-key': key,
                                        'anthropic-version': '2023-06-01',
                                },
                                body: JSON.stringify({
                                        model: 'claude-sonnet-4-20250514',
                                        max_tokens: 1,
                                        messages: [{ role: 'user', content: 'Hi' }],
                                }),
                        });

                        if (response.status === 401) {
                                return { healthy: false, latencyMs: 0, error: 'Authentication failed. Check your API key.' };
                        }

                        if (response.status === 200) {
                                return { healthy: true, latencyMs: 0 };
                        }

                        // Other status codes (400, 429, 500, etc.) indicate the key is accepted
                        // but there may be rate limits or other transient issues.
                        // We still consider the connection healthy if the key is valid.
                        if (response.status === 400 || response.status === 429) {
                                const body = await response.text().catch(() => '');
                                return { healthy: true, latencyMs: 0, error: `Key accepted, but received status ${response.status}: ${body.slice(0, 200)}` };
                        }

                        return { healthy: true, latencyMs: 0, error: `Unexpected status: ${response.status}` };
                } catch (error) {
                        return { healthy: false, latencyMs: 0, error: `Network error: ${error instanceof Error ? error.message : String(error)}` };
                }
        }

        /**
         * Test Ollama connection by fetching the tags endpoint.
         * Ollama does not require an API key.
         */
        private async testOllamaConnection(endpoint: string): Promise<IProviderHealthResult> {
                try {
                        const response = await fetch(`${endpoint}/api/tags`, {
                                method: 'GET',
                        });

                        if (response.status === 200) {
                                const body = await response.json().catch(() => null) as any;
                                const models: string[] = [];
                                if (body?.models && Array.isArray(body.models)) {
                                        for (const model of body.models) {
                                                if (model.name) {
                                                        models.push(model.name);
                                                }
                                        }
                                }
                                return { healthy: true, latencyMs: 0, models };
                        }

                        return { healthy: false, latencyMs: 0, error: `Ollama returned status ${response.status}. Is Ollama running?` };
                } catch (error) {
                        return { healthy: false, latencyMs: 0, error: `Cannot reach Ollama at ${endpoint}. Is it running? ${error instanceof Error ? error.message : String(error)}` };
                }
        }

        /**
         * Test a generic/LiteLLM connection by trying /v1/models first, then /health.
         */
        private async testGenericConnection(key: string | null, endpoint: string): Promise<IProviderHealthResult> {
                if (!endpoint) {
                        return { healthy: false, latencyMs: 0, error: 'No endpoint configured for this provider.' };
                }

                const headers: Record<string, string> = {
                        'Content-Type': 'application/json',
                };
                if (key) {
                        headers['Authorization'] = `Bearer ${key}`;
                }

                // Kovix v1.3.1 FIX: Normalize the models URL.
                // DEFAULT_ENDPOINTS already includes the API version path for most providers
                // (nvidia → /v1, openrouter → /api/v1, together → /v1, groq → /openai/v1,
                // mistral → /v1, deepseek → /v1, lmstudio → /v1). The previous code appended
                // "/v1/models" unconditionally, which produced "/v1/v1/models" for all of those
                // providers and made "Test Provider Connection" always fail with HTTP 404.
                // The fix: strip any trailing "/v1" (or "/api/v1" etc.) and append "/models",
                // so the URL is correct regardless of whether the endpoint already includes
                // a version segment. We also fall back to "/v1/models" if the endpoint has
                // no version segment at all (e.g. OpenAI's bare "https://api.openai.com").
                const modelsUrl = this.buildModelsUrl(endpoint);

                // Try {modelsUrl} first
                try {
                        const modelsResponse = await fetch(modelsUrl, {
                                method: 'GET',
                                headers,
                        });

                        if (modelsResponse.status === 200) {
                                const body = await modelsResponse.json().catch(() => null) as any;
                                const models: string[] = [];
                                if (body?.data && Array.isArray(body.data)) {
                                        for (const model of body.data) {
                                                if (model.id) {
                                                        models.push(model.id);
                                                }
                                        }
                                }
                                return { healthy: true, latencyMs: 0, models };
                        }

                        if (modelsResponse.status === 401) {
                                return { healthy: false, latencyMs: 0, error: 'Authentication failed. Check your API key and endpoint.' };
                        }
                } catch {
                        // /models failed, try /health as fallback
                }

                // Fallback: try /health endpoint on the bare host (no /v1)
                try {
                        const healthUrl = new URL('/health', endpoint).toString();
                        const healthResponse = await fetch(healthUrl, {
                                method: 'GET',
                                headers,
                        });

                        if (healthResponse.status === 200) {
                                return { healthy: true, latencyMs: 0 };
                        }

                        return { healthy: false, latencyMs: 0, error: `Health endpoint returned status ${healthResponse.status}.` };
                } catch (error) {
                        return { healthy: false, latencyMs: 0, error: `Cannot reach endpoint at ${endpoint}: ${error instanceof Error ? error.message : String(error)}` };
                }
        }

        /**
         * Build the correct /models URL for an OpenAI-compatible endpoint.
         *
         * Kovix v1.3.1: DEFAULT_ENDPOINTS is inconsistent about whether it includes
         * the /v1 version segment. Some endpoints end with /v1 (nvidia, openrouter,
         * together, groq, mistral, deepseek, lmstudio), others don't (openai bare
         * host). We handle both cases here so the test-connection command works for
         * every provider.
         *
         * Rules:
         * - If endpoint already ends with /v1, /v2, /api/v1, /openai/v1, etc.,
         *   append "/models" → ".../v1/models"
         * - Otherwise (bare host like "https://api.openai.com"), append "/v1/models"
         */
        private buildModelsUrl(endpoint: string): string {
                const trimmed = endpoint.replace(/\/+$/, ''); // strip trailing slashes
                if (/(\/v\d+|\/api\/v\d+|\/openai\/v\d+)$/i.test(trimmed)) {
                        return `${trimmed}/models`;
                }
                return `${trimmed}/v1/models`;
        }

        // ─── Lifecycle ───────────────────────────────────────────────────────────────

        override dispose(): void {
                this.keyCache.clear();
                super.dispose();
        }
}
