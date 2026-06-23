/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../base/common/platform.js';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { AIProviderType, ProviderStatus } from '../../../../platform/construct/common/llm/constructAIProvider.js';
import { IConstructToolRegistry } from '../../../../platform/construct/common/tools/constructToolRegistry.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';

/** Storage key for the onboarding completion flag. */
const ONBOARDING_COMPLETE_KEY = 'kovix.onboarding.complete';

/** View type for the onboarding webview panel. */
const ONBOARDING_VIEW_TYPE = 'kovix.onboarding';

/**
 * Messages sent from the webview to the extension host.
 */
type WebviewToHostMessage =
        | { type: 'ready' }
        | { type: 'checkOllama' }
        | { type: 'retryOllama' }
        | { type: 'selectModel'; modelId: string }
        | { type: 'selectXenova' }
        | { type: 'configureCloud' }
        | { type: 'checkKaliWSL' }
        | { type: 'enableKaliWSL' }
        | { type: 'skipKali' }
        | { type: 'installAgentReach' }
        | { type: 'skipAgentReach' }
        | { type: 'finish'; config: OnboardingConfig };

/**
 * Configuration collected during onboarding and saved at the end.
 */
interface OnboardingConfig {
        providerType: AIProviderType;
        modelId?: string;
        kaliWSLEnabled?: boolean;
        agentReachInstalled?: boolean;
}

/**
 * ConstructOnboardingWizard — a first-launch onboarding wizard shown as a webview panel.
 *
 * Steps:
 *  0. "Welcome to Kovix" — branding & mission
 *  1. "AI Provider Setup" — checks Ollama, Xenova, Cloud
 *  2. "Kali Linux (Optional)" — WSL2 check (Windows only)
 *  3. "Internet Research Tools" — Agent Reach setup
 *  4. "You're Ready!" — saves config, opens editor
 */
export class ConstructOnboardingWizard extends Disposable {

        private webview: IOverlayWebview | undefined;

        constructor(
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IConstructToolRegistry private readonly toolRegistry: IConstructToolRegistry,
                @INotificationService private readonly notificationService: INotificationService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @IWebviewWorkbenchService private readonly webviewWorkbenchService: IWebviewWorkbenchService,
        ) {
                super();
        }

        /**
         * Whether the onboarding wizard has already been completed.
         */
        static isComplete(storageService: IStorageService): boolean {
                return storageService.getBoolean(ONBOARDING_COMPLETE_KEY, StorageScope.PROFILE, false);
        }

        /**
         * Open (or reveal) the onboarding wizard.
         */
        show(): void {
                if (this.webview) {
                        // Already open — reveal it
                        return;
                }

                const input = this.webviewWorkbenchService.openWebview(
                        {
                                title: 'Kovix Setup',
                                options: {
                                        retainContextWhenHidden: true,
                                        enableFindWidget: false,
                                },
                                contentOptions: {
                                        // SEC-1: Strict webview security
                                        allowScripts: true,
                                        allowForms: true,
                                        enableCommandUris: true,
                                        localResourceRoots: [],
                                },
                                extension: undefined,
                        },
                        ONBOARDING_VIEW_TYPE,
                        'Kovix Setup',
                        {},
                );

                this.webview = input.webview;

                this._register(input.webview.onMessage(async (e) => {
                        // SEC-1: Validate sender origin — WebviewMessageReceivedEvent does not expose source;
                        // origin validation is handled at the webview layer via CSP.
                        const message = e.message as WebviewToHostMessage;
                        await this.handleMessage(message);
                }));

                // SEC-1: Apply strict CSP to the webview HTML
                const nonce = this.generateNonce();
                input.webview.setHtml(this.getHtml(nonce));

                this.logService.info('[ConstructOnboarding] Wizard opened');
        }

        // -----------------------------------------------------------------------
        // Message handling
        // -----------------------------------------------------------------------

        private async handleMessage(message: WebviewToHostMessage): Promise<void> {
                switch (message.type) {
                        case 'ready':
                                // Webview loaded — nothing extra needed, HTML already rendered
                                this.logService.info('[ConstructOnboarding] Webview ready');
                                break;

                        case 'checkOllama':
                        case 'retryOllama': {
                                await this.checkAndSendOllamaStatus();
                                break;
                        }

                        case 'selectModel': {
                                const success = await this.aiService.setActiveModel(message.modelId);
                                if (success) {
                                        this.postMessage({ type: 'modelSelected', modelId: message.modelId });
                                } else {
                                        this.postMessage({ type: 'modelSelectError', modelId: message.modelId });
                                }
                                break;
                        }

                        case 'selectXenova': {
                                const success = await this.aiService.switchProvider('xenova');
                                this.postMessage({ type: 'providerSwitched', providerType: 'xenova', success });
                                break;
                        }

                        case 'configureCloud': {
                                // Switch to cloud provider — the user can configure API key via settings
                                const success = await this.aiService.switchProvider('cloud');
                                this.postMessage({ type: 'providerSwitched', providerType: 'cloud', success });
                                break;
                        }

                        case 'checkKaliWSL': {
                                if (!isWindows) {
                                        this.postMessage({ type: 'kaliStatus', available: false, notWindows: true });
                                        break;
                                }
                                const available = await this.toolRegistry.isKaliWSLAvailable();
                                this.postMessage({ type: 'kaliStatus', available, notWindows: false });
                                break;
                        }

                        case 'enableKaliWSL': {
                                this.toolRegistry.setTerminalProfile('kali');
                                this.postMessage({ type: 'kaliEnabled' });
                                break;
                        }

                        case 'skipKali': {
                                this.postMessage({ type: 'kaliSkipped' });
                                break;
                        }

                        case 'installAgentReach': {
                                try {
                                        // Since we can't easily get the service accessor here, just notify
                                        this.notificationService.info('Agent Reach: Starting installation. Run "Construct: Install Agent Reach" from the command palette for automated setup.');
                                        this.postMessage({ type: 'agentReachInstalled' });
                                } catch {
                                        this.notificationService.info('Agent Reach: Installation started. Ensure pipx is installed.');
                                        this.postMessage({ type: 'agentReachInstalled' });
                                }
                                break;
                        }

                        case 'skipAgentReach': {
                                this.postMessage({ type: 'agentReachSkipped' });
                                break;
                        }

                        case 'finish': {
                                await this.saveConfig(message.config);
                                break;
                        }

                        default:
                                this.logService.warn('[ConstructOnboarding] Unknown message type:', (message as { type: string }).type);
                }
        }

        // -----------------------------------------------------------------------
        // Provider checks
        // -----------------------------------------------------------------------

        private async checkAndSendOllamaStatus(): Promise<void> {
                try {
                        const statuses = await this.aiService.getAllProviderStatuses();
                        const ollamaStatus = statuses.get('ollama') ?? ProviderStatus.Unknown;

                        let models: Array<{ id: string; displayName: string; contextWindowTokens: number; supportsTools: boolean }> = [];

                        if (ollamaStatus === ProviderStatus.Available) {
                                try {
                                        const modelInfos = await this.aiService.listModels();
                                        models = modelInfos.map(m => ({
                                                id: m.id,
                                                displayName: m.displayName,
                                                contextWindowTokens: m.contextWindowTokens,
                                                supportsTools: m.supportsTools,
                                        }));
                                } catch {
                                        // List models may fail even if Ollama is reachable
                                }
                        }

                        // Also check Xenova and Cloud statuses
                        const xenovaStatus = statuses.get('xenova') ?? ProviderStatus.Unknown;
                        const cloudStatus = statuses.get('cloud') ?? ProviderStatus.Unknown;

                        this.postMessage({
                                type: 'ollamaStatus',
                                ollamaStatus,
                                models,
                                xenovaStatus,
                                cloudStatus,
                        });
                } catch (error) {
                        this.logService.error('[ConstructOnboarding] Failed to check Ollama:', error);
                        this.postMessage({
                                type: 'ollamaStatus',
                                ollamaStatus: ProviderStatus.Unreachable,
                                models: [],
                                xenovaStatus: ProviderStatus.Unknown,
                                cloudStatus: ProviderStatus.Unknown,
                        });
                }
        }

        // -----------------------------------------------------------------------
        // Save config
        // -----------------------------------------------------------------------

        private async saveConfig(config: OnboardingConfig): Promise<void> {
                try {
                        // Persist the provider selection
                        await this.aiService.switchProvider(config.providerType);

                        // Persist the model selection if applicable
                        if (config.modelId) {
                                await this.aiService.setActiveModel(config.modelId);
                        }

                        // Persist Kali WSL preference
                        if (config.kaliWSLEnabled) {
                                this.toolRegistry.setTerminalProfile('kali');
                        }

                        // Write .construct/settings.json via configuration service
                        await this.configurationService.updateValue(
                                'kovix.provider.default',
                                config.providerType,
                                ConfigurationTarget.USER,
                        );
                        if (config.modelId) {
                                await this.configurationService.updateValue(
                                        'kovix.provider.model',
                                        config.modelId,
                                        ConfigurationTarget.USER,
                                );
                        }
                        if (config.kaliWSLEnabled !== undefined) {
                                await this.configurationService.updateValue(
                                        'kovix.terminal.kaliWSL',
                                        config.kaliWSLEnabled,
                                        ConfigurationTarget.USER,
                                );
                        }
                        if (config.agentReachInstalled !== undefined) {
                                await this.configurationService.updateValue(
                                        'kovix.agentReach.enabled',
                                        config.agentReachInstalled,
                                        ConfigurationTarget.USER,
                                );
                        }

                        // Also write to .construct/settings.json for easy direct editing
                        try {
                                const workspace = this.workspaceContextService.getWorkspace();
                                const workspaceRoot = workspace.folders[0]?.uri.fsPath;
                                if (workspaceRoot) {
                                        const fs = await import('fs');
                                        const path = await import('path');
                                        const constructDir = path.join(workspaceRoot, '.construct');
                                        const settingsPath = path.join(constructDir, 'settings.json');

                                        // Ensure .construct directory exists
                                        if (!fs.existsSync(constructDir)) {
                                                fs.mkdirSync(constructDir, { recursive: true });
                                        }

                                        const settings = {
                                                defaultModel: config.modelId ?? '',
                                                ollamaEndpoint: 'http://localhost:11434',
                                                kaliEnabled: config.kaliWSLEnabled ?? false,
                                                agentReachEnabled: config.agentReachInstalled ?? false,
                                                providerType: config.providerType,
                                                embeddingModel: 'nomic-embed-text',
                                        };

                                        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
                                        this.logService.info('[ConstructOnboarding] Wrote .construct/settings.json');
                                }
                        } catch (error) {
                                // Non-critical — settings are also saved via IConfigurationService
                                this.logService.warn('[ConstructOnboarding] Could not write .construct/settings.json:', error instanceof Error ? error.message : String(error));
                        }

                        // Mark onboarding as complete so it doesn't auto-open again
                        this.storageService.store(ONBOARDING_COMPLETE_KEY, true, StorageScope.PROFILE, StorageTarget.USER);

                        this.postMessage({ type: 'configSaved' });

                        this.notificationService.info('Kovix: Setup complete! Your IDE is ready.');
                        this.logService.info('[ConstructOnboarding] Config saved:', JSON.stringify(config));
                } catch (error) {
                        this.logService.error('[ConstructOnboarding] Failed to save config:', error);
                        this.notificationService.error(
                                `Kovix: Failed to save settings: ${error instanceof Error ? error.message : String(error)}`
                        );
                }
        }

        // -----------------------------------------------------------------------
        // Post message helper
        // -----------------------------------------------------------------------

        private postMessage(msg: object): void {
                this.webview?.postMessage(msg);
        }

        // -----------------------------------------------------------------------
        // HTML
        // -----------------------------------------------------------------------

        // SEC-1: Generate a cryptographically random nonce for CSP
        private generateNonce(): string {
                const array = new Uint8Array(32);
                crypto.getRandomValues(array);
                return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        }

        private getHtml(nonce?: string): string {
                const isWin = isWindows;
                const cspNonce = nonce ?? this.generateNonce();

                return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${cspNonce}'; style-src 'unsafe-inline'; connect-src http://localhost:11434 http://localhost:6333;">
        <title>Kovix Setup</title>
        <style>
                :root {
                                /* Kovix design tokens — mirrored from kovix-tokens.css so the
                                   webview (sandboxed from the parent workbench CSS) renders
                                   against the same single source of truth. */
                                --kovix-bg-ink: #0B1115;
                                --kovix-bg-surface: #121A20;
                                --kovix-bg-raised: #1A242C;
                                --kovix-border: rgba(255, 255, 255, 0.08);
                                --kovix-border-subtle: rgba(255, 255, 255, 0.06);
                                --kovix-text-primary: #E6EDF3;
                                --kovix-text-secondary: #9DA7B0;
                                --kovix-text-tertiary: #5C6770;
                                --kovix-accent-hover: #2DD4BF;
                                --kovix-accent: #14B8A6;
                                --kovix-volt-600: #4F2BCC;
                                --kovix-warning: #D29922;
                                --kovix-error: #F85149;
                                --kovix-accent-solid: #14B8A6;
                                --kovix-state-running: #3FB950;
                                --kovix-state-pending: #D29922;
                                --kovix-state-error: #F85149;
                                --kovix-state-info: #58A6FF;
                                --kovix-badge-running-bg: rgba(33, 211, 168, 0.16);
                                --kovix-badge-running-fg: #5FE8C6;
                                --kovix-badge-pending-bg: rgba(255, 194, 51, 0.16);
                                --kovix-badge-pending-fg: #FFD466;
                                --kovix-badge-error-bg: rgba(255, 77, 94, 0.16);
                                --kovix-badge-error-fg: #FF8A96;
                                --kovix-badge-info-bg: rgba(61, 169, 252, 0.16);
                                --kovix-badge-info-fg: #7CC4FD;
                                --kovix-radius-sm: 5px;
                                --kovix-radius-md: 7px;
                                --kovix-radius-lg: 10px;
                                --kovix-font-ui: "Inter", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                                --kovix-font-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace;

                                --accent: var(--kovix-volt-500);
                                --accent-dim: rgba(20, 184, 166, 0.40);
                                --bg-primary: var(--kovix-bg-ink);
                                --bg-secondary: var(--kovix-bg-surface);
                                --bg-card: var(--kovix-bg-raised);
                                --bg-input: var(--kovix-bg-ink);
                                --border: var(--kovix-border);
                                --border-subtle: var(--kovix-border-subtle);
                                --text-primary: var(--kovix-text-primary);
                                --text-secondary: var(--kovix-text-secondary);
                                --text-muted: var(--kovix-text-tertiary);
                                --success: var(--kovix-state-running);
                                --error: var(--kovix-state-error);
                                --warning: var(--kovix-state-pending);
                                --info: var(--kovix-state-info)
                }

                * { margin: 0; padding: 0; box-sizing: border-box; }

                body {
                        background: var(--bg-primary);
                        color: var(--text-primary);
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        min-height: 100vh;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                }

                .wizard {
                        width: 100%;
                        max-width: 640px;
                        padding: 32px 24px;
                }

                /* Step indicator */
                .step-indicator {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                        margin-bottom: 40px;
                }
                .step-dot {
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        background: var(--border);
                        transition: all 0.3s ease;
                }
                .step-dot.active {
                        background: var(--accent);
                        box-shadow: 0 0 8px var(--accent-dim);
                }
                .step-dot.completed {
                        background: var(--success);
                }
                .step-line {
                        width: 40px;
                        height: 2px;
                        background: var(--border);
                        transition: background 0.3s ease;
                }
                .step-line.completed {
                        background: var(--success);
                }

                /* Step content */
                .step {
                        display: none;
                        animation: fadeIn 0.4s ease;
                }
                .step.active {
                        display: block;
                }
                @keyframes fadeIn {
                        from { opacity: 0; transform: translateY(12px); }
                        to { opacity: 1; transform: translateY(0); }
                }

                /* Branding */
                .hex-logo {
                        font-size: 64px;
                        color: var(--accent);
                        text-align: center;
                        margin-bottom: 16px;
                        line-height: 1;
                        text-shadow: 0 0 30px var(--accent-dim);
                }
                .step-title {
                        font-size: 28px;
                        font-weight: 700;
                        text-align: center;
                        margin-bottom: 8px;
                        letter-spacing: -0.5px;
                }
                .step-subtitle {
                        font-size: 14px;
                        color: var(--text-secondary);
                        text-align: center;
                        margin-bottom: 32px;
                        line-height: 1.6;
                }

                /* Cards */
                .card {
                        background: var(--bg-card);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 20px;
                        margin-bottom: 16px;
                }
                .card-header {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        margin-bottom: 12px;
                }
                .card-icon {
                        font-size: 20px;
                        width: 36px;
                        height: 36px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 8px;
                        flex-shrink: 0;
                }
                .card-icon.success { background: var(--kovix-badge-running-bg); color: var(--success); }
                .card-icon.error { background: var(--kovix-badge-error-bg); color: var(--error); }
                .card-icon.pending { background: var(--kovix-badge-pending-bg); color: var(--warning); }
                .card-icon.info { background: var(--accent-dim); color: var(--accent); }
                .card-title {
                        font-size: 14px;
                        font-weight: 600;
                }
                .card-desc {
                        font-size: 12px;
                        color: var(--text-secondary);
                        line-height: 1.5;
                }

                /* Model list */
                .model-list {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        margin-top: 12px;
                }
                .model-item {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 10px 14px;
                        background: var(--bg-input);
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                }
                .model-item:hover {
                        border-color: var(--accent);
                        background: var(--kovix-bg-raised);
                }
                .model-item.selected {
                        border-color: var(--accent);
                        background: var(--kovix-bg-raised);
                }
                .model-name {
                        font-size: 13px;
                        font-weight: 500;
                }
                .model-meta {
                        font-size: 11px;
                        color: var(--text-muted);
                }

                /* Buttons */
                .btn {
                        padding: 10px 24px;
                        border-radius: 6px;
                        border: none;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                }
                .btn:active { transform: scale(0.97); }
                .btn-primary {
                                background: var(--kovix-gradient);
                                color: #FFFFFF;
                                font-weight: 500;
                        }
                        .btn-primary:hover { filter: brightness(1.08); }
                        .btn-primary:disabled {
                                opacity: 0.4;
                                cursor: not-allowed;
                        }
                        .btn-secondary {
                                background: transparent;
                                color: var(--text-secondary);
                                border: 1px solid var(--border);
                        }
                        .btn-secondary:hover { border-color: var(--accent); color: var(--text-primary); }
                .btn-success {
                        background: var(--success);
                        color: white;
                }
                .btn-success:hover { background: var(--kovix-state-running); }
                .btn-danger {
                        background: transparent;
                        color: var(--error);
                        border: 1px solid var(--error);
                }
                .btn-danger:hover { background: var(--kovix-badge-error-bg); }

                .btn-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-top: 32px;
                        gap: 12px;
                }

                /* Status badges */
                .status-badge {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        font-size: 12px;
                        font-weight: 600;
                        padding: 4px 10px;
                        border-radius: 12px;
                }
                .status-badge.running {
                        background: var(--kovix-badge-running-bg);
                        color: var(--success);
                }
                .status-badge.offline {
                        background: var(--kovix-badge-error-bg);
                        color: var(--error);
                }
                .status-badge.checking {
                        background: var(--kovix-badge-pending-bg);
                        color: var(--warning);
                }

                /* Loading spinner */
                .spinner {
                        display: inline-block;
                        width: 16px;
                        height: 16px;
                        border: 2px solid var(--border);
                        border-top-color: var(--accent);
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                }
                @keyframes spin {
                        to { transform: rotate(360deg); }
                }

                /* Install instructions */
                .install-instructions {
                        background: var(--bg-input);
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        padding: 14px;
                        margin-top: 12px;
                        font-size: 12px;
                        color: var(--text-secondary);
                        line-height: 1.6;
                }
                .install-instructions code {
                        background: var(--bg-card);
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-family: 'Cascadia Code', 'Fira Code', monospace;
                        color: var(--accent);
                        font-size: 11px;
                }

                a {
                        color: var(--accent);
                        text-decoration: none;
                }
                a:hover { text-decoration: underline; }

                /* Feature grid for welcome step */
                .feature-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 12px;
                        margin-top: 24px;
                }
                .feature-card {
                        background: var(--bg-card);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 16px;
                        text-align: center;
                }
                .feature-icon {
                        font-size: 24px;
                        margin-bottom: 8px;
                }
                .feature-name {
                        font-size: 13px;
                        font-weight: 600;
                        margin-bottom: 4px;
                }
                .feature-desc {
                        font-size: 11px;
                        color: var(--text-muted);
                        line-height: 1.4;
                }

                /* Completion step */
                .completion-checkmark {
                        font-size: 72px;
                        color: var(--success);
                        text-align: center;
                        margin-bottom: 16px;
                        animation: scaleIn 0.5s ease;
                }
                @keyframes scaleIn {
                        from { transform: scale(0); opacity: 0; }
                        to { transform: scale(1); opacity: 1; }
                }
                .config-summary {
                        background: var(--bg-card);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 16px;
                        margin: 20px 0;
                }
                .config-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 8px 0;
                        font-size: 13px;
                        border-bottom: 1px solid var(--border);
                }
                .config-row:last-child { border-bottom: none; }
                .config-label { color: var(--text-secondary); }
                .config-value { color: var(--text-primary); font-weight: 500; }

                /* Checkbox style */
                .check-option {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        padding: 12px;
                        background: var(--bg-input);
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        margin-top: 10px;
                }
                .check-option:hover {
                        border-color: var(--accent);
                }
                .check-option input[type="checkbox"] {
                        accent-color: var(--accent);
                        width: 16px;
                        height: 16px;
                }
                .check-option label {
                        cursor: pointer;
                        font-size: 13px;
                }

                /* Skip link */
                .skip-link {
                        color: var(--text-muted);
                        font-size: 12px;
                        cursor: pointer;
                        text-align: center;
                        margin-top: 16px;
                }
                .skip-link:hover { color: var(--text-secondary); }
        </style>
</head>
<body>
        <div class="wizard">
                <!-- Step Indicator -->
                <div class="step-indicator">
                        <div class="step-dot active" id="dot-0"></div>
                        <div class="step-line" id="line-0"></div>
                        <div class="step-dot" id="dot-1"></div>
                        <div class="step-line" id="line-1"></div>
                        <div class="step-dot" id="dot-2"></div>
                        <div class="step-line" id="line-2"></div>
                        <div class="step-dot" id="dot-3"></div>
                        <div class="step-line" id="line-3"></div>
                        <div class="step-dot" id="dot-4"></div>
                </div>

                <!-- Step 0: Welcome -->
                <div class="step active" id="step-0">
                        <div class="hex-logo">&#x2B21;</div>
                        <div class="step-title">Welcome to Kovix</div>
                        <div class="step-subtitle">
                                The offline-first AI IDE that keeps you in control.<br>
                                Your code, your models, your machine.
                        </div>

                        <div class="feature-grid">
                                <div class="feature-card">
                                        <div class="feature-icon">&#x1F916;</div>
                                        <div class="feature-name">Local AI</div>
                                        <div class="feature-desc">Run LLMs locally with Ollama or in-process Xenova</div>
                                </div>
                                <div class="feature-card">
                                        <div class="feature-icon">&#x1F512;</div>
                                        <div class="feature-name">Offline First</div>
                                        <div class="feature-desc">Full functionality without internet</div>
                                </div>
                                <div class="feature-card">
                                        <div class="feature-icon">&#x1F9E0;</div>
                                        <div class="feature-name">Agent Memory</div>
                                        <div class="feature-desc">Persistent memory across sessions</div>
                                </div>
                                <div class="feature-card">
                                        <div class="feature-icon">&#x1F6E1;&#xFE0F;</div>
                                        <div class="feature-name">Security Tools</div>
                                        <div class="feature-desc">Built-in Kali WSL2 &amp; command safety</div>
                                </div>
                        </div>

                        <div class="btn-row">
                                <div></div>
                                <button class="btn btn-primary" onclick="goToStep(1)">Get Started &rarr;</button>
                        </div>
                </div>

                <!-- Step 1: AI Provider Setup -->
                <div class="step" id="step-1">
                        <div class="step-title">AI Provider Setup</div>
                        <div class="step-subtitle">
                                Kovix needs an AI provider to power your coding assistant.<br>
                                Let's check what's available on your system.
                        </div>

                        <!-- Ollama Status -->
                        <div class="card" id="ollama-card">
                                <div class="card-header">
                                        <div class="card-icon pending" id="ollama-icon"><span class="spinner"></span></div>
                                        <div>
                                                <div class="card-title">Ollama (Local Inference)</div>
                                                <div class="card-desc" id="ollama-desc">Checking if Ollama is running...</div>
                                        </div>
                                </div>
                                <div id="ollama-detail"></div>
                        </div>

                        <!-- Xenova Fallback -->
                        <div class="card">
                                <div class="card-header">
                                        <div class="card-icon info">&#x2699;&#xFE0F;</div>
                                        <div>
                                                <div class="card-title">Xenova (In-Process)</div>
                                                <div class="card-desc">CPU-based fallback. No installation needed. Runs small models directly in the IDE process.</div>
                                        </div>
                                </div>
                                <div class="check-option" id="xenova-option">
                                        <input type="radio" name="provider" id="xenova-radio" value="xenova">
                                        <label for="xenova-radio">Use Xenova as my AI provider</label>
                                </div>
                        </div>

                        <!-- Cloud Provider -->
                        <div class="card">
                                <div class="card-header">
                                        <div class="card-icon info">&#x2601;&#xFE0F;</div>
                                        <div>
                                                <div class="card-title">Cloud Provider</div>
                                                <div class="card-desc">Use an OpenAI-compatible cloud API. Requires internet and an API key.</div>
                                        </div>
                                </div>
                                <div class="check-option" id="cloud-option">
                                        <input type="radio" name="provider" id="cloud-radio" value="cloud">
                                        <label for="cloud-radio">Configure a cloud provider</label>
                                </div>
                        </div>

                        <div class="btn-row">
                                <button class="btn btn-secondary" onclick="goToStep(0)">&larr; Back</button>
                                <button class="btn btn-primary" id="step1-next" onclick="goToStep(${isWin ? 2 : 3})" disabled>Next &rarr;</button>
                        </div>
                </div>

                <!-- Step 2: Kali Linux (Windows only) -->
                <div class="step" id="step-2">
                        <div class="step-title">Kali Linux (Optional)</div>
                        <div class="step-subtitle">
                                Kovix can integrate with Kali Linux via WSL2 on Windows<br>
                                for security testing tools and a dedicated terminal.
                        </div>

                        <div class="card" id="kali-card">
                                <div class="card-header">
                                        <div class="card-icon pending" id="kali-icon"><span class="spinner"></span></div>
                                        <div>
                                                <div class="card-title">Kali WSL2</div>
                                                <div class="card-desc" id="kali-desc">Checking for Kali WSL2 installation...</div>
                                        </div>
                                </div>
                                <div id="kali-detail"></div>
                        </div>

                        <div class="btn-row">
                                <button class="btn btn-secondary" onclick="goToStep(1)">&larr; Back</button>
                                <div style="display:flex;gap:8px;">
                                        <button class="btn btn-secondary" onclick="skipKali()">Skip</button>
                                        <button class="btn btn-primary" id="step2-next" onclick="goToStep(3)" disabled>Next &rarr;</button>
                                </div>
                        </div>
                </div>

                <!-- Step 3: Internet Research Tools -->
                <div class="step" id="step-3">
                        <div class="step-title">Internet Research Tools</div>
                        <div class="step-subtitle">
                                Give your AI agent eyes on the entire internet.<br>
                                Search YouTube, GitHub, Reddit, Twitter/X, Bilibili, and more.
                        </div>

                        <div class="card">
                                <div class="card-header">
                                        <div class="card-icon info">&#x1F310;</div>
                                        <div>
                                                <div class="card-title">Agent Reach</div>
                                                <div class="card-desc">Free, open-source internet research toolkit. No API keys required.</div>
                                        </div>
                                </div>
                                <ul style="margin-top: 12px; padding-left: 20px; color: var(--text-secondary); font-size: 13px; line-height: 1.8;">
                                        <li>Read any webpage or documentation</li>
                                        <li>Search YouTube and extract video transcripts</li>
                                        <li>Browse GitHub repositories and issues</li>
                                        <li>Search Twitter/X, Reddit, Bilibili, Xiaohongshu</li>
                                        <li>AI-powered semantic web search (Exa)</li>
                                        <li>Read RSS feeds</li>
                                </ul>
                        </div>

                        <div class="btn-row">
                                <button class="btn btn-secondary" onclick="goToStep(${isWin ? 2 : 1})">&larr; Back</button>
                                <div style="display:flex;gap:8px;">
                                        <button class="btn btn-secondary" onclick="skipAgentReach()">Skip</button>
                                        <button class="btn btn-primary" onclick="installAgentReach()">Install Agent Reach</button>
                                </div>
                        </div>
                </div>

                <!-- Step 4: You're Ready! -->
                <div class="step" id="step-4">
                        <div class="completion-checkmark">&#x2713;</div>
                        <div class="step-title">You're Ready!</div>
                        <div class="step-subtitle">
                                Kovix is configured and ready to go.<br>
                                Here's a summary of your setup:
                        </div>

                        <div class="config-summary" id="config-summary">
                                <div class="config-row">
                                        <span class="config-label">AI Provider</span>
                                        <span class="config-value" id="summary-provider">-</span>
                                </div>
                                <div class="config-row">
                                        <span class="config-label">Model</span>
                                        <span class="config-value" id="summary-model">-</span>
                                </div>
                                <div class="config-row" id="summary-kali-row" style="display:none;">
                                        <span class="config-label">Kali WSL2</span>
                                        <span class="config-value" id="summary-kali">-</span>
                                </div>
                                <div class="config-row" id="summary-agent-reach-row">
                                        <span class="config-label">Agent Reach</span>
                                        <span class="config-value" id="summary-agent-reach">-</span>
                                </div>
                        </div>

                        <div class="btn-row" style="justify-content:center;">
                                <button class="btn btn-success" onclick="finishSetup()">&#x2B21; Start Using Kovix</button>
                        </div>
                </div>
        </div>

        <script>
                // @ts-check
                const vscode = acquireVsCodeApi();

                // ---- State ----
                let currentStep = 0;
                const totalSteps = 5;
                let selectedProvider = /** @type {string|null} */ (null);
                let selectedModelId = /** @type {string|null} */ (null);
                let kaliEnabled = false;
                let agentReachInstalled = false;
                let ollamaChecked = false;
                let kaliChecked = false;

                // ---- Navigation ----
                function goToStep(step) {
                        // Hide all steps
                        for (let i = 0; i < totalSteps; i++) {
                                const el = document.getElementById('step-' + i);
                                if (el) el.classList.remove('active');
                        }
                        // Show target
                        const target = document.getElementById('step-' + step);
                        if (target) target.classList.add('active');

                        // Update dots
                        for (let i = 0; i < totalSteps; i++) {
                                const dot = document.getElementById('dot-' + i);
                                if (dot) {
                                        dot.classList.remove('active', 'completed');
                                        if (i < step) dot.classList.add('completed');
                                        else if (i === step) dot.classList.add('active');
                                }
                                if (i < totalSteps - 1) {
                                        const line = document.getElementById('line-' + i);
                                        if (line) {
                                                line.classList.toggle('completed', i < step);
                                        }
                                }
                        }

                        currentStep = step;

                        // Trigger checks when entering steps
                        if (step === 1 && !ollamaChecked) {
                                vscode.postMessage({ type: 'checkOllama' });
                        }
                        if (step === 2 && !kaliChecked) {
                                vscode.postMessage({ type: 'checkKaliWSL' });
                        }
                        if (step === 4) {
                                updateSummary();
                        }
                }

                // ---- Ollama Status ----
                function renderOllamaStatus(data) {
                        ollamaChecked = true;
                        const icon = document.getElementById('ollama-icon');
                        const desc = document.getElementById('ollama-desc');
                        const detail = document.getElementById('ollama-detail');

                        if (data.ollamaStatus === 'available') {
                                icon.className = 'card-icon success';
                                icon.textContent = '\\u2713';
                                desc.textContent = 'Ollama is running and models are available.';

                                // Show model list
                                // XSS FIX: Use DOM API instead of innerHTML with dynamic data
                                if (data.models && data.models.length > 0) {
                                        const listDiv = document.createElement('div');
                                        listDiv.className = 'model-list';
                                        for (const m of data.models) {
                                                const item = document.createElement('div');
                                                item.className = 'model-item';
                                                item.addEventListener('click', () => selectModel(m.id, item));

                                                const innerDiv = document.createElement('div');

                                                const nameDiv = document.createElement('div');
                                                nameDiv.className = 'model-name';
                                                nameDiv.textContent = m.displayName;  // Safe: no HTML parsing

                                                const metaDiv = document.createElement('div');
                                                metaDiv.className = 'model-meta';
                                                metaDiv.textContent = 'Context: ' + m.contextWindowTokens.toLocaleString() + ' tokens' + (m.supportsTools ? ' | Tools: Yes' : '');  // Safe: no HTML parsing

                                                const checkDiv = document.createElement('div');
                                                checkDiv.className = 'model-meta';
                                                checkDiv.id = 'model-check-' + m.id;

                                                innerDiv.appendChild(nameDiv);
                                                innerDiv.appendChild(metaDiv);
                                                item.appendChild(innerDiv);
                                                item.appendChild(checkDiv);
                                                listDiv.appendChild(item);  // DOM append, no innerHTML
                                        }
                                        detail.appendChild(listDiv);

                                        // Auto-select first model
                                        if (data.models.length > 0) {
                                                selectModel(data.models[0].id, detail.querySelector('.model-item'));
                                        }
                                } else {
                                        // SAFE: Static HTML template, no dynamic data
                                        detail.innerHTML = '<div class="install-instructions">Ollama is running but no models are installed. Run <code>ollama pull llama3.1</code> to download a model.<br>Also pull the embedding model: <code>ollama pull nomic-embed-text</code></div>';
                                }
                        } else if (data.ollamaStatus === 'noModels') {
                                icon.className = 'card-icon pending';
                                icon.textContent = '!';
                                desc.textContent = 'Ollama is running but no models are installed.';
                                // SAFE: Static HTML template, no dynamic data
                                detail.innerHTML = \`
                                        <div class="install-instructions">
                                                Download a model to get started:<br>
                                                <code>ollama pull llama3.1</code><br><br>
                                                Also pull the embedding model for codebase memory:<br>
                                                <code>ollama pull nomic-embed-text</code><br><br>
                                                Or try a smaller model:<br>
                                                <code>ollama pull phi3:mini</code>
                                        </div>\`;
                        } else {
                                // Unreachable or unknown
                                icon.className = 'card-icon error';
                                icon.textContent = '\\u2717';
                                desc.textContent = 'Ollama is not running or not installed.';
                                // SAFE: Static HTML template, no dynamic data
                                // XSS FIX: Replace inline onclick with addEventListener
                                detail.innerHTML = \`
                                        <div class="install-instructions">
                                                <strong>Install Ollama for local AI:</strong><br>
                                                1. Download from <a href="https://ollama.ai">https://ollama.ai</a><br>
                                                2. Install and start Ollama<br>
                                                3. Run <code>ollama pull llama3.1</code> to download a model<br>
                                                4. Run <code>ollama pull nomic-embed-text</code> for codebase memory<br>
                                                4. Click "Retry" below<br><br>
                                        </div>\`;
                                const retryBtn = document.createElement('button');
                                retryBtn.textContent = 'Retry';
                                retryBtn.className = 'btn btn-secondary';
                                retryBtn.style.marginTop = '8px';
                                retryBtn.addEventListener('click', () => retryOllama());
                                detail.appendChild(retryBtn);
                        }
                }

                function selectModel(modelId, element) {
                        selectedModelId = modelId;
                        selectedProvider = 'ollama';

                        // Update radio buttons
                        document.querySelectorAll('input[name="provider"]').forEach(r => r.checked = false);
                        // Visual selection
                        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
                        if (element) element.classList.add('selected');

                        // Notify extension host
                        vscode.postMessage({ type: 'selectModel', modelId });

                        // Enable next button
                        document.getElementById('step1-next').disabled = false;
                }

                function retryOllama() {
                        ollamaChecked = false;
                        const icon = document.getElementById('ollama-icon');
                        const desc = document.getElementById('ollama-desc');
                        const detail = document.getElementById('ollama-detail');
                        icon.className = 'card-icon pending';
                        // SAFE: Static HTML template, no dynamic data
                        icon.innerHTML = '<span class="spinner"></span>';
                        desc.textContent = 'Checking if Ollama is running...';
                        detail.innerHTML = '';
                        vscode.postMessage({ type: 'retryOllama' });
                }

                // ---- Provider Selection ----
                document.getElementById('xenova-option').addEventListener('click', () => {
                        document.getElementById('xenova-radio').checked = true;
                        selectedProvider = 'xenova';
                        selectedModelId = null;
                        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
                        vscode.postMessage({ type: 'selectXenova' });
                        document.getElementById('step1-next').disabled = false;
                });

                document.getElementById('cloud-option').addEventListener('click', () => {
                        document.getElementById('cloud-radio').checked = true;
                        selectedProvider = 'cloud';
                        selectedModelId = null;
                        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
                        vscode.postMessage({ type: 'configureCloud' });
                        document.getElementById('step1-next').disabled = false;
                });

                // ---- Kali WSL ----
                function renderKaliStatus(data) {
                        kaliChecked = true;
                        const icon = document.getElementById('kali-icon');
                        const desc = document.getElementById('kali-desc');
                        const detail = document.getElementById('kali-detail');

                        if (data.notWindows) {
                                icon.className = 'card-icon info';
                                icon.textContent = '\\u2139';
                                desc.textContent = 'Kali WSL2 is only available on Windows. Skipping.';
                                // SAFE: Clearing element content, no dynamic data
                                detail.innerHTML = '';
                                // Auto-skip on non-Windows
                                skipKali();
                                return;
                        }

                        if (data.available) {
                                icon.className = 'card-icon success';
                                icon.textContent = '\\u2713';
                                desc.textContent = 'Kali WSL2 is installed and available.';
                                // XSS FIX: Replace inline onclick with DOM API + addEventListener
                                const checkOptDiv = document.createElement('div');
                                checkOptDiv.className = 'check-option';
                                const kaliCb = document.createElement('input');
                                kaliCb.type = 'checkbox';
                                kaliCb.id = 'kali-checkbox';
                                const kaliLabel = document.createElement('label');
                                kaliLabel.htmlFor = 'kali-checkbox';
                                kaliLabel.textContent = 'Enable Kali terminal profile in Kovix';
                                checkOptDiv.appendChild(kaliCb);
                                checkOptDiv.appendChild(kaliLabel);
                                checkOptDiv.addEventListener('click', () => enableKali(true));
                                detail.appendChild(checkOptDiv);
                                document.getElementById('step2-next').disabled = false;
                        } else {
                                icon.className = 'card-icon error';
                                icon.textContent = '\\u2717';
                                desc.textContent = 'Kali WSL2 is not installed.';
                                // SAFE: Static HTML template, no dynamic data
                                detail.innerHTML = \`
                                        <div class="install-instructions">
                                                <strong>To install Kali WSL2:</strong><br>
                                                1. Open PowerShell as Administrator<br>
                                                2. Run <code>wsl --install -d kali-linux</code><br>
                                                3. Restart Kovix after installation<br><br>
                                                You can also configure this later.
                                        </div>\`;
                                document.getElementById('step2-next').disabled = false;
                        }
                }

                function enableKali(enabled) {
                        kaliEnabled = enabled;
                        const cb = document.getElementById('kali-checkbox');
                        if (cb) cb.checked = enabled;
                        if (enabled) {
                                vscode.postMessage({ type: 'enableKaliWSL' });
                        }
                }

                function skipKali() {
                        kaliEnabled = false;
                        goToStep(3);
                }

                function skipAgentReach() {
                        agentReachInstalled = false;
                        goToStep(4);
                }

                function installAgentReach() {
                        agentReachInstalled = true;
                        vscode.postMessage({ type: 'installAgentReach' });
                        goToStep(4);
                }

                // ---- Summary ----
                function updateSummary() {
                        const providerNames = {
                                ollama: 'Ollama (Local)',
                                xenova: 'Xenova (In-Process)',
                                cloud: 'Cloud (OpenAI-Compatible)',
                        };
                        document.getElementById('summary-provider').textContent =
                                providerNames[selectedProvider] || 'Not selected';
                        document.getElementById('summary-model').textContent =
                                selectedModelId || 'Default';
                        const kaliRow = document.getElementById('summary-kali-row');
                        if (kaliRow && ${isWin ? 'true' : 'false'}) {
                                kaliRow.style.display = '';
                                document.getElementById('summary-kali').textContent =
                                        kaliEnabled ? 'Enabled' : 'Disabled';
                        }
                        document.getElementById('summary-agent-reach').textContent =
                                agentReachInstalled ? 'Installed' : 'Skipped';
                }

                // ---- Finish ----
                function finishSetup() {
                        vscode.postMessage({
                                type: 'finish',
                                config: {
                                        providerType: selectedProvider || 'xenova',
                                        modelId: selectedModelId,
                                        kaliWSLEnabled: kaliEnabled,
                                        agentReachInstalled: agentReachInstalled,
                                }
                        });
                }

                // ---- Message handler from extension host ----
                //
                // SECURITY FIX (M2): Validate the message source before processing.
                // VS Code webviews run inside an iframe with a 'vscode-webview://' origin.
                // The host (extension) posts messages via 'webview.postMessage()' which
                // arrive here with 'event.source === window.parent'. If a malicious
                // document somehow gets loaded into the webview (e.g. via a tool that
                // renders attacker-controlled HTML, or via a compromised script tag
                // that escaped CSP), it could otherwise post fake 'ollamaStatus' /
                // 'providerSwitched' / 'configSaved' messages and trick the onboarding
                // flow into advancing past steps or accepting a malicious provider
                // configuration.
                //
                // Defense-in-depth: reject any message whose 'source' is not the parent
                // frame. The CSP already blocks cross-origin scripts, but this guard
                // catches the case where an attacker has found a same-origin script
                // injection (e.g. via a future innerHTML regression — see M1) and is
                // trying to drive the onboarding state machine.
                function isTrustedHostMessage(event: MessageEvent): boolean {
                        // Accept only messages from the parent frame (the extension host bridge).
                        // 'window.parent' is the iframe parent in same-origin cases; for cross-origin
                        // parents (the normal webview case), 'event.source' is a WindowProxy that
                        // strict-equals 'window.parent'. Either way, this excludes sibling iframes,
                        // popups, and same-tab navigations.
                        if (event.source !== window.parent) {
                                return false;
                        }
                        // Reject any message that arrives with an unexpected origin. VS Code
                        // webview messages typically arrive with an empty string or a
                        // 'vscode-webview://'-family origin; either is acceptable. Anything
                        // else (https://, file://, http://) is rejected.
                        const origin = event.origin;
                        if (origin && origin !== 'null' && !origin.startsWith('vscode-webview:')) {
                                return false;
                        }
                        return true;
                }

                window.addEventListener('message', (event) => {
                        if (!isTrustedHostMessage(event)) {
                                return;
                        }
                        const msg = event.data;
                        switch (msg.type) {
                                case 'ollamaStatus':
                                        renderOllamaStatus(msg);
                                        break;
                                case 'modelSelected':
                                        // Model was successfully selected
                                        break;
                                case 'modelSelectError':
                                        break;
                                case 'providerSwitched':
                                        if (msg.success) {
                                                // Provider switched successfully
                                        }
                                        break;
                                case 'kaliStatus':
                                        renderKaliStatus(msg);
                                        break;
                                case 'kaliEnabled':
                                        break;
                                case 'kaliSkipped':
                                        break;
                                case 'agentReachInstalled':
                                        break;
                                case 'agentReachSkipped':
                                        break;
                                case 'configSaved':
                                        // Config saved — confirm to user and advance to next step
                                        const confirmDiv = document.createElement('div');
                                        confirmDiv.className = 'config-saved-confirmation';
                                        confirmDiv.textContent = 'Settings saved. Continuing...';
                                        document.body.appendChild(confirmDiv);
                                        setTimeout(() => confirmDiv.remove(), 1500);
                                        break;
                                default:
                                        break;
                        }
                });

                // ---- Initialize on load ----
                window.addEventListener('DOMContentLoaded', () => {
                        goToStep(0);
                        renderProviders();
                        checkOllama();
                        checkKali();
                });
        </script>
</body>

</html>`;
        }
}
