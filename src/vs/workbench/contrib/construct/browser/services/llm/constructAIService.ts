/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import {
        IConstructAIProvider, AIProviderType, AIStreamEvent, IChatMessage,
        IChatOptions, ICompleteOptions, ICompleteResult, IModelInfo,
        IToolDefinition, ProviderStatus
} from '../../../../../../platform/construct/common/llm/constructAIProvider.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { ISecureKeyManager } from '../../../../../../platform/construct/common/security/secureKeyManager.js';
import { OllamaProvider } from './ollamaProvider.js';
import { XenovaProvider } from './xenovaProvider.js';
import { CloudProvider } from './cloudProvider.js';

const STORAGE_KEY_PREFERRED_PROVIDER = 'kovix.preferredProvider';

/**
 * ConstructAIService — the unified AI service that auto-selects the best provider.
 *
 * This service orchestrates three AI providers:
 * 1. OllamaProvider — local inference via Ollama (preferred)
 * 2. XenovaProvider — in-process ONNX models (offline fallback)
 * 3. CloudProvider — optional OpenAI-compatible API (last resort)
 *
 * At startup, it checks each provider in priority order and selects the
 * first one that reports ProviderStatus.Available. If the user has
 * explicitly chosen a provider via settings, that preference is honored.
 *
 * OFFLINE FIRST: Ollama and Xenova are preferred over Cloud.
 * The status bar shows whether the active provider is local or cloud.
 *
 * Graceful degradation:
 * - If no provider is available, chat() yields an error event with
 *   instructions for the user to install Ollama or configure a cloud key.
 * - Provider status is continuously monitored; if a provider goes down,
 *   auto-select switches to the next available one.
 */
export class ConstructAIService extends Disposable implements IConstructAIService {
        readonly _serviceBrand: undefined;

        private readonly _providers: Map<AIProviderType, IConstructAIProvider> = new Map();
        private _activeProvider: IConstructAIProvider | undefined;

        /** Active stream controller, aborted when switching providers. */
        private _activeStreamController: AbortController | null = null;

        private readonly _onDidChangeActiveProvider = this._register(new Emitter<AIProviderType>());
        readonly onDidChangeActiveProvider = this._onDidChangeActiveProvider.event;
        private readonly _onDidChangeActiveModel = this._register(new Emitter<IModelInfo | undefined>());
        readonly onDidChangeActiveModel = this._onDidChangeActiveModel.event;

        /** Cached lazy reference to ISecureKeyManager (resolved post-ctor to break DI cycle). */
        private _keyManager: ISecureKeyManager | undefined;

        constructor(
                @ILogService private readonly logService: ILogService,
                @INotificationService private readonly notificationService: INotificationService,
                @IConfigurationService configurationService: IConfigurationService,
                @IStorageService private readonly storageService: IStorageService,
                // BUGFIX (v1.2.0): break the constructor-time DI cycle
                // kovix.aiService ↔ construct.secureKeyManager.
                // Previously @ISecureKeyManager was injected here directly, and
                // SecureKeyManager injected @IConstructAIService — the
                // instantiator cannot satisfy a cycle and throws
                // "Error: cyclic dependency between services", which crashed
                // every Construct workbench contribution (status bar, autocomplete,
                // and the agent panel itself) on Kovix v1.1.0.
                // Fix: take IInstantiationService instead and lazily resolve
                // ISecureKeyManager on first use. Both services still see each
                // other at runtime — just not during construction.
                @IInstantiationService private readonly _instantiationService: IInstantiationService,
        ) {
                super();

                // Instantiate the providers that don't need the key manager synchronously.
                const ollama = new OllamaProvider(logService, configurationService);
                const xenova = new XenovaProvider(logService, configurationService);

                this._providers.set('ollama', ollama);
                this._providers.set('xenova', xenova);

                // CloudProvider needs ISecureKeyManager — register it lazily so we
                // don't trigger SecureKeyManager construction (which would re-enter
                // IConstructAIService and trip the cycle). The CloudProvider is
                // instantiated on first use of getProvider('cloud') or autoSelect.
                this._providers.set('cloud', new LazyCloudProvider(() => this._resolveKeyManager(), logService, configurationService, storageService));

                // Listen for provider status changes
                for (const [type, provider] of this._providers) {
                        this._register(provider.onDidChangeStatus(() => {
                                this.logService.info('[ConstructAIService] Provider ' + type + ' status changed to: ' + provider.checkStatus());
                        }));
                        this._register(provider.onDidChangeActiveModel((model) => {
                                if (provider === this._activeProvider) {
                                        this._onDidChangeActiveModel.fire(model);
                                }
                        }));
                }

                this.logService.info('[ConstructAIService] Initialized with 3 providers (ollama, xenova, cloud)');
        }

        get activeProvider(): IConstructAIProvider | undefined {
                return this._activeProvider;
        }

        get activeProviderType(): AIProviderType | undefined {
                return this._activeProvider?.providerType;
        }

        async autoSelectProvider(): Promise<IConstructAIProvider | undefined> {
                // Check if user has a preferred provider
                const preferred = this.storageService.get(STORAGE_KEY_PREFERRED_PROVIDER, 0 /* StorageScope.APPLICATION */);
                if (preferred) {
                        const preferredProvider = this._providers.get(preferred as AIProviderType);
                        if (preferredProvider) {
                                const status = await preferredProvider.checkStatus();
                                if (status === ProviderStatus.Available) {
                                        this._setActiveProvider(preferred as AIProviderType);
                                        return this._activeProvider;
                                }
                        }
                }

                // Auto-select in priority order: Ollama > Xenova > Cloud
                const priorityOrder: AIProviderType[] = ['ollama', 'xenova', 'cloud'];

                for (const type of priorityOrder) {
                        const provider = this._providers.get(type);
                        if (!provider) { continue; }

                        this.logService.info('[ConstructAIService] Checking provider: ' + type);
                        const status = await provider.checkStatus();

                        if (status === ProviderStatus.Available) {
                                this._setActiveProvider(type);
                                this.logService.info('[ConstructAIService] Auto-selected provider: ' + type);
                                return this._activeProvider;
                        }

                        this.logService.info('[ConstructAIService] Provider ' + type + ' not available (status: ' + status + ')');
                }

                // No provider available
                this.logService.warn('[ConstructAIService] No AI provider available. User needs to install Ollama or configure a cloud API key.');
                this.notificationService.warn(
                        'CONSTRUCT: No AI provider available. Install Ollama (ollama.ai) or configure a cloud API key in settings.'
                );
                return undefined;
        }

        async switchProvider(providerType: AIProviderType): Promise<boolean> {
                const provider = this._providers.get(providerType);
                if (!provider) {
                        this.logService.warn('[ConstructAIService] Unknown provider type: ' + providerType);
                        return false;
                }

                const status = await provider.checkStatus();
                if (status !== ProviderStatus.Available) {
                        this.logService.warn('[ConstructAIService] Provider ' + providerType + ' is not available (status: ' + status + ')');
                        if (providerType === 'xenova' && status === ProviderStatus.Unreachable) {
                                this.notificationService.warn(
                                        'Xenova (in-process AI) is unavailable because Electron sandbox blocks Web Workers. ' +
                                        'To use local AI: install Ollama (https://ollama.ai) or configure a cloud provider. ' +
                                        'Cloud providers (Anthropic, OpenAI) are not affected by this limitation.'
                                );
                        } else {
                                this.notificationService.warn(
                                        'CONSTRUCT: ' + providerType.charAt(0).toUpperCase() + providerType.slice(1) + ' provider is not available. Status: ' + status
                                );
                        }
                        return false;
                }

                // Save preference
                this.storageService.store(STORAGE_KEY_PREFERRED_PROVIDER, providerType, 0 /* StorageScope.APPLICATION */, 1 /* StorageTarget.MACHINE */);
                this._setActiveProvider(providerType);
                this.logService.info('[ConstructAIService] Switched to provider: ' + providerType);
                return true;
        }

        async getAllProviderStatuses(): Promise<Map<AIProviderType, ProviderStatus>> {
                const statuses = new Map<AIProviderType, ProviderStatus>();
                for (const [type, provider] of this._providers) {
                        statuses.set(type, await provider.checkStatus());
                }
                return statuses;
        }

        getProvider(type: AIProviderType): IConstructAIProvider | undefined {
                return this._providers.get(type);
        }

        async *chat(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                if (!this._activeProvider) {
                        yield {
                                type: 'error',
                                text: 'No AI provider available. Please install Ollama (https://ollama.ai) or configure a cloud API key in CONSTRUCT settings.',
                        };
                        return;
                }

                // Bug 4 fix: Create an AbortController so we can abort on provider switch
                const streamController = new AbortController();
                this._activeStreamController = streamController;
                // Chain the user's signal with our controller
                if (options?.signal) {
                        options.signal.addEventListener('abort', () => streamController.abort());
                }

                const mergedOptions: IChatOptions = {
                        ...options,
                        signal: streamController.signal,
                };

                try {
                        yield* this._activeProvider.chat(messages, tools, mergedOptions);
                } finally {
                        this._activeStreamController = null;
                }
        }

        async complete(prefix: string, suffix: string, options?: ICompleteOptions): Promise<ICompleteResult> {
                if (!this._activeProvider) {
                        return { text: '', finished: true };
                }
                return this._activeProvider.complete(prefix, suffix, options);
        }

        async listModels(): Promise<IModelInfo[]> {
                if (!this._activeProvider) {
                        return [];
                }
                return this._activeProvider.listModels();
        }

        getActiveModel(): IModelInfo | undefined {
                return this._activeProvider?.getActiveModel();
        }

        async setActiveModel(modelId: string): Promise<boolean> {
                if (!this._activeProvider) {
                        return false;
                }
                return this._activeProvider.setActiveModel(modelId);
        }

        isOffline(): boolean {
                return this._activeProvider?.isOffline() ?? false;
        }

        // --- Private helpers ---

        /**
         * Lazily resolve ISecureKeyManager on first use. This MUST NOT be called
         * from the constructor — only from runtime methods. Breaking this rule
         * re-introduces the cyclic dependency that crashed Kovix v1.1.0.
         */
        private _resolveKeyManager(): ISecureKeyManager {
                if (!this._keyManager) {
                        this._keyManager = this._instantiationService.invokeFunction(accessor => accessor.get(ISecureKeyManager));
                }
                return this._keyManager;
        }

        private _setActiveProvider(type: AIProviderType): void {
                // Bug 4 fix: Abort any in-flight stream before switching providers
                if (this._activeStreamController) {
                        this._activeStreamController.abort();
                        this._activeStreamController = null;
                }

                this._activeProvider = this._providers.get(type);
                this._onDidChangeActiveProvider.fire(type);
                if (this._activeProvider) {
                        this._onDidChangeActiveModel.fire(this._activeProvider.getActiveModel());
                }
        }

        override dispose(): void {
                for (const provider of this._providers.values()) {
                        provider.dispose();
                }
                this._providers.clear();
                super.dispose();
        }
}

/**
 * LazyCloudProvider — proxy that defers construction of the real CloudProvider
 * until the first method call. This breaks the constructor-time DI cycle
 * between IConstructAIService and ISecureKeyManager in Kovix v1.2.0.
 *
 * The proxy implements the full IConstructAIProvider surface, forwarding every
 * call to a real CloudProvider that is created on first use with a freshly
 * resolved ISecureKeyManager.
 */
class LazyCloudProvider extends Disposable implements IConstructAIProvider {
        readonly _serviceBrand: undefined;

        private _inner: CloudProvider | undefined;
        private readonly _onDidChangeActiveModel = this._register(new Emitter<IModelInfo | undefined>());
        readonly onDidChangeActiveModel = this._onDidChangeActiveModel.event;
        private readonly _onDidChangeStatus = this._register(new Emitter<ProviderStatus>());
        readonly onDidChangeStatus = this._onDidChangeStatus.event;

        constructor(
                private readonly _keyManagerResolver: () => ISecureKeyManager,
                private readonly _logService: ILogService,
                private readonly _configurationService: IConfigurationService,
                private readonly _storageService: IStorageService,
        ) {
                super();
        }

        readonly providerType: AIProviderType = 'cloud';

        private _innerProvider(): CloudProvider {
                if (!this._inner) {
                        this._inner = new CloudProvider(
                                this._logService,
                                this._configurationService,
                                this._storageService,
                                this._keyManagerResolver(),
                        );
                        this._register(this._inner.onDidChangeActiveModel(m => this._onDidChangeActiveModel.fire(m)));
                        this._register(this._inner.onDidChangeStatus(s => this._onDidChangeStatus.fire(s)));
                }
                return this._inner;
        }

        async *chat(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                yield* this._innerProvider().chat(messages, tools, options);
        }

        async complete(prefix: string, suffix: string, options?: ICompleteOptions): Promise<ICompleteResult> {
                return this._innerProvider().complete(prefix, suffix, options);
        }

        async listModels(): Promise<IModelInfo[]> {
                return this._innerProvider().listModels();
        }

        getActiveModel(): IModelInfo | undefined {
                if (!this._inner) {
                        return undefined;
                }
                return this._inner.getActiveModel();
        }

        async setActiveModel(modelId: string): Promise<boolean> {
                return this._innerProvider().setActiveModel(modelId);
        }

        isOffline(): boolean {
                return false;
        }

        async checkStatus(): Promise<ProviderStatus> {
                try {
                        return await this._innerProvider().checkStatus();
                } catch (err) {
                        this._logService.warn('[LazyCloudProvider] checkStatus failed: ' + (err as Error).message);
                        return ProviderStatus.Unreachable;
                }
        }

        override dispose(): void {
                this._inner?.dispose();
                super.dispose();
        }
}
