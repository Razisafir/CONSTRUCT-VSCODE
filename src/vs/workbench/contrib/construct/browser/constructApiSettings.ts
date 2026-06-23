/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecureKeyManager, LLMProvider, IProviderConfig } from '../../../../platform/construct/common/security/secureKeyManager.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';

// ─── Configuration Registration ──────────────────────────────────────────────────
// ponytail: 7 dead config keys removed (kovix.api.activeProvider, .anthropic.key,
//   .openai.key, .ollama.endpoint, .litellm.endpoint, .custom.endpoint, .custom.key).
//   None were ever read — ManageApiKeys uses ISecureKeyManager directly.
//   Kept: nothing. The block was 100% dead.

// ─── Provider Metadata ───────────────────────────────────────────────────────────

interface IProviderMeta {
        provider: LLMProvider;
        label: string;
        description: string;
        requiresKey: boolean;
        keyPrefix?: string;
        defaultEndpoint: string;
}

const PROVIDER_META: IProviderMeta[] = [
        {
                provider: 'anthropic',
                label: localize('providerAnthropic', "Anthropic"),
                description: localize('providerAnthropicDesc', "Claude models (Sonnet, Opus, Haiku). Requires API key."),
                requiresKey: true,
                keyPrefix: 'sk-ant-',
                defaultEndpoint: 'https://api.anthropic.com',
        },
        {
                provider: 'openai',
                label: localize('providerOpenAI', "OpenAI"),
                description: localize('providerOpenAIDesc', "GPT models (GPT-4, GPT-4o). Requires API key."),
                requiresKey: true,
                keyPrefix: 'sk-',
                defaultEndpoint: 'https://api.openai.com',
        },
        {
                provider: 'nvidia',
                label: localize('providerNvidia', "NVIDIA NIM"),
                description: localize('providerNvidiaDesc', "NVIDIA NIM endpoints (Llama, Nemotron, Mistral, Qwen, DeepSeek). OpenAI-compatible. Requires nvapi- key."),
                requiresKey: true,
                keyPrefix: 'nvapi-',
                defaultEndpoint: 'https://integrate.api.nvidia.com/v1',
        },
        {
                provider: 'openrouter',
                label: localize('providerOpenRouter', "OpenRouter"),
                description: localize('providerOpenRouterDesc', "Multi-model router — access Claude, GPT, Gemini, Llama, etc. from one API. Requires sk-or- key."),
                requiresKey: true,
                keyPrefix: 'sk-or-',
                defaultEndpoint: 'https://openrouter.ai/api/v1',
        },
        {
                provider: 'lmstudio',
                label: localize('providerLMStudio', "LM Studio"),
                description: localize('providerLMStudioDesc', "Local models via LM Studio. OpenAI-compatible. No API key required. Must be running on localhost:1234."),
                requiresKey: false,
                defaultEndpoint: 'http://localhost:1234/v1',
        },
        {
                provider: 'together',
                label: localize('providerTogether', "Together AI"),
                description: localize('providerTogetherDesc', "OpenAI-compatible hosted models (Llama, Qwen, etc.). Requires API key."),
                requiresKey: true,
                defaultEndpoint: 'https://api.together.xyz/v1',
        },
        {
                provider: 'groq',
                label: localize('providerGroq', "Groq"),
                description: localize('providerGroqDesc', "Ultra-fast inference for Llama, Mixtral, Gemma. Requires gsk_ key."),
                requiresKey: true,
                keyPrefix: 'gsk_',
                defaultEndpoint: 'https://api.groq.com/openai/v1',
        },
        {
                provider: 'mistral',
                label: localize('providerMistral', "Mistral AI"),
                description: localize('providerMistralDesc', "Mistral Large, Codestral, Mixtral. OpenAI-compatible. Requires API key."),
                requiresKey: true,
                defaultEndpoint: 'https://api.mistral.ai/v1',
        },
        {
                provider: 'gemini',
                label: localize('providerGemini', "Google Gemini"),
                description: localize('providerGeminiDesc', "Gemini 1.5/2.0 Pro/Flash via OpenAI-compatible mode. Requires API key."),
                requiresKey: true,
                defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
        },
        {
                provider: 'deepseek',
                label: localize('providerDeepSeek', "DeepSeek"),
                description: localize('providerDeepSeekDesc', "DeepSeek Chat, Coder, R1. OpenAI-compatible. Requires API key."),
                requiresKey: true,
                defaultEndpoint: 'https://api.deepseek.com/v1',
        },
        {
                provider: 'ollama',
                label: localize('providerOllama', "Ollama"),
                description: localize('providerOllamaDesc', "Local models via Ollama. No API key needed."),
                requiresKey: false,
                defaultEndpoint: 'http://localhost:11434',
        },
        {
                provider: 'litellm',
                label: localize('providerLiteLLM', "LiteLLM"),
                description: localize('providerLiteLLMDesc', "LiteLLM proxy for unified model access. Requires endpoint URL."),
                requiresKey: true,
                defaultEndpoint: '',
        },
        {
                provider: 'custom',
                label: localize('providerCustom', "Custom"),
                description: localize('providerCustomDesc', "Any OpenAI-compatible endpoint."),
                requiresKey: true,
                defaultEndpoint: '',
        },
];

// ─── Command: Manage API Keys ────────────────────────────────────────────────────

registerAction2(class ManageApiKeysAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.manageApiKeys',
                        title: localize2('manageApiKeys', "Manage API Keys"),
                        f1: true,
                        category: localize2('constructCategoryApiKeys', "Construct"),
                });
        }

        async run(accessor: ServicesAccessor): Promise<void> {
                const keyManager = accessor.get(ISecureKeyManager);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                // Step 1: Pick a provider to manage
                const providerPick = await quickInput.pick(
                        PROVIDER_META.map(meta => {
                                return {
                                        label: meta.label,
                                        description: meta.requiresKey ? '$(key) API Key Required' : '$(check) No Key Required',
                                        detail: meta.description,
                                        provider: meta.provider,
                                };
                        }),
                        {
                                placeHolder: localize('selectProviderToManage', "Select a provider to manage its API key"),
                        },
                );

                if (!providerPick) {
                        return;
                }

                const selectedProvider = providerPick.provider as LLMProvider;
                const meta = PROVIDER_META.find(m => m.provider === selectedProvider)!;

                // For providers that don't need a key, just confirm and set active
                if (!meta.requiresKey) {
                        await keyManager.getMaskedKey(selectedProvider);
                        const actionPick = await quickInput.pick(
                                [
                                        { label: '$(plug) Set as Active Provider', action: 'activate' as const },
                                        { label: '$(eye) View Key Status', action: 'view' as const },
                                ],
                                { placeHolder: `${meta.label} - No key management needed` },
                        );

                        if (!actionPick) {
                                return;
                        }

                        if (actionPick.action === 'activate') {
                                const config: IProviderConfig = {
                                        id: `construct-${selectedProvider}`,
                                        name: meta.label,
                                        provider: selectedProvider,
                                        endpoint: meta.defaultEndpoint,
                                        isActive: true,
                                };
                                await keyManager.setActiveProvider(config);
                                notificationService.info(localize('providerSetAsActive', "{0} set as active provider.", meta.label));
                        } else {
                                notificationService.info(localize('keyStatusNoKey', "{0}: No API key required.", meta.label));
                        }
                        return;
                }

                // Step 2: For key-based providers, show current status and options
                const maskedKey = await keyManager.getMaskedKey(selectedProvider);
                const currentStatus = maskedKey.hasKey
                        ? localize('currentKeyStatus', "Current: {0}", maskedKey.display)
                        : localize('noKeyStatus', "No key stored");

                const actionPick = await quickInput.pick(
                        [
                                { label: '$(add) Enter New API Key', description: currentStatus, action: 'set' as const },
                                { label: '$(eye) View Current Key', description: currentStatus, action: 'view' as const, disabled: !maskedKey.hasKey },
                                { label: '$(trash) Delete Stored Key', description: currentStatus, action: 'delete' as const, disabled: !maskedKey.hasKey },
                                { label: '$(plug) Set as Active Provider', action: 'activate' as const },
                        ],
                        { placeHolder: `${meta.label} - ${currentStatus}` },
                );

                if (!actionPick) {
                        return;
                }

                switch (actionPick.action) {
                        case 'set': {
                                const input = quickInput.createInputBox();
                                input.placeholder = meta.keyPrefix
                                        ? localize('enterKeyWithPrefix', "Enter {0} API key (starts with {1})", meta.label, meta.keyPrefix)
                                        : localize('enterKeyGeneric', "Enter {0} API key", meta.label);
                                input.prompt = localize('keySecurityNote', "Your key will be stored securely in the OS keychain and never written to disk as plaintext.");

                                const keyValue = await new Promise<string | undefined>((resolve) => {
                                        input.onDidAccept(() => {
                                                resolve(input.value);
                                                input.dispose();
                                        });
                                        input.onDidHide(() => {
                                                resolve(undefined);
                                                input.dispose();
                                        });
                                        input.show();
                                });

                                if (!keyValue) {
                                        return;
                                }

                                const validation = keyManager.validateKey(selectedProvider, keyValue);
                                if (!validation.valid) {
                                        notificationService.error(validation.error ?? localize('invalidKey', "Invalid API key format."));
                                        return;
                                }

                                try {
                                        await keyManager.setKey(selectedProvider, keyValue);
                                        const newMasked = await keyManager.getMaskedKey(selectedProvider);
                                        notificationService.info(localize('keyStored', "{0} API key stored securely. {1}", meta.label, newMasked.display));
                                } catch (error) {
                                        notificationService.error(localize('keyStoreFailed', "Failed to store API key: {0}", error instanceof Error ? error.message : String(error)));
                                        logService.error('[ConstructApiSettings] Failed to store key:', error);
                                }
                                break;
                        }

                        case 'view': {
                                const masked = await keyManager.getMaskedKey(selectedProvider);
                                if (masked.hasKey) {
                                        notificationService.info(localize('keyMaskedDisplay', "{0} API key: {1}", meta.label, masked.display));
                                } else {
                                        notificationService.info(localize('noKeyStored', "No API key stored for {0}.", meta.label));
                                }
                                break;
                        }

                        case 'delete': {
                                try {
                                        await keyManager.deleteKey(selectedProvider);
                                        notificationService.info(localize('keyDeleted', "{0} API key removed from keychain.", meta.label));
                                } catch (error) {
                                        notificationService.error(localize('keyDeleteFailed', "Failed to delete API key: {0}", error instanceof Error ? error.message : String(error)));
                                        logService.error('[ConstructApiSettings] Failed to delete key:', error);
                                }
                                break;
                        }

                        case 'activate': {
                                const config: IProviderConfig = {
                                        id: `construct-${selectedProvider}`,
                                        name: meta.label,
                                        provider: selectedProvider,
                                        endpoint: meta.defaultEndpoint,
                                        isActive: true,
                                };
                                await keyManager.setActiveProvider(config);
                                notificationService.info(localize('providerActivated', "{0} set as active provider.", meta.label));
                                break;
                        }
                }
        }
});

// ─── Command: Test Provider Connection ───────────────────────────────────────────

registerAction2(class TestProviderConnectionAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.testProviderConnection',
                        title: localize2('testProviderConnection', "Test Provider Connection"),
                        f1: true,
                        category: localize2('constructCategoryTestConn', "Construct"),
                });
        }

        async run(accessor: ServicesAccessor): Promise<void> {
                const keyManager = accessor.get(ISecureKeyManager);
                const notificationService = accessor.get(INotificationService);
                const progressService = accessor.get(IProgressService);
                const logService = accessor.get(ILogService);

                const activeProvider = await keyManager.getActiveProvider();
                if (!activeProvider) {
                        notificationService.warn(localize('noActiveProvider', "No active provider configured. Use 'Construct: Manage API Keys' to set one up."));
                        return;
                }

                const meta = PROVIDER_META.find(m => m.provider === activeProvider.provider);
                const providerLabel = meta?.label ?? activeProvider.provider;

                try {
                        const result = await progressService.withProgress(
                                {
                                        location: ProgressLocation.Notification,
                                        title: localize('testingConnection', "Testing connection to {0}...", providerLabel),
                                        cancellable: false,
                                },
                                () => keyManager.testConnection(activeProvider),
                        );

                        if (result.healthy) {
                                const modelInfo = result.models && result.models.length > 0
                                        ? localize('modelsAvailable', " ({0} models available)", result.models.length)
                                        : '';
                                const latencyInfo = localize('latencyMs', "Latency: {0}ms", result.latencyMs);
                                notificationService.info(localize('connectionHealthy', "✓ {0} connection: Healthy. {1} {2}", providerLabel, latencyInfo, modelInfo));
                        } else {
                                notificationService.error(localize('connectionFailed', "✗ {0} connection: Failed. {1}", providerLabel, result.error ?? 'Unknown error'));
                        }
                } catch (error) {
                        logService.error('[ConstructApiSettings] Connection test failed:', error);
                        notificationService.error(localize('connectionTestError', "Connection test error: {0}", error instanceof Error ? error.message : String(error)));
                }
        }
});

// ─── Command: Switch Provider ────────────────────────────────────────────────────

registerAction2(class SwitchKeyProviderAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.switchProvider.quick',
                        title: localize2('switchKeyProvider', "Switch Provider (Quick)"),
                        f1: true,
                        category: localize2('constructCategorySwitch', "Construct"),
                });
        }

        async run(accessor: ServicesAccessor): Promise<void> {
                const keyManager = accessor.get(ISecureKeyManager);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const activeProvider = await keyManager.getActiveProvider();
                const activeLabel = activeProvider?.name ?? 'None';

                const picks = await quickInput.pick(
                        PROVIDER_META.map(meta => {
                                const isActive = activeProvider?.provider === meta.provider;
                                return {
                                        label: isActive ? `$(check) ${meta.label}` : meta.label,
                                        description: isActive ? localize('activeProvider', "Active") : undefined,
                                        detail: meta.description,
                                        provider: meta.provider,
                                };
                        }),
                        {
                                placeHolder: localize('switchProviderPlaceholder', "Current: {0}. Select a new active provider.", activeLabel),
                        },
                );

                if (!picks) {
                        return;
                }

                const selectedProvider = picks.provider as LLMProvider;
                const meta = PROVIDER_META.find(m => m.provider === selectedProvider)!;

                // Check if the provider has a key stored (if required)
                if (meta.requiresKey) {
                        const maskedKey = await keyManager.getMaskedKey(selectedProvider);
                        if (!maskedKey.hasKey) {
                                const proceedPick = await quickInput.pick(
                                        [
                                                {
                                                        label: localize('enterKeyFirst', "Enter API Key First"),
                                                        detail: localize('enterKeyFirstDetail', "Set up your {0} API key before activating this provider.", meta.label),
                                                        action: 'enterKey' as const,
                                                },
                                                {
                                                        label: localize('activateAnyway', "Activate Anyway"),
                                                        detail: localize('activateAnywayDetail', "Activate without a key (connection will fail until a key is provided)."),
                                                        action: 'activate' as const,
                                                },
                                                {
                                                        label: localize('cancel', "Cancel"),
                                                        action: 'cancel' as const,
                                                },
                                        ],
                                        { placeHolder: localize('noKeyWarning', "No API key stored for {0}.", meta.label) },
                                );

                                if (!proceedPick || proceedPick.action === 'cancel') {
                                        return;
                                }

                                if (proceedPick.action === 'enterKey') {
                                        // Trigger the manage API keys command for this provider
                                        const input = quickInput.createInputBox();
                                        input.placeholder = meta.keyPrefix
                                                ? localize('enterKeyPrefix', "Enter {0} API key (starts with {1})", meta.label, meta.keyPrefix)
                                                : localize('enterKeyNoPrefix', "Enter {0} API key", meta.label);

                                        const keyValue = await new Promise<string | undefined>((resolve) => {
                                                input.onDidAccept(() => {
                                                        resolve(input.value);
                                                        input.dispose();
                                                });
                                                input.onDidHide(() => {
                                                        resolve(undefined);
                                                        input.dispose();
                                                });
                                                input.show();
                                        });

                                        if (!keyValue) {
                                                return;
                                        }

                                        const validation = keyManager.validateKey(selectedProvider, keyValue);
                                        if (!validation.valid) {
                                                notificationService.error(validation.error ?? localize('invalidKeyFormat', "Invalid API key format."));
                                                return;
                                        }

                                        await keyManager.setKey(selectedProvider, keyValue);
                                }
                        }
                }

                // Determine the endpoint based on provider type
                let endpoint: string | undefined = meta.defaultEndpoint;
                if (selectedProvider === 'ollama') {
                        // Could read from configuration service, but for simplicity use default
                        endpoint = meta.defaultEndpoint;
                } else if (selectedProvider === 'litellm' || selectedProvider === 'custom') {
                        endpoint = ''; // User must configure this separately
                }

                const config: IProviderConfig = {
                        id: `construct-${selectedProvider}`,
                        name: meta.label,
                        provider: selectedProvider,
                        endpoint: endpoint || undefined,
                        isActive: true,
                };

                await keyManager.setActiveProvider(config);
                notificationService.info(localize('providerSwitched', "Active provider switched to {0}.", meta.label));
        }
});
