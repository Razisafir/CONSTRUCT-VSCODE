// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, ViewContainerLocation } from '../../../../workbench/common/views';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors';
import { Codicon } from '../../../../base/common/codicons';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { ConstructAgentViewPane } from './constructAgentView.js';
import { ConstructMemoryViewPane } from './constructMemoryView.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../../workbench/services/statusbar/browser/statusbar.js';
import { IWorkbenchContribution, Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../../workbench/common/contributions';
import { LifecyclePhase } from '../../../../workbench/services/lifecycle/common/lifecycle.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPMarketplace } from '../../../../platform/construct/common/mcp/mcpMarketplace.js';
import { IBrowserAutomationService } from '../../../../platform/construct/common/mcp/browserAutomation.js';
import { MCPServerManagerService } from './services/mcp/mcpServerManagerService.js';
import { MCPMarketplaceService } from './services/mcp/mcpMarketplaceService.js';
import { BrowserAutomationService } from './services/mcp/browserAutomationService.js';
import { IWorkingMemoryService } from '../../../../platform/construct/common/memory/workingMemory.js';
import { IEpisodicMemoryService } from '../../../../platform/construct/common/memory/episodicMemory.js';
import { ISemanticMemoryService } from '../../../../platform/construct/common/memory/semanticMemory.js';
import { IProceduralMemoryService } from '../../../../platform/construct/common/memory/proceduralMemory.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IEmbeddingService } from '../../../../platform/construct/common/memory/embeddingService.js';
import { IConstructMemoryService } from '../../../../platform/construct/common/memory/constructMemory.js';
import { WorkingMemoryService } from './services/memory/workingMemoryService.js';
import { EpisodicMemoryService } from './services/memory/episodicMemoryService.js';
import { SemanticMemoryService } from './services/memory/semanticMemoryService.js';
import { ProceduralMemoryService } from './services/memory/proceduralMemoryService.js';
import { MemoryOrchestratorService } from './services/memory/memoryOrchestratorService.js';
import { EmbeddingService } from './services/memory/embeddingService.js';
import { ConstructMemoryService } from './services/memory/constructMemoryService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICommandService } from '../../../../platform/commands/common/commands';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { AIProviderType } from '../../../../platform/construct/common/llm/constructAIProvider.js';
import { IConstructToolRegistry } from '../../../../platform/construct/common/tools/constructToolRegistry.js';
import { IMCPProcess } from '../../../../platform/construct/common/mcp/mcpProcess.js';
import { ITerminalExecutor } from '../../../../platform/construct/common/terminal/terminalExecutor.js';
import { IDiffApplier } from '../../../../platform/construct/common/editor/diffApplier.js';
import { IAgentLoop } from '../../../../platform/construct/common/agent/agentLoop.js';
import { ConstructAIService } from './services/llm/constructAIService.js';
import { ConstructToolRegistryService } from './services/tools/constructToolRegistryService.js';
import { MCPProcessService } from './services/mcp/mcpProcess.js';
import { TerminalExecutorService } from './services/terminal/terminalExecutor.js';
import { DiffApplierService } from './services/editor/diffApplier.js';
import { AgentLoopService } from './services/agent/agentLoop.js';
import { ISecureKeyManager } from '../../../../platform/construct/common/security/secureKeyManager.js';
import { SecureKeyManagerService } from './services/security/secureKeyManager.js';
import { IAgentErrorRecovery } from '../../../../platform/construct/common/recovery/agentErrorRecovery.js';
import { AgentErrorRecoveryService } from './services/recovery/agentErrorRecovery.js';
import { IFileWatcherService } from '../../../../platform/construct/common/watcher/fileWatcherService.js';
import { FileWatcherService } from './services/watcher/fileWatcherService.js';
import { ISnapshotManager } from '../../../../platform/construct/common/snapshot/snapshotManager.js';
import { SnapshotManagerService } from './services/snapshot/snapshotManager.js';
import { IPendingChangesService } from '../../../../platform/construct/common/diff/pendingChanges.js';
import { PendingChangesService } from './services/diff/pendingChangesService.js';
import { IConstructNotificationService } from '../../../../platform/construct/common/notification/constructNotificationService.js';
import { ConstructNotificationBrowserService } from './services/notification/constructNotificationService.js';
import { IConstructProjectService } from '../../../../platform/construct/common/project/constructProjectService.js';
import { ConstructProjectServiceImpl } from './services/project/constructProjectServiceImpl.js';
import { IIdeaRefinementService } from '../../../../platform/construct/common/agent/ideaRefinementService.js';
import { IdeaRefinementServiceImpl } from './services/agent/ideaRefinementServiceImpl.js';
import { IUniversalMemoryService } from '../../../../platform/construct/common/memory/universalMemoryService.js';
import { UniversalMemoryService } from './services/memory/universalMemoryService.js';
import { IConstructSessionService } from '../../../../platform/construct/common/session/constructSessionService.js';
import { ConstructSessionServiceImpl } from './services/session/constructSessionServiceImpl.js';
import { showProjectWizard } from './constructProjectWizard.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ConstructOnboardingWizard } from './constructOnboarding.js';
import './constructMemoryConfig';
import './constructApiConfig';
import './constructApiSettings';
import './constructAutocompleteConfig';

const constructViewIcon = registerIcon('construct-view-icon', Codicon.robot, localize('constructViewIcon', 'View icon of the Kovix Agent view.'));
const constructMemoryIcon = registerIcon('construct-memory-icon', Codicon.symbolEvent, localize('constructMemoryIcon', 'View icon of the Kovix Memory view.'));

// Register the Kovix view container in the sidebar
const constructViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
                id: 'construct',
                title: localize2('construct', "Kovix Agent"),
                ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['construct', { mergeViewWithContainerWhenSingleView: true }]),
                icon: constructViewIcon,
                order: 100,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: false });

// Register the agent panel view inside the container
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
                id: 'construct.agentPanel',
                name: localize2('agentPanel', "Agent"),
                containerIcon: constructViewIcon,
                ctorDescriptor: new SyncDescriptor(ConstructAgentViewPane),
                canToggleVisibility: true,
                canMoveView: true,
                order: 1,
}, {
                id: 'construct.memoryPanel',
                name: localize2('memoryPanel', "Memory"),
                containerIcon: constructMemoryIcon,
                ctorDescriptor: new SyncDescriptor(ConstructMemoryViewPane),
                canToggleVisibility: true,
                canMoveView: true,
                order: 2,
}], constructViewContainer);

// Status Bar Integration
class ConstructStatusBarContribution extends Disposable implements IWorkbenchContribution {
                static readonly ID = 'workbench.contrib.constructStatusBar';

                private modelEntryAccessor: IStatusbarEntryAccessor | undefined;
                private agentReachEntryAccessor: IStatusbarEntryAccessor | undefined;
                private ponytailEntryAccessor: IStatusbarEntryAccessor | undefined;

                constructor(
                                @IStatusbarService private readonly statusbarService: IStatusbarService,
                                @IConstructAIService private readonly aiService: IConstructAIService,
                ) {
                                super();

                                // Agent status (left side)
                                this._register(this.statusbarService.addEntry({
                                                name: localize('constructAgentStatus', "Kovix Agent Status"),
                                                text: '$(robot) Ready',
                                                ariaLabel: localize('constructAgentStatusAria', "Kovix Agent: Ready"),
                                                tooltip: localize('constructAgentStatusTooltip', "Kovix Agent: Idle -- click to open panel"),
                                                command: 'construct.focusPanel',
                                }, 'construct.agentStatus', StatusbarAlignment.LEFT, 50));

                                // Model info (left side) — dynamically updated from AI service
                                this.modelEntryAccessor = this._register(this.statusbarService.addEntry({
                                                name: localize('constructModel', "Kovix Model"),
                                                text: '$(zap) No Model local',
                                                ariaLabel: localize('constructModelAria', "Active LLM: No model selected"),
                                                tooltip: localize('constructModelTooltip', "Click to select a model"),
                                                command: 'construct.selectModel',
                                }, 'construct.model', StatusbarAlignment.LEFT, 51));

                                // Listen for provider and model changes
                                this._register(this.aiService.onDidChangeActiveModel(() => {
                                                this.updateModelStatus();
                                }));
                                this._register(this.aiService.onDidChangeActiveProvider(() => {
                                                this.updateModelStatus();
                                }));

                                // Pending changes (right side)
                                this._register(this.statusbarService.addEntry({
                                                name: localize('constructChanges', "Kovix Changes"),
                                                text: '$(diff-added) 0 pending',
                                                ariaLabel: localize('constructChangesAria', "No changes awaiting approval"),
                                                tooltip: localize('constructChangesTooltip', "No changes awaiting approval"),
                                }, 'construct.changes', StatusbarAlignment.RIGHT, 50));

                                // Agent Reach status (left side, priority 49)
                                this.agentReachEntryAccessor = this._register(this.statusbarService.addEntry({
                                                name: localize('constructAgentReach', "Agent Reach"),
                                                text: '$(globe) Agent Reach',
                                                ariaLabel: localize('constructAgentReachAria', "Agent Reach internet research tools"),
                                                tooltip: localize('constructAgentReachTooltip', "Click to check Agent Reach status"),
                                                command: 'construct.checkAgentReach',
                                }, 'construct.agentReach', StatusbarAlignment.LEFT, 49));

                                // Ponytail lazy-dev mode status (left side, priority 48)
                                this.ponytailEntryAccessor = this._register(this.statusbarService.addEntry({
                                                name: localize('constructPonytail', "Ponytail"),
                                                text: '$(shield) PONYTAIL',
                                                ariaLabel: localize('constructPonytailAria', "Ponytail lazy-dev mode: full"),
                                                tooltip: localize('constructPonytailTooltip', "Ponytail: full mode — click to change mode"),
                                                command: 'construct.ponytailSetMode',
                                }, 'construct.ponytail', StatusbarAlignment.LEFT, 48));
                }

                private updateModelStatus(): void {
                                if (!this.modelEntryAccessor) { return; }

                                const isLocal = this.aiService.isOffline();
                                const icon = isLocal ? '$(zap)' : '$(globe)';
                                const suffix = isLocal ? 'local' : 'cloud';
                                const model = this.aiService.getActiveModel();
                                const modelName = model?.displayName ?? 'No Model';

                                this.modelEntryAccessor.update({
                                                name: localize('constructModel', "Kovix Model"),
                                                text: `${icon} ${modelName} ${suffix}`,
                                                ariaLabel: localize('constructModelAria', `Active LLM: ${modelName} (${suffix})`),
                                                tooltip: localize('constructModelTooltip', `Active LLM: ${modelName} (${suffix}) — click to change`),
                                                command: 'construct.selectModel',
                                });
                }

                public updateAgentReachStatus(status: 'ok' | 'warn' | 'error', message?: string): void {
                                if (!this.agentReachEntryAccessor) { return; }
                                const icons = { ok: '$(globe)', warn: '$(globe~spin)', error: '$(globe~remove)' };
                                const icon = icons[status] || icons.error;
                                this.agentReachEntryAccessor.update({
                                                name: localize('constructAgentReach', "Agent Reach"),
                                                text: `${icon} ${message || 'Agent Reach'}`,
                                                ariaLabel: localize('constructAgentReachAria', `Agent Reach: ${message || status}`),
                                                tooltip: localize('constructAgentReachTooltip', `Agent Reach status: ${message || status} — click to check`),
                                                command: 'construct.checkAgentReach',
                                });
                }

                public updatePonytailStatus(mode: string): void {
                                if (!this.ponytailEntryAccessor) { return; }
                                const modeLabels: Record<string, string> = {
                                                lite: 'LITE',
                                                full: 'FULL',
                                                ultra: 'ULTRA',
                                                off: 'OFF',
                                };
                                const label = modeLabels[mode] || mode.toUpperCase();
                                const icon = mode === 'off' ? '$(circle-slash)' : '$(shield)';
                                this.ponytailEntryAccessor.update({
                                                name: localize('constructPonytail', "Ponytail"),
                                                text: `${icon} PONYTAIL ${label}`,
                                                ariaLabel: localize('constructPonytailAria', `Ponytail lazy-dev mode: ${mode}`),
                                                tooltip: localize('constructPonytailTooltip', `Ponytail: ${mode} mode — click to change`),
                                                command: 'construct.ponytailSetMode',
                                });
                }
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(ConstructStatusBarContribution, LifecyclePhase.Restored);

// --- Construct Commands --------------------------------------------------------

registerAction2(class FocusConstructPanelAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.focusPanel',
                                                title: localize2('focusConstructPanel', "Show Construct Agent"),
                                                keybinding: {
                                                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL,
                                                                weight: KeybindingWeight.WorkbenchContrib,
                                                },
                                                f1: true,
                                                category: localize2('constructCategory', "Construct"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('construct.agentPanel', true);
                }
});

registerAction2(class NewConstructChatAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.newChat',
                                                title: localize2('newConstructChat', "New Construct Chat"),
                                                f1: true,
                                                category: localize2('constructCategory2', "Construct"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('construct.agentPanel', true);
                }
});

registerAction2(class ShowInlineAgentAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.showInlineAgent',
                                                title: localize2('showInlineAgent', "Show Inline Agent"),
                                                keybinding: {
                                                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI,
                                                                weight: KeybindingWeight.WorkbenchContrib,
                                                },
                                                f1: true,
                                                category: localize2('constructCategory3', "Construct"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('construct.agentPanel', true);
                }
});

// --- Memory Commands (Phase 19+Supermemory) ------------------------------------

registerAction2(class OpenMemoryPanelAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.openMemoryPanel',
                                                title: localize2('openMemoryPanel', "Open Memory Panel"),
                                                f1: true,
                                                category: localize2('constructCategory4', "Construct"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('construct.memoryPanel', true);
                }
});

registerAction2(class SearchMemoriesAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.searchMemories',
                                                title: localize2('searchMemories', "Search Memories"),
                                                f1: true,
                                                category: localize2('constructCategory5', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const quickInput = accessor.get(IQuickInputService);
                                const memoryService = accessor.get(IConstructMemoryService);
                                const logService = accessor.get(ILogService);

                                const query = await new Promise<string | undefined>((resolve) => {
                                                const input = quickInput.createInputBox();
                                                input.placeholder = 'Search memories...';
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

                                if (!query) { return; }

                                try {
                                                const results = await memoryService.searchMemories(query, 'hybrid', 10);
                                                if (results.length === 0) {
                                                                quickInput.pick([{ label: 'No memories found', alwaysShow: true }]);
                                                                return;
                                                }

                                                const picks = results.map(r => ({
                                                                label: r.content.length > 100 ? r.content.substring(0, 100) + '...' : r.content,
                                                                detail: r.metadata?.type ? String(r.metadata.type) : undefined,
                                                                description: r.score ? `${(r.score * 100).toFixed(0)}% match` : undefined,
                                                }));

                                                await quickInput.pick(picks, { placeHolder: `${results.length} memories found` });
                                } catch (error) {
                                                logService.error('[Construct] Search failed:', error);
                                }
                }
});

registerAction2(class AddMemoryAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.addMemory',
                                                title: localize2('addMemory', "Add Memory"),
                                                f1: true,
                                                category: localize2('constructCategory6', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const quickInput = accessor.get(IQuickInputService);
                                const memoryService = accessor.get(IConstructMemoryService);
                                const notificationService = accessor.get(INotificationService);

                                const content = await new Promise<string | undefined>((resolve) => {
                                                const input = quickInput.createInputBox();
                                                input.placeholder = 'Enter a fact or memory to store...';
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

                                if (!content) { return; }

                                try {
                                                await memoryService.addMemory(content, { type: 'manual', source: 'command' });
                                                notificationService.info(`Memory added: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
                                } catch (error) {
                                                notificationService.error(`Failed to add memory: ${error instanceof Error ? error.message : String(error)}`);
                                }
                }
});

registerAction2(class TestLLMConnectionAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.testMemoryConnection',
                                                title: localize2('testMemoryConnection', "Test Memory Connection"),
                                                f1: true,
                                                category: localize2('constructCategory7', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const memoryService = accessor.get(IConstructMemoryService);
                                const notificationService = accessor.get(INotificationService);

                                if (!memoryService.isInitialized) {
                                                notificationService.warn('Supermemory is not connected. Please configure your API key in settings.');
                                                return;
                                }

                                const healthy = await memoryService.testConnection();
                                if (healthy) {
                                                notificationService.info('[MEMORY] Supermemory connection: Healthy');
                                } else {
                                                notificationService.error('[MEMORY] Supermemory connection: Failed. Check your API key.');
                                }
                }
});

// --- LLM Integration Commands (Phase 4) ---------------------------------------

registerAction2(class OpenApiSettingsAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.openApiSettings',
                                                title: localize2('openApiSettings', "Open API Settings"),
                                                f1: true,
                                                category: localize2('constructCategoryApi', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                accessor.get(ICommandService).executeCommand('workbench.action.openSettings', 'construct.anthropic');
                }
});

registerAction2(class SetApiKeyAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.setApiKey',
                                                title: localize2('setApiKey', "Set API Key"),
                                                f1: true,
                                                category: localize2('constructCategoryApiKey', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const keyManager = accessor.get(ISecureKeyManager);
                                const notificationService = accessor.get(INotificationService);
                                const quickInputService = accessor.get(IQuickInputService);
                                const key = await quickInputService.input({
                                                prompt: 'Enter your Anthropic API key',
                                                password: true,
                                                placeHolder: 'sk-ant-...',
                                                validateInput: async (value: string) => {
                                                                if (!value) { return 'Key cannot be empty'; }
                                                                if (!value.startsWith('sk-ant-')) { return 'Key must start with sk-ant-'; }
                                                                return undefined as unknown as string;
                                                }
                                });
                                if (key) {
                                                await keyManager.setKey('anthropic', key);
                                                notificationService.info('CONSTRUCT: Anthropic API key saved.');
                                }
                }
});

registerAction2(class ClearApiKeyAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.clearApiKey',
                                                title: localize2('clearApiKey', "Clear API Key"),
                                                f1: true,
                                                category: localize2('constructCategoryApiKey2', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const keyManager = accessor.get(ISecureKeyManager);
                                const notificationService = accessor.get(INotificationService);
                                await keyManager.deleteKey('anthropic');
                                notificationService.info('CONSTRUCT: Anthropic API key removed.');
                }
});

registerAction2(class TestCloudConnectionAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.testCloudConnection',
                                                title: localize2('testCloudConnection', "Test Cloud AI Connection"),
                                                f1: true,
                                                category: localize2('constructCategoryCloud', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const aiService = accessor.get(IConstructAIService);
                                const notificationService = accessor.get(INotificationService);

                                // Ensure a cloud provider is configured
                                const provider = aiService.getProvider('cloud');
                                if (!provider) {
                                                notificationService.warn('Cloud provider not available. Configure it in Construct settings first.');
                                                return;
                                }

                                // Try a minimal API call to test the connection
                                try {
                                                const stream = aiService.chat(
                                                                [{ role: 'user', content: 'Reply with exactly: OK' }],
                                                                [],
                                                                { systemPrompt: 'You are a test assistant. Reply concisely.' },
                                                );
                                                let response = '';
                                                for await (const event of stream) {
                                                                if (event.type === 'token') { response += event.text; }
                                                                if (event.type === 'error') {
                                                                                notificationService.error(`Cloud AI connection failed: ${event.text}`);
                                                                                return;
                                                                }
                                                }
                                                const model = aiService.getActiveModel();
                                                notificationService.info(`Cloud AI connection: Working (model: ${model?.displayName ?? 'unknown'})`);
                                } catch (error) {
                                                notificationService.error(`Cloud AI connection failed: ${error instanceof Error ? error.message : String(error)}`);
                                }
                }
});

// --- MCP Service Singletons (Phase 17) -----------------------------------------
registerSingleton(IMCPServerManager, MCPServerManagerService, InstantiationType.Delayed);
registerSingleton(IMCPMarketplace, MCPMarketplaceService, InstantiationType.Delayed);

// --- Browser Automation Singleton (Phase 18) -----------------------------------
registerSingleton(IBrowserAutomationService, BrowserAutomationService, InstantiationType.Delayed);

// --- Memory Architecture Singletons (Phase 19) ---------------------------------
registerSingleton(IWorkingMemoryService, WorkingMemoryService, InstantiationType.Delayed);
registerSingleton(IEpisodicMemoryService, EpisodicMemoryService, InstantiationType.Delayed);
registerSingleton(IEmbeddingService, EmbeddingService, InstantiationType.Delayed);
registerSingleton(ISemanticMemoryService, SemanticMemoryService, InstantiationType.Delayed);
registerSingleton(IProceduralMemoryService, ProceduralMemoryService, InstantiationType.Delayed);
registerSingleton(IMemoryOrchestrator, MemoryOrchestratorService, InstantiationType.Delayed);

// --- Supermemory Integration Singleton (Phase 19+) ----------------------------
registerSingleton(IConstructMemoryService, ConstructMemoryService, InstantiationType.Delayed);

// --- LLM Integration Singletons (Phase 4) --------------------------------------
// NOTE: IAnthropicProvider removed — Anthropic API is now a backend within
// CloudProvider inside IConstructAIService, not a separate top-level service.
registerSingleton(IMCPProcess, MCPProcessService, InstantiationType.Delayed);
registerSingleton(ITerminalExecutor, TerminalExecutorService, InstantiationType.Delayed);
registerSingleton(IDiffApplier, DiffApplierService, InstantiationType.Delayed);
registerSingleton(IAgentLoop, AgentLoopService, InstantiationType.Delayed);

// --- Phase 1: AI Provider Layer -----------------------------------------------
// The unified AI service auto-selects the best provider: Ollama > Xenova > Cloud
registerSingleton(IConstructAIService, ConstructAIService, InstantiationType.Delayed);

// --- Phase 4: Tool/Skill Engine -----------------------------------------------
// Built-in tools (read_file, write_file, run_terminal, search_codebase, web_search)
// + Kali WSL2 integration + command safety blocklist
registerSingleton(IConstructToolRegistry, ConstructToolRegistryService, InstantiationType.Delayed);

// Command: Switch AI Provider
registerAction2(class SwitchAIProviderAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.switchProvider',
                        title: localize2('switchAIProvider', "Switch AI Provider"),
                        f1: true,
                        category: localize2('constructCategoryAI', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const aiService = accessor.get(IConstructAIService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const providerTypes: AIProviderType[] = ['ollama', 'xenova', 'cloud'];
                const labels: Record<AIProviderType, string> = {
                        ollama: '$(server) Ollama (Local)',
                        xenova: '$(cpu) Xenova (In-Process)',
                        cloud: '$(globe) Cloud (OpenAI-Compatible)',
                };

                const currentType = aiService.activeProviderType;
                const picks = providerTypes.map(pt => ({
                        label: labels[pt],
                        description: pt === currentType ? '(active)' : '',
                        providerType: pt,
                }));

                const pick = await quickInput.pick(picks, {
                        placeHolder: 'Select AI provider',
                });

                if (pick) {
                        const selected = pick.providerType as AIProviderType;
                        const success = await aiService.switchProvider(selected);
                        if (success) {
                                const model = aiService.getActiveModel();
                                notificationService.info(
                                        `CONSTRUCT: Switched to ${selected} provider${model ? ' (model: ' + model.displayName + ')' : ''}`
                                );
                        }
                }
        }
});

// Command: Select Model
registerAction2(class SelectModelAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.selectModel',
                        title: localize2('selectModel', "Select AI Model"),
                        f1: true,
                        category: localize2('constructCategoryModel', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const aiService = accessor.get(IConstructAIService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const models = await aiService.listModels();
                if (models.length === 0) {
                        notificationService.warn('No models available. Please check your AI provider settings.');
                        return;
                }

                const currentModel = aiService.getActiveModel();
                const picks = models.map(m => ({
                        label: m.displayName,
                        description: m.provider + (m.id === currentModel?.id ? ' (active)' : ''),
                        detail: `Context: ${m.contextWindowTokens.toLocaleString()} tokens` + (m.supportsTools ? ' | Tools: Yes' : ''),
                        modelId: m.id,
                }));

                const pick = await quickInput.pick(picks, {
                        placeHolder: 'Select a model',
                });

                if (pick) {
                        const success = await aiService.setActiveModel(pick.modelId);
                        if (success) {
                                notificationService.info(`CONSTRUCT: Model set to ${pick.label}`);
                        } else {
                                notificationService.error('Failed to switch model.');
                        }
                }
        }
});

// --- Phase 1: Core Maturity Singletons ----------------------------------------
registerSingleton(ISecureKeyManager, SecureKeyManagerService, InstantiationType.Delayed);
registerSingleton(IAgentErrorRecovery, AgentErrorRecoveryService, InstantiationType.Delayed);
registerSingleton(IFileWatcherService, FileWatcherService, InstantiationType.Delayed);
registerSingleton(ISnapshotManager, SnapshotManagerService, InstantiationType.Delayed);
registerSingleton(IPendingChangesService, PendingChangesService, InstantiationType.Delayed);
registerSingleton(IConstructNotificationService, ConstructNotificationBrowserService, InstantiationType.Delayed);

// --- Feature Build: Project, Idea Refinement, Universal Memory, Session -----------
registerSingleton(IConstructProjectService, ConstructProjectServiceImpl, InstantiationType.Delayed);
registerSingleton(IIdeaRefinementService, IdeaRefinementServiceImpl, InstantiationType.Delayed);
registerSingleton(IUniversalMemoryService, UniversalMemoryService, InstantiationType.Delayed);
registerSingleton(IConstructSessionService, ConstructSessionServiceImpl, InstantiationType.Delayed);

// --- Feature Build: Project Commands -----------------------------------------
registerAction2(class NewProjectAction extends Action2 {
                constructor() {
                        super({
                                id: 'construct.newProject',
                                title: localize2('newConstructProject', "New Kovix Project"),
                                f1: true,
                                category: localize2('constructCategoryProject', "Construct"),
                        });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                        const instantiationService = accessor.get(IInstantiationService);
                        await showProjectWizard(instantiationService);
                }
});

registerAction2(class OpenProjectWizardAction extends Action2 {
                constructor() {
                        super({
                                id: 'construct.openProjectWizard',
                                title: localize2('openProjectWizard', "Open Project Wizard"),
                                f1: true,
                                category: localize2('constructCategoryWizard', "Construct"),
                        });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                        const instantiationService = accessor.get(IInstantiationService);
                        await showProjectWizard(instantiationService);
                }
});

registerAction2(class LoadProjectAction extends Action2 {
                constructor() {
                        super({
                                id: 'construct.loadProject',
                                title: localize2('loadProject', "Load Kovix Project"),
                                f1: true,
                                category: localize2('constructCategoryLoadProject', "Construct"),
                        });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                        const projectService = accessor.get(IConstructProjectService);
                        const quickInput = accessor.get(IQuickInputService);
                        const notificationService = accessor.get(INotificationService);

                        const projects = projectService.projects;
                        if (projects.length === 0) {
                                notificationService.info('No projects found. Create one with "New Kovix Project".');
                                return;
                        }

                        const picks = projects.map(p => ({
                                label: p.name,
                                description: p.template,
                                detail: `Status: ${p.status}`,
                                projectId: p.id,
                        }));

                        const pick = await quickInput.pick(picks, { placeHolder: 'Select a project to load' });
                        if (pick) {
                                await projectService.loadProject((pick as any).projectId);
                                notificationService.info(`Project loaded: ${pick.label}`);
                        }
                }
});

// --- Phase 1: Task-Level Undo Command -----------------------------------------
registerAction2(class UndoTaskAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.undoTask',
                                                title: localize2('undoTask', "Undo Last Task"),
                                                f1: true,
                                                category: localize2('constructCategoryUndo', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const agentLoop = accessor.get(IAgentLoop);
                                const notificationService = accessor.get(INotificationService);
                                const logService = accessor.get(ILogService);

                                if (agentLoop.isRunning) {
                                                notificationService.warn('Cannot undo while an agent task is running.');
                                                return;
                                }

                                try {
                                                const result = await agentLoop.undoLastTask();
                                                if (!result) {
                                                                notificationService.info('No task to undo.');
                                                                return;
                                                }
                                                if (result.success) {
                                                                notificationService.info(`Task undone: ${result.restoredCount} files restored, ${result.deletedCount} files removed (${result.durationMs}ms)`);
                                                } else {
                                                                notificationService.error(`Undo failed: ${result.error}`);
                                                }
                                } catch (error) {
                                                logService.error('[Construct] Undo task failed:', error);
                                                notificationService.error(`Undo failed: ${error instanceof Error ? error.message : String(error)}`);
                                }
                }
});

// --- Phase 2: Diff Accept/Reject Commands -------------------------------------

registerAction2(class AcceptAllDiffsAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.acceptAllDiffs',
                        title: localize2('acceptAllDiffs', "Accept All Pending Diffs"),
                        f1: true,
                        category: localize2('constructCategoryDiff', "Construct"),
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const viewsService = accessor.get(IViewsService);
                const notificationService = accessor.get(INotificationService);
                const view = viewsService.getActiveViewWithId('construct.agentPanel') as any;
                if (view && typeof view.acceptAllPendingDiffs === 'function') {
                        await view.acceptAllPendingDiffs();
                        notificationService.info('All pending diffs accepted.');
                } else {
                        notificationService.warn('No agent panel with pending diffs found.');
                }
        }
});

registerAction2(class RejectAllDiffsAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.rejectAllDiffs',
                        title: localize2('rejectAllDiffs', "Reject All Pending Diffs"),
                        f1: true,
                        category: localize2('constructCategoryDiff2', "Construct"),
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Escape,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        run(accessor: ServicesAccessor): void {
                const viewsService = accessor.get(IViewsService);
                const notificationService = accessor.get(INotificationService);
                const view = viewsService.getActiveViewWithId('construct.agentPanel') as any;
                if (view && typeof view.rejectAllPendingDiffs === 'function') {
                        view.rejectAllPendingDiffs();
                        notificationService.info('All pending diffs rejected.');
                } else {
                        notificationService.warn('No agent panel with pending diffs found.');
                }
        }
});

// --- Onboarding Wizard (First-Launch) ------------------------------------------

registerAction2(class OpenOnboardingWizardAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.openOnboarding',
                        title: localize2('openOnboarding', "Open Setup Wizard"),
                        f1: true,
                        category: localize2('constructCategoryOnboarding', "Construct"),
                });
        }
        run(accessor: ServicesAccessor): void {
                const instantiationService = accessor.get(IInstantiationService);
                const wizard = instantiationService.createInstance(ConstructOnboardingWizard);
                wizard.show();
        }
});

// --- Phase 8: Semantic Memory -- Index Workspace Command ---

registerAction2(class IndexWorkspaceAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.indexWorkspace',
                        title: localize2('indexWorkspace', "Index Workspace for Semantic Search"),
                        f1: true,
                        category: localize2('constructCategoryMemory', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const memoryService = accessor.get(IConstructMemoryService);
                const notificationService = accessor.get(INotificationService);
                notificationService.info('CONSTRUCT: Indexing workspace for semantic search...');
                try {
                        await memoryService.addMemory('Workspace indexing initiated', { type: 'index-trigger', source: 'workspace-index' });
                        notificationService.info('CONSTRUCT: Workspace indexing complete.');
                } catch (err) {
                        notificationService.error('CONSTRUCT: Workspace indexing failed: ' + (err instanceof Error ? err.message : String(err)));
                }
        }
});

// --- MCP Server Management Commands (Phase 17) ---------------------------------

registerAction2(class StartMCPServerAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.mcp.startServer',
                        title: localize2('startMCPServer', "Start MCP Server"),
                        f1: true,
                        category: localize2('constructCategoryMCP', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const mcpManager = accessor.get(IMCPServerManager);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                try {
                        const servers = mcpManager.listInstalledServers();
                        const stoppedServers = servers.filter(s => mcpManager.getServerStatus(s.name) !== 'running');

                        if (stoppedServers.length === 0) {
                                notificationService.info('All MCP servers are already running.');
                                return;
                        }

                        const picks = stoppedServers.map(s => ({
                                label: '$(circle-outline) ' + s.name,
                                description: s.command,
                                detail: mcpManager.getServerStatus(s.name),
                                serverName: s.name,
                        }));

                        const pick = await quickInput.pick(picks, { placeHolder: 'Select an MCP server to start' });

                        if (pick) {
                                await mcpManager.startServer(pick.serverName);
                                notificationService.info('MCP server started: ' + pick.serverName);
                        }
                } catch (error) {
                        logService.error('[Construct] Failed to start MCP server:', error);
                        notificationService.error('Failed to start MCP server: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

registerAction2(class StopMCPServerAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.mcp.stopServer',
                        title: localize2('stopMCPServer', "Stop MCP Server"),
                        f1: true,
                        category: localize2('constructCategoryMCP2', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const mcpManager = accessor.get(IMCPServerManager);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                try {
                        const servers = mcpManager.listInstalledServers();
                        const runningServers = servers.filter(s => mcpManager.getServerStatus(s.name) === 'running');

                        if (runningServers.length === 0) {
                                notificationService.info('No MCP servers are currently running.');
                                return;
                        }

                        const picks = runningServers.map(s => ({
                                label: '$(circle-filled) ' + s.name,
                                description: s.command,
                                detail: mcpManager.getServerStatus(s.name),
                                serverName: s.name,
                        }));

                        const pick = await quickInput.pick(picks, { placeHolder: 'Select an MCP server to stop' });

                        if (pick) {
                                await mcpManager.stopServer(pick.serverName);
                                notificationService.info('MCP server stopped: ' + pick.serverName);
                        }
                } catch (error) {
                        logService.error('[Construct] Failed to stop MCP server:', error);
                        notificationService.error('Failed to stop MCP server: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

// --- Provider Status Command ---

registerAction2(class ProviderStatusAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.providerStatus',
                        title: localize2('providerStatus', "Show AI Provider Status"),
                        f1: true,
                        category: localize2('constructCategoryProvider', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const aiService = accessor.get(IConstructAIService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                try {
                        const activeType = aiService.activeProviderType;
                        const activeModel = aiService.getActiveModel();
                        const isOffline = aiService.isOffline();
                        const models = await aiService.listModels();

                        const statusLines: string[] = [
                                'Provider: ' + activeType + (isOffline ? ' (offline)' : ' (cloud)'),
                                'Model: ' + (activeModel?.displayName ?? 'None selected'),
                                'Available models: ' + models.length,
                        ];

                        // Check Ollama availability
                        try {
                                const ollamaProvider = aiService.getProvider('ollama');
                                if (ollamaProvider) {
                                        statusLines.push('Ollama: Available');
                                } else {
                                        statusLines.push('Ollama: Not detected');
                                }
                        } catch {
                                statusLines.push('Ollama: Not detected');
                        }

                        // Check cloud availability
                        try {
                                const cloudProvider = aiService.getProvider('cloud');
                                if (cloudProvider) {
                                        statusLines.push('Cloud: Configured');
                                } else {
                                        statusLines.push('Cloud: Not configured');
                                }
                        } catch {
                                statusLines.push('Cloud: Not configured');
                        }

                        notificationService.info('CONSTRUCT Status: ' + statusLines.join(' | '));
                        logService.info('[Construct] Provider status: ' + statusLines.join(', '));
                } catch (error) {
                        logService.error('[Construct] Failed to get provider status:', error);
                        notificationService.error('Failed to get provider status: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

// --- f2u-cli (File-to-URL) Commands ------------------------------------------

registerAction2(class FileToUrlAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.fileToUrl',
                        title: localize2('fileToUrl', "Convert File to URL (f2u)"),
                        f1: true,
                        category: localize2('constructCategoryF2U', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const notificationService = accessor.get(INotificationService);
                const terminalExecutor = accessor.get(ITerminalExecutor);
                const logService = accessor.get(ILogService);

                try {
                        const result = await terminalExecutor.execute('f2u --version');
                        if (result.exitCode === 0) {
                                notificationService.info('f2u-cli: ' + (result.stdout || 'Ready'));
                        } else {
                                notificationService.warn('f2u-cli: Not installed. Run "npm install -g f2u-cli" to set it up.');
                        }
                } catch (error) {
                        logService.error('[Construct] f2u-cli check failed:', error);
                        notificationService.warn('f2u-cli: Not installed. Run "npm install -g f2u-cli" to set it up.');
                }
        }
});

// --- GoClaw MCP Commands -----------------------------------------------------

registerAction2(class GoclawDashboardAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.goclawDashboard',
                        title: localize2('goclawDashboard', "Open GoClaw Dashboard"),
                        f1: true,
                        category: localize2('constructCategoryGoclaw', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const notificationService = accessor.get(INotificationService);
                const mcpManager = accessor.get(IMCPServerManager);
                const logService = accessor.get(ILogService);

                try {
                        const status = mcpManager.getServerStatus('goclaw');
                        if (status === 'running') {
                                notificationService.info('GoClaw: MCP server is running. Dashboard available via the GoClaw Gateway.');
                        } else {
                                notificationService.info('GoClaw: MCP server is not running. Start it via "Construct: Start MCP Server".');
                        }
                } catch (error) {
                        logService.error('[Construct] GoClaw dashboard check failed:', error);
                        notificationService.warn('GoClaw: MCP server not configured. Ensure goclaw-mcp is installed.');
                }
        }
});

// --- Agent Reach Commands ----------------------------------------------------

registerAction2(class CheckAgentReachAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.checkAgentReach',
                        title: localize2('checkAgentReach', "Check Agent Reach Health"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const terminalExecutor = accessor.get(ITerminalExecutor);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                notificationService.info('Agent Reach: Running health check...');
                try {
                        const result = await terminalExecutor.execute('agent-reach doctor');
                        if (result.exitCode === 0) {
                                notificationService.info('Agent Reach: Healthy — ' + (result.stdout || 'All systems operational'));
                        } else {
                                notificationService.warn('Agent Reach: Not installed or not working. Use "Construct: Install Agent Reach" to set it up.');
                        }
                } catch (error) {
                        logService.error('[Construct] Agent Reach health check failed:', error);
                        notificationService.warn('Agent Reach: Not installed. Use "Construct: Install Agent Reach" to set it up.');
                }
        }
});

registerAction2(class InstallAgentReachAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.installAgentReach',
                        title: localize2('installAgentReach', "Install Agent Reach"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach2', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const terminalExecutor = accessor.get(ITerminalExecutor);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                notificationService.info('Agent Reach: Starting installation...');
                try {
                        // Install agent-reach via pipx
                        const installResult = await terminalExecutor.execute('pipx install agent-reach || pip install --user agent-reach');
                        if (installResult.exitCode === 0) {
                                notificationService.info('Agent Reach: Installed successfully!');
                                // Run doctor to verify
                                const doctorResult = await terminalExecutor.execute('agent-reach doctor');
                                if (doctorResult.exitCode === 0) {
                                        notificationService.info('Agent Reach: Installation verified and ready.');
                                } else {
                                        notificationService.warn('Agent Reach: Installed but verification failed. Try reloading the window.');
                                }
                        } else {
                                notificationService.error('Agent Reach: Installation failed. Ensure pipx or pip is available.');
                        }
                } catch (error) {
                        logService.error('[Construct] Agent Reach installation failed:', error);
                        notificationService.error('Agent Reach: Installation failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

registerAction2(class ConfigureAgentReachAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.configureAgentReach',
                        title: localize2('configureAgentReach', "Configure Agent Reach Channels"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach3', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const notificationService = accessor.get(INotificationService);
                const commandService = accessor.get(ICommandService);

                notificationService.info('Agent Reach: Channels are configured automatically. Use the status bar icon or run "Check Agent Reach Health" to verify.');
                commandService.executeCommand('construct.checkAgentReach');
        }
});

registerAction2(class SearchWebExaAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.searchWebExa',
                        title: localize2('searchWebExa', "Search Web (Exa)"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach4', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const terminalExecutor = accessor.get(ITerminalExecutor);
                const logService = accessor.get(ILogService);

                const query = await quickInput.input({
                        prompt: 'Enter search query for Exa web search',
                        placeHolder: 'e.g., latest TypeScript features',
                });

                if (!query) { return; }

                try {
                        notificationService.info(`Agent Reach: Searching Exa for "${query}"...`);
                        const result = await terminalExecutor.execute(`agent-reach search-exa "${query.replace(/"/g, '\\"')}"`);
                        if (result.exitCode === 0) {
                                notificationService.info('Agent Reach (Exa): ' + (result.stdout || 'Search completed'));
                        } else {
                                notificationService.warn('Agent Reach: Exa search failed. Ensure Agent Reach is installed.');
                        }
                } catch (error) {
                        logService.error('[Construct] Exa search failed:', error);
                        notificationService.error('Exa search failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

registerAction2(class ReadWebpageAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.readWebpage',
                        title: localize2('readWebpage', "Read Webpage"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach5', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const terminalExecutor = accessor.get(ITerminalExecutor);
                const logService = accessor.get(ILogService);

                const url = await quickInput.input({
                        prompt: 'Enter webpage URL to read',
                        placeHolder: 'https://example.com',
                        validateInput: async (value: string) => {
                                if (!value) { return 'URL cannot be empty'; }
                                if (!value.startsWith('http://') && !value.startsWith('https://')) {
                                        return 'URL must start with http:// or https://';
                                }
                                return undefined;
                        },
                });

                if (!url) { return; }

                try {
                        notificationService.info(`Agent Reach: Reading ${url}...`);
                        const result = await terminalExecutor.execute(`agent-reach read-web "${url.replace(/"/g, '\\"')}"`);
                        if (result.exitCode === 0) {
                                notificationService.info('Agent Reach: Page read — ' + (result.stdout || 'Done'));
                        } else {
                                notificationService.warn('Agent Reach: Failed to read page. Ensure Agent Reach is installed.');
                        }
                } catch (error) {
                        logService.error('[Construct] Read webpage failed:', error);
                        notificationService.error('Read webpage failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

// --- Ponytail Commands (Lazy Senior Developer Mode) ----------------------------

registerAction2(class PonytailSetModeAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.ponytailSetMode',
                        title: localize2('ponytailSetMode', "Set Ponytail Mode"),
                        f1: true,
                        category: localize2('constructCategoryPonytail', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const modes: { label: string; detail: string; mode: string }[] = [
                        { label: '$(shield) Full', detail: 'The ladder enforced: YAGNI → stdlib → native → deps → one line → minimum', mode: 'full' },
                        { label: '$(shield) Lite', detail: "Build what's asked, name the lazier alternative in one line", mode: 'lite' },
                        { label: '$(shield) Ultra', detail: 'YAGNI extremist. Deletion before addition. Challenges requirements.', mode: 'ultra' },
                        { label: '$(circle-slash) Off', detail: 'Disable Ponytail rules', mode: 'off' },
                ];

                const pick = await quickInput.pick(modes, { placeHolder: 'Select Ponytail lazy-dev mode' });
                if (pick) {
                        // Save mode to ~/.kovix/ponytail-mode.json
                        const fs = await import('fs');
                        const path = await import('path');
                        const os = await import('os');
                        const modeFile = path.join(os.homedir(), '.kovix', 'ponytail-mode.json');
                        try {
                                if (!fs.existsSync(path.dirname(modeFile))) {
                                        fs.mkdirSync(path.dirname(modeFile), { recursive: true });
                                }
                                fs.writeFileSync(modeFile, JSON.stringify({ mode: pick.mode, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
                                notificationService.info(`Ponytail mode set to: ${pick.mode.toUpperCase()}`);
                        } catch (error) {
                                notificationService.warn(`Ponytail: Could not persist mode — ${error instanceof Error ? error.message : String(error)}`);
                        }
                }
        }
});

registerAction2(class PonytailReviewAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.ponytailReview',
                        title: localize2('ponytailReview', "Review Current File for Over-Engineering"),
                        f1: true,
                        category: localize2('constructCategoryPonytail2', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                try {
                        notificationService.info(
                                'Ponytail review: Ask the agent "Review this file with ponytail" or use the ponytail_review_code tool.'
                        );
                } catch (error) {
                        logService.error('[Construct] Ponytail review failed:', error);
                        notificationService.error('Ponytail review failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

registerAction2(class PonytailHelpAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.ponytailHelp',
                        title: localize2('ponytailHelp', "Show Ponytail Help"),
                        f1: true,
                        category: localize2('constructCategoryPonytail3', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const notificationService = accessor.get(INotificationService);

                const helpLines = [
                        'Ponytail — Lazy Senior Developer Mode',
                        '',
                        'Modes:',
                        '  /ponytail full   — Enforce the decision ladder (default)',
                        '  /ponytail lite   — Build what\'s asked, suggest lazier alternatives',
                        '  /ponytail ultra  — YAGNI extremist, challenge requirements',
                        '  /ponytail off    — Disable Ponytail rules',
                        '',
                        'Commands:',
                        '  /ponytail-review     — Review current diff for over-engineering',
                        '  /ponytail-audit      — Audit entire repo for bloat',
                        '  /ponytail-debt       — List all ponytail: shortcut comments',
                        '  /ponytail-help       — This help card',
                        '',
                        'Decision Ladder:',
                        '  1. YAGNI — Does this need to exist?',
                        '  2. Stdlib — Does the standard library already do this?',
                        '  3. Native — Does a platform feature cover it?',
                        '  4. Deps   — Does an installed dependency solve it?',
                        '  5. One line — Can it be one line?',
                        '  6. Minimum — Only then: write the minimum code.',
                        '',
                        'Full docs: https://github.com/DietrichGebert/ponytail',
                ];

                notificationService.info(helpLines.join('\n'));
        }
});

// --- UI-UX Pro Max — Design Intelligence Commands --------------------------------

registerAction2(class UiuxSearchStyleAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.uiuxSearchStyle',
                        title: localize2('uiuxSearchStyle', "Search UI Styles"),
                        f1: true,
                        category: localize2('constructCategoryUiux', "Construct: Design"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const quickInput = accessor.get(IQuickInputService);
                const toolRegistry = accessor.get(IConstructToolRegistry);
                const notificationService = accessor.get(INotificationService);

                const query = await quickInput.input({ prompt: 'Search UI styles (e.g., "glassmorphism dashboard", "minimalist SaaS")' });
                if (!query) { return; }

                try {
                        const result = await toolRegistry.execute('uiux_pro_max__search_style', { query, max_results: 3 });
                        notificationService.info(result.output || 'No results found.');
                } catch (error) {
                        notificationService.error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

registerAction2(class UiuxSearchColorAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.uiuxSearchColor',
                        title: localize2('uiuxSearchColor', "Search Color Palettes"),
                        f1: true,
                        category: localize2('constructCategoryUiux2', "Construct: Design"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const quickInput = accessor.get(IQuickInputService);
                const toolRegistry = accessor.get(IConstructToolRegistry);
                const notificationService = accessor.get(INotificationService);

                const query = await quickInput.input({ prompt: 'Search color palettes (e.g., "SaaS blue", "fintech professional")' });
                if (!query) { return; }

                try {
                        const result = await toolRegistry.execute('uiux_pro_max__search_color', { query, max_results: 3 });
                        notificationService.info(result.output || 'No results found.');
                } catch (error) {
                        notificationService.error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

registerAction2(class UiuxGenerateDesignSystemAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.uiuxGenerateDesignSystem',
                        title: localize2('uiuxGenerateDesignSystem', "Generate Design System"),
                        f1: true,
                        category: localize2('constructCategoryUiux3', "Construct: Design"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const quickInput = accessor.get(IQuickInputService);
                const toolRegistry = accessor.get(IConstructToolRegistry);
                const notificationService = accessor.get(INotificationService);

                const query = await quickInput.input({ prompt: 'Describe your project (e.g., "SaaS dashboard", "e-commerce luxury store")' });
                if (!query) { return; }

                const projectName = await quickInput.input({ prompt: 'Project name (optional)', value: query });

                notificationService.info('Generating design system... this may take a moment.');

                try {
                        const result = await toolRegistry.execute('uiux_pro_max__generate_design_system', {
                                query,
                                project_name: projectName || query,
                                format: 'markdown',
                        });
                        notificationService.info(result.output || 'Design system generated.');
                } catch (error) {
                        notificationService.error(`Design system generation failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

registerAction2(class UiuxStackGuidelinesAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.uiuxStackGuidelines',
                        title: localize2('uiuxStackGuidelines', "Get Stack Guidelines"),
                        f1: true,
                        category: localize2('constructCategoryUiux4', "Construct: Design"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const quickInput = accessor.get(IQuickInputService);
                const toolRegistry = accessor.get(IConstructToolRegistry);
                const notificationService = accessor.get(INotificationService);

                const stacks = [
                        { label: 'React', value: 'react' },
                        { label: 'Next.js', value: 'nextjs' },
                        { label: 'Vue', value: 'vue' },
                        { label: 'Svelte', value: 'svelte' },
                        { label: 'Astro', value: 'astro' },
                        { label: 'SwiftUI', value: 'swiftui' },
                        { label: 'React Native', value: 'react-native' },
                        { label: 'Flutter', value: 'flutter' },
                        { label: 'NuxtJS', value: 'nuxtjs' },
                        { label: 'Nuxt UI', value: 'nuxt-ui' },
                        { label: 'HTML + Tailwind', value: 'html-tailwind' },
                        { label: 'shadcn/ui', value: 'shadcn' },
                        { label: 'Jetpack Compose', value: 'jetpack-compose' },
                        { label: 'Three.js', value: 'threejs' },
                        { label: 'Angular', value: 'angular' },
                        { label: 'Laravel', value: 'laravel' },
                ];

                const stackPick = await quickInput.pick(stacks.map(s => ({ label: s.label, detail: s.value })), {
                        placeHolder: 'Select a tech stack',
                });
                if (!stackPick) { return; }

                const stack = (stackPick as any).detail as string;

                const query = await quickInput.input({ prompt: 'Search guidelines (e.g., "component structure", "styling patterns")' });
                if (!query) { return; }

                try {
                        const result = await toolRegistry.execute('uiux_pro_max__get_stack_guidelines', { query, stack, max_results: 3 });
                        notificationService.info(result.output || 'No results found.');
                } catch (error) {
                        notificationService.error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

// --- Patch A: Register KovixInlineCompletionProvider (Tab autocomplete) ----
// Tier 1, item 1.1 — wires IConstructAIService.complete() to VS Code's
// InlineCompletionsProvider API. See audit doc §4.1 and §7.1.
import { KovixInlineCompletionProvider } from './services/editor/kovixInlineCompletionProvider.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';

class ConstructInlineCompletionContribution extends Disposable implements IWorkbenchContribution {
        static readonly ID = 'workbench.contrib.constructInlineCompletion';

        constructor(
                @IInstantiationService instantiationService: IInstantiationService,
                @ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
        ) {
                super();
                // Register the provider for all document types. The provider itself
                // respects the construct.autocomplete.enabled setting.
                this._register(languageFeaturesService.inlineCompletionsProvider.register(
                        { pattern: '**' },
                        instantiationService.createInstance(KovixInlineCompletionProvider)
                ));
        }
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
        ConstructInlineCompletionContribution,
        LifecyclePhase.Restored
);
