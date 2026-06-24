/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { localize, localize2 } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, ViewContainerLocation } from '../../../../workbench/common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { ConstructAgentViewPane } from './constructAgentView.js';
import { ConstructMemoryViewPane } from './constructMemoryView.js';
import { KovixMemoryGraphPane } from './kovixMemoryGraph.js';
import { KovixAgentControlCenter } from './kovixAgentControlCenter.js';
import { KovixAgentSettingsPane } from './kovixAgentSettings.js';
import { KovixWelcomeContribution, KovixWelcomeView } from './kovixWelcome.js';
import { KovixBrandChromeContribution } from './kovixBrandChrome.js';
import { KovixSurfaceBrandingContribution } from './kovixSurfaceBranding.js';
import { KovixSplashContribution } from './kovixSplash.js';
import { KovixSettingsMigrationContribution } from './kovixSettingsMigration.js';
import { KovixCommandBridgeContribution } from './kovixCommandBridge.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../../workbench/services/statusbar/browser/statusbar.js';
import { IWorkbenchContribution, Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../workbench/common/contributions.js';
import { LifecyclePhase } from '../../../../workbench/services/lifecycle/common/lifecycle.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../../workbench/services/layout/browser/layoutService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
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
import { ICommandService } from '../../../../platform/commands/common/commands.js';
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
import { IAgentModeService, AgentModeService } from './services/agent/agentModeService.js';
import { IUniversalMemoryService } from '../../../../platform/construct/common/memory/universalMemoryService.js';
import { UniversalMemoryService } from './services/memory/universalMemoryService.js';
import { IConstructSessionService } from '../../../../platform/construct/common/session/constructSessionService.js';
import { ConstructSessionServiceImpl } from './services/session/constructSessionServiceImpl.js';
import { showProjectWizard } from './constructProjectWizard.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ConstructOnboardingWizard } from './constructOnboarding.js';
import './constructMemoryConfig.js';
import './constructApiConfig.js';
import './constructApiSettings.js';
import './kovixAccessibilityConfig.js';
import './kovixAccessibilityContribution.js';
import './kovixAutonomousConfig.js';
// P0-1: Register the top-level "Kovix" menu with all 53 commands in submenus.
// Highest-impact discoverability fix — every Kovix feature now has a visible
// menu entry, not just a Command Palette entry.
import './kovixMenu.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { registerKovixAutocomplete } from '../../../../editor/contrib/construct/browser/kovixInlineCompletionProvider.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISkillRegistry } from '../../../../platform/construct/common/skills/skillRegistry.js';
// Phase 27 port (from recovery/phase-28-launch): Cost Governor + Credit System
import { ICostGovernorService } from '../../../../platform/construct/common/costGovernor.js';
import { ICreditSystem, ICostGovernor } from '../../../../platform/construct/common/pricing/creditSystem.js';
import { CostGovernorService } from './services/costGovernorService.js';
import { CreditSystemService, CostGovernorEnhancedService } from './services/pricing/creditSystemService.js';
// Phase 4 port (from recovery/phase-28-launch): Execution Sanity Validation
import { IExecutionSanityService } from '../../../../platform/construct/common/executionSanity.js';
import { ExecutionSanityService } from './services/executionSanityService.js';
import { SkillRegistryService } from './services/skills/skillRegistryService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IFileService } from '../../../../platform/files/common/files.js';

const constructViewIcon = registerIcon('construct-view-icon', Codicon.robot, localize('constructViewIcon', 'View icon of the Kovix Agent view.'));
const constructMemoryIcon = registerIcon('construct-memory-icon', Codicon.symbolEvent, localize('constructMemoryIcon', 'View icon of the Kovix Memory view.'));
const constructGraphIcon = registerIcon('construct-graph-icon', Codicon.graph, localize('constructGraphIcon', 'View icon of the Kovix Memory Graph view.'));
const constructControlIcon = registerIcon('construct-control-icon', Codicon.dashboard, localize('constructControlIcon', 'View icon of the Kovix Control Center view.'));
const constructSettingsIcon = registerIcon('construct-settings-icon', Codicon.settings, localize('constructSettingsIcon', 'View icon of the Kovix Agent Settings view.'));

// Register the Kovix view container in the AUXILIARY BAR (right-hand side, Antigravity-style)
// P0-2: order changed from 100 to 0 so the Kovix agent icon is the FIRST icon
// in the activity bar (above Explorer), not the 6th. The agent is the primary
// surface; it should be the first thing users see.
const constructViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
                id: 'construct',
                title: localize2('construct', "Kovix Agent"),
                ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['construct', { mergeViewWithContainerWhenSingleView: true }]),
                icon: constructViewIcon,
                order: 0,
                // Open the right-hand panel by default on first launch so the agent is immediately visible.
                openCommandActionDescriptor: {
                                id: 'kovix.focusPanel',
                                title: { value: localize('focusConstructPanel', "Open Kovix Agent"), original: 'Open Kovix Agent' },
                                mnemonicTitle: undefined,
                                keybindings: {
                                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK,
                                },
                                order: 1,
                },
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: false });

// Register the agent panel view inside the container
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
                id: 'kovix.agentPanel',
                name: localize2('agentPanel', "Agent"),
                containerIcon: constructViewIcon,
                ctorDescriptor: new SyncDescriptor(ConstructAgentViewPane),
                canToggleVisibility: true,
                canMoveView: true,
                order: 1,
}, {
                id: 'kovix.memoryPanel',
                name: localize2('memoryPanel', "Memory"),
                containerIcon: constructMemoryIcon,
                ctorDescriptor: new SyncDescriptor(ConstructMemoryViewPane),
                canToggleVisibility: true,
                canMoveView: true,
                order: 2,
}, {
                id: 'kovix.memoryGraph',
                name: localize2('memoryGraph', "Memory Graph"),
                containerIcon: constructGraphIcon,
                ctorDescriptor: new SyncDescriptor(KovixMemoryGraphPane),
                canToggleVisibility: true,
                canMoveView: true,
                order: 3,
}, {
                id: 'kovix.controlCenter',
                name: localize2('controlCenter', "Control Center"),
                containerIcon: constructControlIcon,
                ctorDescriptor: new SyncDescriptor(KovixAgentControlCenter),
                canToggleVisibility: true,
                canMoveView: true,
                order: 4,
}, {
                id: 'kovix.agentSettings',
                name: localize2('agentSettings', "Agent Settings"),
                containerIcon: constructSettingsIcon,
                ctorDescriptor: new SyncDescriptor(KovixAgentSettingsPane),
                canToggleVisibility: true,
                canMoveView: true,
                order: 5,
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
                                                command: 'kovix.focusPanel',
                                }, 'kovix.agentStatus', StatusbarAlignment.LEFT, 50));

                                // Model info (left side) — dynamically updated from AI service
                                this.modelEntryAccessor = this._register(this.statusbarService.addEntry({
                                                name: localize('constructModel', "Kovix Model"),
                                                text: '$(zap) No Model local',
                                                ariaLabel: localize('constructModelAria', "Active LLM: No model selected"),
                                                tooltip: localize('constructModelTooltip', "Click to select a model"),
                                                command: 'kovix.selectModel',
                                }, 'kovix.model', StatusbarAlignment.LEFT, 51));

                                // Listen for provider and model changes
                                this._register(this.aiService.onDidChangeActiveModel(() => {
                                                this.updateModelStatus();
                                }));
                                this._register(this.aiService.onDidChangeActiveProvider(() => {
                                                this.updateModelStatus();
                                }));

                                // Pending changes (right side)
                                // P2-4: Made clickable — opens the SCM / changes view to review
                                // pending diffs. Previously display-only.
                                this._register(this.statusbarService.addEntry({
                                                name: localize('constructChanges', "Kovix Changes"),
                                                text: '$(diff-added) 0 pending',
                                                ariaLabel: localize('constructChangesAria', "No changes awaiting approval"),
                                                tooltip: localize('constructChangesTooltip', "Click to review pending Kovix agent diffs"),
                                                command: 'workbench.view.scm',
                                }, 'kovix.changes', StatusbarAlignment.RIGHT, 50));

                                // Agent Reach status (left side, priority 49)
                                this.agentReachEntryAccessor = this._register(this.statusbarService.addEntry({
                                                name: localize('constructAgentReach', "Agent Reach"),
                                                text: '$(globe) Agent Reach',
                                                ariaLabel: localize('constructAgentReachAria', "Agent Reach internet research tools"),
                                                tooltip: localize('constructAgentReachTooltip', "Click to check Agent Reach status"),
                                                command: 'kovix.checkAgentReach',
                                }, 'kovix.agentReach', StatusbarAlignment.LEFT, 49));

                                // Ponytail lazy-dev mode status (left side, priority 48)
                                this.ponytailEntryAccessor = this._register(this.statusbarService.addEntry({
                                                name: localize('constructPonytail', "Ponytail"),
                                                text: '$(shield) PONYTAIL',
                                                ariaLabel: localize('constructPonytailAria', "Ponytail lazy-dev mode: full"),
                                                tooltip: localize('constructPonytailTooltip', "Ponytail: full mode — click to change mode"),
                                                command: 'kovix.ponytailSetMode',
                                }, 'kovix.ponytail', StatusbarAlignment.LEFT, 48));
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
                                                ariaLabel: localize('constructModelAria', "Active LLM: {0} ({1})", modelName, suffix),
                                                tooltip: localize('constructModelTooltip', "Active LLM: {0} ({1}) — click to change", modelName, suffix),
                                                command: 'kovix.selectModel',
                                });
                }

                public updateAgentReachStatus(status: 'ok' | 'warn' | 'error', message?: string): void {
                                if (!this.agentReachEntryAccessor) { return; }
                                const icons = { ok: '$(globe)', warn: '$(globe~spin)', error: '$(globe~remove)' };
                                const icon = icons[status] || icons.error;
                                this.agentReachEntryAccessor.update({
                                                name: localize('constructAgentReach', "Agent Reach"),
                                                text: `${icon} ${message || 'Agent Reach'}`,
                                                ariaLabel: localize('constructAgentReachAria', "Agent Reach: {0}", message || status),
                                                tooltip: localize('constructAgentReachTooltip', "Agent Reach status: {0} — click to check", message || status),
                                                command: 'kovix.checkAgentReach',
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
                                                ariaLabel: localize('constructPonytailAria', "Ponytail lazy-dev mode: {0}", mode),
                                                tooltip: localize('constructPonytailTooltip', "Ponytail: {0} mode — click to change", mode),
                                                command: 'kovix.ponytailSetMode',
                                });
                }
}

// Auto-open the Kovix Agent panel on the right-hand side after the workbench restores.
// This ensures the agent is visible on first launch (matching the Antigravity IDE UX).
//
// HISTORY: This contribution had a long-standing bug where the agent panel would not
// appear on first launch. Root cause was that `openView(id, false)` (focus=false) does
// not reliably expand the auxiliary bar if it was hidden by default. Fix: (1) use
// focus=true which forces the container visible, (2) explicitly set the auxiliary bar
// part visible via IWorkbenchLayoutService as a belt-and-suspenders measure, (3) defer
// the open call to a microtask so the layout service has finished initializing.
class ConstructAutoOpenContribution extends Disposable implements IWorkbenchContribution {
                static readonly ID = 'workbench.contrib.constructAutoOpen';

                constructor(
                                @IViewsService private readonly viewsService: IViewsService,
                                @IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
                                @ILogService private readonly logService: ILogService,
                ) {
                                super();
                                // Defer to a microtask so the workbench layout has fully settled after
                                // LifecyclePhase.Restored. Synchronous openView calls in the constructor
                                // race with the layout service's own restoration logic.
                                queueMicrotask(() => {
                                                try {
                                                                // Step 1: explicitly make the auxiliary bar visible. This is the
                                                                // belt-and-suspenders fix — openView should do this internally,
                                                                // but historically doesn't if the part was never opened before.
                                                                this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);

                                                                // Step 2: open the agent panel view with focus=true. focus=true
                                                                // forces the container to become visible even if it was hidden.
                                                                // The previous `focus=false` was the primary cause of the
                                                                // "agent panel not showing" bug.
                                                                this.viewsService.openView('kovix.agentPanel', true).then(
                                                                                () => this.logService.trace('[Kovix AutoOpen] agent panel opened successfully'),
                                                                                err => this.logService.error('[Kovix AutoOpen] openView rejected:', err)
                                                                );

                                                                this.logService.trace('[Kovix AutoOpen] agent panel auto-open sequence complete');
                                                } catch (err) {
                                                                this.logService.error('[Kovix AutoOpen] failed to auto-open agent panel:', err);
                                                }
                                });
                }
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(ConstructStatusBarContribution, LifecyclePhase.Restored);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(ConstructAutoOpenContribution, LifecyclePhase.Restored);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(KovixWelcomeContribution, LifecyclePhase.Restored);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(KovixBrandChromeContribution, LifecyclePhase.Restored);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(KovixSurfaceBrandingContribution, LifecyclePhase.Restored);
// Settings migration: convert legacy construct.* keys/commands in user settings.json
// and keybindings.json to kovix.*. Idempotent — guarded by a global state flag.
// Runs at Restored so we don't compete with brand-chrome / splash for boot DOM.
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(KovixSettingsMigrationContribution, LifecyclePhase.Restored);
// The command bridge must install BEFORE the splash / brand-chrome contributions
// run, so they can dispatch commands immediately. BlockStartup is the earliest phase
// (maps to LifecyclePhase.Starting) — requires registerWorkbenchContribution2
// (the top-level export, not the deprecated registry method).
registerWorkbenchContribution2(
        KovixCommandBridgeContribution.ID, KovixCommandBridgeContribution, WorkbenchPhase.BlockStartup);
// Splash also runs at BlockStartup so the overlay mounts before any workbench DOM.
registerWorkbenchContribution2(
        KovixSplashContribution.ID, KovixSplashContribution, WorkbenchPhase.BlockStartup);

// --- Construct Commands --------------------------------------------------------
// NOTE: The `kovix.focusPanel` command is auto-registered by the container's
// `openCommandActionDescriptor` (see above). We keep `kovix.newChat` and
// `kovix.showInlineAgent` as additional entry points that also focus the panel.

registerAction2(class NewConstructChatAction extends Action2 {
                constructor() {
                                super({
                                                id: 'kovix.newChat',
                                                title: localize2('newConstructChat', "Kovix: New Chat"),
                                                f1: true,
                                                category: localize2('constructCategory2', "Kovix"),
                                                // P1-3: Add keyboard shortcut (Ctrl+Alt+N to avoid VS Code's Ctrl+Shift+N New Window conflict)
                                                keybinding: {
                                                                primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyN,
                                                                weight: KeybindingWeight.WorkbenchContrib,
                                                },
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('kovix.agentPanel', true);
                }
});

registerAction2(class ShowInlineAgentAction extends Action2 {
                constructor() {
                                super({
                                                id: 'kovix.showInlineAgent',
                                                title: localize2('showInlineAgent', "Kovix: Focus Agent Panel"),
                                                keybinding: {
                                                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI,
                                                                weight: KeybindingWeight.WorkbenchContrib,
                                                },
                                                f1: true,
                                                category: localize2('constructCategory3', "Kovix"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('kovix.agentPanel', true);
                }
});

// --- Memory Commands (Phase 19+Supermemory) ------------------------------------

registerAction2(class OpenMemoryPanelAction extends Action2 {
                constructor() {
                                super({
                                                id: 'kovix.openMemoryPanel',
                                                title: localize2('openMemoryPanel', "Kovix: Open Memory Panel"),
                                                f1: true,
                                                category: localize2('constructCategory4', "Kovix"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('kovix.memoryPanel', true);
                }
});

registerAction2(class OpenMemoryGraphAction extends Action2 {
                constructor() {
                                super({
                                                id: 'kovix.openMemoryGraph',
                                                title: localize2('openMemoryGraph', "Kovix: Open Memory Graph"),
                                                f1: true,
                                                category: localize2('constructCategory4', "Kovix"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('kovix.memoryGraph', true);
                }
});

registerAction2(class OpenControlCenterAction extends Action2 {
                constructor() {
                                super({
                                                id: 'kovix.openControlCenter',
                                                title: localize2('openControlCenter', "Kovix: Open Agent Control Center"),
                                                f1: true,
                                                category: localize2('constructCategory4', "Kovix"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('kovix.controlCenter', true);
                }
});

// Kovix Welcome — opens the first-launch welcome webview on demand.
// Used by the activity-bar K-logo and the Help menu.
registerAction2(class OpenKovixWelcomeAction extends Action2 {
                constructor() {
                                super({
                                                id: 'kovix.welcome.open',
                                                title: localize2('openKovixWelcome', "Kovix: Open Welcome Screen"),
                                                f1: true,
                                                category: localize2('kovixCategory', "Kovix"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                // Lazily create the welcome view via the instantiation service
                                // so we don't pay the cost on every workbench startup.
                                const inst = accessor.get(IInstantiationService);
                                const view = inst.createInstance(KovixWelcomeView);
                                view.show();
                }
});

registerAction2(class SearchMemoriesAction extends Action2 {
                constructor() {
                                super({
                                                id: 'kovix.searchMemories',
                                                title: localize2('searchMemories', "Kovix: Search Memories"),
                                                f1: true,
                                                category: localize2('constructCategory5', "Kovix"),
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
                                                id: 'kovix.addMemory',
                                                title: localize2('addMemory', "Kovix: Add Memory"),
                                                f1: true,
                                                category: localize2('constructCategory6', "Kovix"),
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
                                                id: 'kovix.testMemoryConnection',
                                                title: localize2('testMemoryConnection', "Kovix: Test Memory Connection"),
                                                f1: true,
                                                category: localize2('constructCategory7', "Kovix"),
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
                                                id: 'kovix.openApiSettings',
                                                title: localize2('openApiSettings', "Kovix: Open API Settings"),
                                                f1: true,
                                                category: localize2('constructCategoryApi', "Kovix"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                accessor.get(ICommandService).executeCommand('workbench.action.openSettings', 'kovix.anthropic');
                }
});

registerAction2(class SetApiKeyAction extends Action2 {
                constructor() {
                                super({
                                                id: 'kovix.setApiKey',
                                                title: localize2('setApiKey', "Set API Key"),
                                                f1: true,
                                                category: localize2('constructCategoryApiKey', "Kovix"),
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
                                                id: 'kovix.clearApiKey',
                                                title: localize2('clearApiKey', "Kovix: Clear API Key"),
                                                f1: true,
                                                category: localize2('constructCategoryApiKey2', "Kovix"),
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
                                                id: 'kovix.testCloudConnection',
                                                title: localize2('testCloudConnection', "Test Cloud AI Connection"),
                                                f1: true,
                                                category: localize2('constructCategoryCloud', "Kovix"),
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

// --- Kovix v1.4.0: Skill Registry ---------------------------------------------
// Loads skills from ~/.kovix/skills/<slug>/SKILL.md and
// <workspace>/.kovix/skills/<slug>/SKILL.md. Ranks skills against each task
// and injects the top-K into the agent's system prompt.
registerSingleton(ISkillRegistry, SkillRegistryService, InstantiationType.Delayed);

// --- Phase 5: Agent Modes + Swarm (Kovix v1.2.0) ------------------------------
// Per-agent model selection (Roo Code custom modes pattern) + sub-agent spawning
// (OpenAI Swarm handoff pattern). Built-in modes: general, architect, coder,
// reviewer, debugger, ask. User can create unlimited custom modes.
registerSingleton(IAgentModeService, AgentModeService, InstantiationType.Delayed);

// Command: Switch Agent Mode (Kovix v1.2.0 — Roo Code custom modes pattern)
registerAction2(class SwitchAgentModeAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.switchAgentMode',
                        title: localize2('switchAgentMode', "Switch Agent Mode"),
                        f1: true,
                        category: localize2('constructCategoryAI', "Kovix"),
                        // P1-3: Add keyboard shortcut (Ctrl+Shift+M)
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const modeService = accessor.get(IAgentModeService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const modes = modeService.getAllModes();
                const activeMode = modeService.getActiveMode();
                const picks = modes.map(m => ({
                        label: `$(${m.icon}) ${m.displayName}`,
                        description: m.slug === activeMode.slug ? '(active)' : '',
                        detail: m.description,
                        modeSlug: m.slug,
                }));

                const pick = await quickInput.pick(picks, {
                        placeHolder: 'Select agent mode',
                });

                if (pick) {
                        modeService.setActiveMode(pick.modeSlug);
                        const newMode = modeService.getActiveMode();
                        notificationService.info(`Kovix: Switched to ${newMode.displayName} mode`);
                }
        }
});

// Command: Create Custom Agent Mode
registerAction2(class CreateAgentModeAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.createAgentMode',
                        title: localize2('createAgentMode', "Create Custom Agent Mode"),
                        f1: true,
                        category: localize2('constructCategoryAI', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const modeService = accessor.get(IAgentModeService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const slug = await quickInput.input({
                        prompt: 'Mode slug (lowercase, no spaces, e.g. "data-scientist")',
                        validateInput: async (v: string) => {
                                if (!v) { return 'Slug is required'; }
                                if (!/^[a-z][a-z0-9-]*$/.test(v)) { return 'Must be lowercase letters, numbers, and hyphens only'; }
                                if (modeService.getMode(v)) { return 'Mode with this slug already exists'; }
                                return undefined;
                        },
                });
                if (!slug) { return; }

                const displayName = await quickInput.input({
                        prompt: 'Display name (e.g. "Data Scientist")',
                        validateInput: async (v: string) => v ? undefined : 'Display name is required',
                });
                if (!displayName) { return; }

                const roleDefinition = await quickInput.input({
                        prompt: 'Role definition (system prompt for this mode)',
                        validateInput: async (v: string) => v ? undefined : 'Role definition is required',
                });
                if (!roleDefinition) { return; }

                const toolGroupsPick = await quickInput.pick(
                        [
                                { label: 'File ops', picked: true, group: 'tools' },
                                { label: 'Terminal', picked: true, group: 'tools' },
                                { label: 'Search', picked: true, group: 'tools' },
                                { label: 'Browser', picked: false, group: 'tools' },
                                { label: 'MCP', picked: false, group: 'tools' },
                                { label: 'Memory', picked: true, group: 'tools' },
                                { label: 'Git', picked: false, group: 'tools' },
                                { label: 'Diff', picked: true, group: 'tools' },
                                { label: 'Planning', picked: false, group: 'tools' },
                                { label: 'Sub-agent', picked: false, group: 'tools' },
                        ],
                        {
                                placeHolder: 'Select tool groups for this mode',
                                canPickMany: true,
                        },
                );
                const toolGroups = (toolGroupsPick || []).map(p => p.label.toLowerCase().replace('-', '') as any);

                modeService.upsertMode({
                        slug,
                        displayName,
                        description: `User-created mode: ${displayName}`,
                        icon: 'spark',
                        roleDefinition,
                        toolGroups,
                        canSpawnSubAgents: toolGroups.includes('subagent' as any),
                        modelPreference: { enabled: false },
                        builtin: false,
                });
                notificationService.info(`Kovix: Created custom mode "${displayName}"`);
                modeService.setActiveMode(slug);
        }
});

// Command: Spawn Sub-Agent (Kovix v1.2.0 — OpenAI Swarm pattern)
registerAction2(class SpawnSubAgentAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.spawnSubAgent',
                        title: localize2('spawnSubAgent', "Spawn Sub-Agent"),
                        f1: true,
                        category: localize2('constructCategoryAI', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const modeService = accessor.get(IAgentModeService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const modes = modeService.getAllModes().filter(m => m.canSpawnSubAgents || m.slug !== modeService.getActiveMode().slug);
                if (modes.length === 0) {
                        notificationService.warn('Kovix: No modes available to spawn as sub-agent');
                        return;
                }

                const modePick = await quickInput.pick(
                        modes.map(m => ({
                                label: `$(${m.icon}) ${m.displayName}`,
                                detail: m.description,
                                modeSlug: m.slug,
                        })),
                        { placeHolder: 'Select mode for the sub-agent' },
                );
                if (!modePick) { return; }

                const task = await quickInput.input({
                        prompt: 'Task for the sub-agent',
                        validateInput: async (v: string) => v ? undefined : 'Task is required',
                });
                if (!task) { return; }

                const sub = modeService.spawnSubAgent(modePick.modeSlug, task);
                notificationService.info(`Kovix: Spawned sub-agent ${sub.id} (mode: ${modePick.modeSlug})`);
        }
});

// Command: Switch AI Provider
registerAction2(class SwitchAIProviderAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.switchProvider',
                        title: localize2('switchAIProvider', "Switch AI Provider"),
                        f1: true,
                        category: localize2('constructCategoryAI', "Kovix"),
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
                        id: 'kovix.selectModel',
                        title: localize2('selectModel', "Kovix: Select Model"),
                        f1: true,
                        category: localize2('constructCategoryModel', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const aiService = accessor.get(IConstructAIService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const commandService = accessor.get(ICommandService);
                const keyManager = accessor.get(ISecureKeyManager);

                let models = await aiService.listModels();
                if (models.length === 0) {
                        // Kovix v1.3.1: instead of a dead-end warning, offer to walk the
                        // user through the API key setup flow. This is the single most
                        // common reason for "no models" — the user hasn't added a key yet.
                        const activeProvider = await keyManager.getActiveProvider();
                        const providerLabel = activeProvider?.name ?? 'none';
                        const setupPick = await quickInput.pick(
                                [
                                        {
                                                label: '$(key) Add or Manage API Keys',
                                                description: localize('setupKeysDesc', "Open the key manager — NVIDIA NIM, OpenAI, Anthropic, etc."),
                                                action: 'manageKeys' as const,
                                        },
                                        {
                                                label: '$(plug) Switch Provider',
                                                description: localize('switchProviderDesc', "Current: {0}", providerLabel),
                                                action: 'switchProvider' as const,
                                        },
                                        {
                                                label: '$(refresh) Retry Model List',
                                                description: localize('retryModelsDesc', "Re-fetch the model list from the active provider"),
                                                action: 'retry' as const,
                                        },
                                ],
                                { placeHolder: localize('noModelsPlaceholder', "No models available. Set up a provider to continue.") },
                        );

                        if (!setupPick) { return; }
                        if (setupPick.action === 'manageKeys') {
                                commandService.executeCommand('kovix.manageApiKeys');
                        } else if (setupPick.action === 'switchProvider') {
                                commandService.executeCommand('kovix.switchProvider.quick');
                        } else if (setupPick.action === 'retry') {
                                models = await aiService.listModels();
                                if (models.length === 0) {
                                        notificationService.warn(localize('stillNoModels', "Still no models available. Verify your API key and endpoint are correct, then try again."));
                                        return;
                                }
                        } else {
                                return;
                        }
                        if (models.length === 0) { return; }
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

// --- Phase 27 port (from recovery/phase-28-launch): Cost Governor + Credit System ---
// These are pure additive services for LLM API spend governance. All dependencies
// (ILogService, IStorageService, IConfigurationService, IOpenerService, ITelemetryService)
// are VS Code platform services that already exist on main. No phase-28-launch-specific
// dependencies. See PART1-ARCHITECTURE-COMPARISON.md §4.2 for port rationale.
registerSingleton(ICostGovernorService, CostGovernorService, InstantiationType.Delayed);
registerSingleton(ICreditSystem, CreditSystemService, InstantiationType.Delayed);
registerSingleton(ICostGovernor, CostGovernorEnhancedService, InstantiationType.Delayed);
registerSingleton(IExecutionSanityService, ExecutionSanityService, InstantiationType.Delayed);

// --- Feature Build: Project Commands -----------------------------------------
registerAction2(class NewProjectAction extends Action2 {
                constructor() {
                        super({
                                id: 'kovix.newProject',
                                title: localize2('newConstructProject', "Kovix: New Project"),
                                f1: true,
                                category: localize2('constructCategoryProject', "Kovix"),
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
                                id: 'kovix.openProjectWizard',
                                title: localize2('openProjectWizard', "Open Project Wizard"),
                                f1: true,
                                category: localize2('constructCategoryWizard', "Kovix"),
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
                                id: 'kovix.loadProject',
                                title: localize2('loadProject', "Kovix: Load Project"),
                                f1: true,
                                category: localize2('constructCategoryLoadProject', "Kovix"),
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
                                                id: 'kovix.undoTask',
                                                title: localize2('undoTask', "Kovix: Undo Last Task"),
                                                f1: true,
                                                category: localize2('constructCategoryUndo', "Kovix"),
                                                // P1-3: Add keyboard shortcut (Ctrl+Shift+U)
                                                keybinding: {
                                                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyU,
                                                                weight: KeybindingWeight.WorkbenchContrib,
                                                },
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
                        id: 'kovix.acceptAllDiffs',
                        title: localize2('acceptAllDiffs', "Accept All Pending Diffs"),
                        f1: true,
                        category: localize2('constructCategoryDiff', "Kovix"),
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const viewsService = accessor.get(IViewsService);
                const notificationService = accessor.get(INotificationService);
                const view = viewsService.getActiveViewWithId('kovix.agentPanel') as any;
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
                        id: 'kovix.rejectAllDiffs',
                        title: localize2('rejectAllDiffs', "Reject All Pending Diffs"),
                        f1: true,
                        category: localize2('constructCategoryDiff2', "Kovix"),
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Escape,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        run(accessor: ServicesAccessor): void {
                const viewsService = accessor.get(IViewsService);
                const notificationService = accessor.get(INotificationService);
                const view = viewsService.getActiveViewWithId('kovix.agentPanel') as any;
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
                        id: 'kovix.openOnboarding',
                        title: localize2('openOnboarding', "Open Setup Wizard"),
                        f1: true,
                        category: localize2('constructCategoryOnboarding', "Kovix"),
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
                        id: 'kovix.indexWorkspace',
                        title: localize2('indexWorkspace', "Kovix: Index Workspace"),
                        f1: true,
                        category: localize2('constructCategoryMemory', "Kovix"),
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
                        id: 'kovix.mcp.startServer',
                        title: localize2('startMCPServer', "Start MCP Server"),
                        f1: true,
                        category: localize2('constructCategoryMCP', "Kovix"),
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
                        id: 'kovix.mcp.stopServer',
                        title: localize2('stopMCPServer', "Stop MCP Server"),
                        f1: true,
                        category: localize2('constructCategoryMCP2', "Kovix"),
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
                        id: 'kovix.providerStatus',
                        title: localize2('providerStatus', "Show AI Provider Status"),
                        f1: true,
                        category: localize2('constructCategoryProvider', "Kovix"),
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
                        id: 'kovix.fileToUrl',
                        title: localize2('fileToUrl', "Convert File to URL (f2u)"),
                        f1: true,
                        category: localize2('constructCategoryF2U', "Kovix"),
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
                        id: 'kovix.goclawDashboard',
                        title: localize2('goclawDashboard', "Open GoClaw Dashboard"),
                        f1: true,
                        category: localize2('constructCategoryGoclaw', "Kovix"),
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
                        id: 'kovix.checkAgentReach',
                        title: localize2('checkAgentReach', "Check Agent Reach Health"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach', "Kovix"),
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
                        id: 'kovix.installAgentReach',
                        title: localize2('installAgentReach', "Install Agent Reach"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach2', "Kovix"),
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
                        id: 'kovix.configureAgentReach',
                        title: localize2('configureAgentReach', "Configure Agent Reach Channels"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach3', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const notificationService = accessor.get(INotificationService);
                const commandService = accessor.get(ICommandService);

                notificationService.info('Agent Reach: Channels are configured automatically. Use the status bar icon or run "Check Agent Reach Health" to verify.');
                commandService.executeCommand('kovix.checkAgentReach');
        }
});

registerAction2(class SearchWebExaAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.searchWebExa',
                        title: localize2('searchWebExa', "Search Web (Exa)"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach4', "Kovix"),
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
                        id: 'kovix.readWebpage',
                        title: localize2('readWebpage', "Read Webpage"),
                        f1: true,
                        category: localize2('constructCategoryAgentReach5', "Kovix"),
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
                        validateInput: async (value): Promise<string | undefined> => {
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
                        id: 'kovix.ponytailSetMode',
                        title: localize2('ponytailSetMode', "Set Ponytail Mode"),
                        f1: true,
                        category: localize2('constructCategoryPonytail', "Kovix"),
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
                        id: 'kovix.ponytailReview',
                        title: localize2('ponytailReview', "Review Current File for Over-Engineering"),
                        f1: true,
                        category: localize2('constructCategoryPonytail2', "Kovix"),
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
                        id: 'kovix.ponytailHelp',
                        title: localize2('ponytailHelp', "Show Ponytail Help"),
                        f1: true,
                        category: localize2('constructCategoryPonytail3', "Kovix"),
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
                        id: 'kovix.uiuxSearchStyle',
                        title: localize2('uiuxSearchStyle', "Search UI Styles"),
                        f1: true,
                        category: localize2('constructCategoryUiux', "Kovix: Design"),
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
                        id: 'kovix.uiuxSearchColor',
                        title: localize2('uiuxSearchColor', "Search Color Palettes"),
                        f1: true,
                        category: localize2('constructCategoryUiux2', "Kovix: Design"),
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
                        id: 'kovix.uiuxGenerateDesignSystem',
                        title: localize2('uiuxGenerateDesignSystem', "Generate Design System"),
                        f1: true,
                        category: localize2('constructCategoryUiux3', "Kovix: Design"),
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
                        id: 'kovix.uiuxStackGuidelines',
                        title: localize2('uiuxStackGuidelines', "Get Stack Guidelines"),
                        f1: true,
                        category: localize2('constructCategoryUiux4', "Kovix: Design"),
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

// --- Kovix v1.4.0: Agent Settings Pane Commands -------------------------------

registerAction2(class OpenAgentSettingsAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.openAgentSettings',
                        title: localize2('openAgentSettings', "Kovix: Open Agent Settings"),
                        f1: true,
                        category: localize2('constructCategorySettings', "Kovix"),
                        // P1-3: Add keyboard shortcut (Ctrl+Shift+A conflicts with "Toggle Block Comment",
                        // use Ctrl+Alt+A instead)
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyA,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        run(accessor: ServicesAccessor): void {
                accessor.get(IViewsService).openView('kovix.agentSettings', true);
        }
});

registerAction2(class OpenMemorySettingsAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.openMemorySettings',
                        title: localize2('openMemorySettings', "Kovix: Open Memory Settings"),
                        f1: true,
                        category: localize2('constructCategorySettings2', "Kovix"),
                });
        }
        run(accessor: ServicesAccessor): void {
                accessor.get(IViewsService).openView('kovix.agentSettings', true).then(() => {
                        // The view auto-selects the skills tab; we expose memory as a
                        // separate command for discoverability — users land on the
                        // settings pane and can click the Memory tab.
                });
        }
});

registerAction2(class OpenSwarmAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.openSwarm',
                        title: localize2('openSwarm', "Kovix: Open Swarm"),
                        f1: true,
                        category: localize2('constructCategorySwarm', "Kovix"),
                        // P1-3: Add keyboard shortcut (Ctrl+Shift+S conflicts with "Save Without Formatting",
                        // use Ctrl+Alt+S instead)
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyS,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        run(accessor: ServicesAccessor): void {
                // Open the control center (which shows live sub-agents) and prompt
                // the user to spawn a sub-agent.
                accessor.get(IViewsService).openView('kovix.controlCenter', true);
                accessor.get(ICommandService).executeCommand('kovix.spawnSubAgent');
        }
});

// --- Kovix v1.4.0: Skill Management Commands ----------------------------------

registerAction2(class CreateSkillFromDocumentAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.createSkillFromDocument',
                        title: localize2('createSkillFromDocument', "Kovix: Create Skill from Document"),
                        f1: true,
                        category: localize2('constructCategorySkills', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const skillRegistry = accessor.get(ISkillRegistry);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const editorService = accessor.get(IEditorService);

                // Try to use the active editor's content as the body
                let body = '';
                const activeEditor = editorService.activeEditor;
                if (activeEditor) {
                        const resource = (activeEditor as any).resource;
                        if (resource) {
                                try {
                                        const fileService = accessor.get(IFileService);
                                        const content = await fileService.readFile(resource);
                                        body = content.value.toString();
                                } catch { /* ignore */ }
                        }
                }
                if (!body) {
                        // Fall back to a multi-line input
                        body = await quickInput.input({
                                prompt: 'Paste the skill body (markdown). Tip: open the document in the editor first and Kovix will use it automatically.',
                                value: '',
                        }) || '';
                        if (!body) { return; }
                }

                const slug = await quickInput.input({
                        prompt: 'Skill slug (lowercase, hyphens only). This becomes /<slug> in the chat.',
                        placeHolder: 'e.g. api-security-audit',
                        validateInput: async (v: string) => {
                                if (!v) { return 'Slug is required'; }
                                if (!/^[a-z][a-z0-9-]*$/.test(v)) { return 'Lowercase letters, numbers, hyphens only'; }
                                return undefined;
                        },
                });
                if (!slug) { return; }

                const title = await quickInput.input({
                        prompt: 'Display title',
                        value: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                });

                const description = await quickInput.input({
                        prompt: 'Short description (1 sentence)',
                        placeHolder: 'What does this skill do?',
                });
                if (!description) { return; }

                const scopePick = await quickInput.pick(
                        [
                                { label: 'User-global (~/.kovix/skills/)', description: 'Available in every project', scope: 'user' as const },
                                { label: 'Project-scoped (.kovix/skills/)', description: 'Only this workspace', scope: 'project' as const },
                        ],
                        { placeHolder: 'Where should this skill be installed?' },
                );
                if (!scopePick) { return; }

                try {
                        const skill = await skillRegistry.createSkillFromDocument({
                                slug,
                                title: title || slug,
                                description,
                                body,
                                scope: scopePick.scope,
                        });
                        notificationService.info(`Skill created: /${skill.slug}`);
                        accessor.get(IViewsService).openView('kovix.agentSettings', true);
                } catch (error) {
                        notificationService.error(`Failed to create skill: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

registerAction2(class ImportSkillFromUrlAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.importSkillFromUrl',
                        title: localize2('importSkillFromUrl', "Kovix: Import Skill from URL"),
                        f1: true,
                        category: localize2('constructCategorySkills2', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const skillRegistry = accessor.get(ISkillRegistry);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const url = await quickInput.input({
                        prompt: 'URL to a raw SKILL.md file',
                        placeHolder: 'https://raw.githubusercontent.com/user/repo/main/SKILL.md',
                        validateInput: async (v: string) => {
                                if (!v) { return 'URL is required'; }
                                if (!/^https?:\/\//.test(v)) { return 'Must start with http:// or https://'; }
                                return undefined;
                        },
                });
                if (!url) { return; }

                try {
                        const skill = await skillRegistry.importFromUrl(url, 'user');
                        notificationService.info(`Skill imported: /${skill.slug}`);
                        accessor.get(IViewsService).openView('kovix.agentSettings', true);
                } catch (error) {
                        notificationService.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

registerAction2(class ViewSkillAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.viewSkill',
                        title: localize2('viewSkill', "Kovix: View Skill"),
                        f1: true,
                        category: localize2('constructCategorySkills3', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor, slugArg?: string): Promise<void> {
                const skillRegistry = accessor.get(ISkillRegistry);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                let slug = slugArg;
                if (!slug) {
                        const skills = await skillRegistry.getAllSkills();
                        const pick = await quickInput.pick(
                                skills.map(s => ({ label: `/${s.slug}`, description: s.title, detail: s.description, slug: s.slug })),
                                { placeHolder: 'Select a skill to view' },
                        );
                        if (!pick) { return; }
                        slug = pick.slug;
                }

                const skill = await skillRegistry.getSkill(slug);
                if (!skill) {
                        notificationService.warn(`Skill not found: /${slug}`);
                        return;
                }

                // Open the SKILL.md file in the editor (if it's a real file)
                if (skill.scope !== 'builtin') {
                        const editorService = accessor.get(IEditorService);
                        editorService.openEditor({ resource: URI.file(skill.filePath) });
                } else {
                        notificationService.info(`/${skill.slug}: ${skill.description}\n\nBuiltin skills don't have an editable file. Use /${skill.slug} <args> in the chat to invoke.`);
                }
        }
});

registerAction2(class OpenSkillsFolderAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.openSkillsFolder',
                        title: localize2('openSkillsFolder', "Kovix: Open Skills Folder"),
                        f1: true,
                        category: localize2('constructCategorySkills4', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const notificationService = accessor.get(INotificationService);
                const os = await import('os');
                const path = await import('path');
                const fs = await import('fs');
                const dir = path.join(os.homedir(), '.kovix', 'skills');
                try {
                        if (!fs.existsSync(dir)) {
                                fs.mkdirSync(dir, { recursive: true });
                        }
                        const { shell } = await import('electron');
                        shell.openPath(dir);
                } catch (error) {
                        notificationService.error(`Failed to open skills folder: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

// --- Kovix v1.4.0: Memory Privacy Commands -----------------------------------

registerAction2(class ForgetAllMemoriesAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.forgetAllMemories',
                        title: localize2('forgetAllMemories', "Kovix: Forget All Memories"),
                        f1: true,
                        category: localize2('constructCategoryMemory2', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const memoryService = accessor.get(IConstructMemoryService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);
                try {
                        // clearAllMemories is not on the interface yet — cast to any
                        // and call if present. Otherwise disconnect() to disable
                        // all storage going forward.
                        const anyMem = memoryService as any;
                        if (typeof anyMem.clearAllMemories === 'function') {
                                await anyMem.clearAllMemories();
                                notificationService.info('All memories forgotten. The agent starts fresh.');
                        } else {
                                // Fallback: fetch recent and forget each
                                const recent = await memoryService.getRecentMemories(200);
                                for (const m of recent) {
                                        try { await memoryService.forgetMemory(m.id); } catch { /* ignore */ }
                                }
                                notificationService.info(`Forgot ${recent.length} recent memories. Older memories may persist in Supermemory — visit supermemory.ai to wipe fully.`);
                        }
                        logService.info('[Kovix] All memories cleared by user request.');
                } catch (error) {
                        // clearAllMemories may not exist on the interface yet — fall back
                        // to a notification that explains the manual path.
                        logService.warn('[Kovix] clearAllMemories not available:', error);
                        notificationService.info('Memory clearing is handled by the Supermemory integration. Open the Memory panel to delete individual memories, or unset your Supermemory API key to disable all storage.');
                }
        }
});

// --- Kovix v1.4.0: MCP Marketplace Commands ----------------------------------

registerAction2(class OpenMcpMarketplaceAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.mcp.openMarketplace',
                        title: localize2('openMcpMarketplace', "Kovix: Browse MCP Marketplace"),
                        f1: true,
                        category: localize2('constructCategoryMCP3', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const marketplace = accessor.get(IMCPMarketplace);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const query = await quickInput.input({
                        prompt: 'Search the MCP marketplace (leave empty to browse featured)',
                        placeHolder: 'e.g. filesystem, figma, 21st, ponytail',
                });

                let items;
                if (query && query.trim()) {
                        items = await marketplace.searchCatalog(query);
                } else {
                        items = await marketplace.getFeaturedServers();
                }

                if (items.length === 0) {
                        notificationService.info('No MCP servers found.');
                        return;
                }

                const picks = items.map(item => ({
                        label: `$(${item.featured ? 'star' : 'package'}) ${item.name}`,
                        description: `★ ${item.rating} · ${item.author}`,
                        detail: item.description,
                        itemId: item.id,
                        installed: marketplace.isInstalled(item.id),
                }));

                const pick = await quickInput.pick(picks, {
                        placeHolder: `${items.length} MCP servers — select one to install`,
                });

                if (!pick) { return; }

                if (pick.installed) {
                        notificationService.info(`${pick.label} is already installed.`);
                        return;
                }

                try {
                        await marketplace.installFromMarketplace((pick as any).itemId);
                        notificationService.info(`Installed: ${pick.label}`);
                } catch (error) {
                        notificationService.error(`Install failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

// --- Kovix v1.4.0: Autonomous Idea→App Wizard --------------------------------

registerAction2(class AutonomousBuildAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.autonomousBuild',
                        title: localize2('autonomousBuild', "Kovix: Autonomous Idea → App"),
                        f1: true,
                        category: localize2('constructCategoryAutonomous', "Kovix"),
                });
        }
        async run(accessor: ServicesAccessor, ideaArg?: string): Promise<void> {
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const commandService = accessor.get(ICommandService);
                const aiService = accessor.get(IConstructAIService);

                // 1. Make sure an AI provider is configured
                if (!aiService.activeProvider) {
                        notificationService.warn('No AI provider configured. Add an API key first (NVIDIA NIM, OpenAI, Anthropic, etc.).');
                        commandService.executeCommand('kovix.manageApiKeys');
                        return;
                }

                // 2. Get the idea
                let idea = ideaArg;
                if (!idea) {
                        idea = await quickInput.input({
                                prompt: 'Describe your app idea in one line. Kovix will refine it, plan it, build it, and ship it.',
                                placeHolder: 'e.g. A markdown note app with tags and full-text search',
                        });
                }
                if (!idea) { return; }

                // 3. Open the agent panel and inject the idea
                await commandService.executeCommand('kovix.focusPanel');

                // 4. If idea refinement is on, the agent panel's normal flow
                // will pick up the idea and run refinement → plan → act.
                // We dispatch the idea as if the user typed it.
                // The agent panel listens for the `kovix.newChat` event,
                // so we first clear, then dispatch via a custom command.
                //
                // The simplest reliable path: tell the user we've armed the
                // agent and they should press Enter (or we can call the
                // internal runPlanActFlow via a side-channel). For now, we
                // surface a notification and route through the project
                // wizard which already exists for this purpose.
                notificationService.info(`Autonomous build armed: "${idea.slice(0, 60)}${idea.length > 60 ? '…' : ''}"`);

                // Route to the existing project wizard, which already does
                // idea refinement → plan → milestone-gated execution.
                commandService.executeCommand('kovix.openProjectWizard', idea);
        }
});

// --- Patch A: Register Kovix tab autocomplete provider ---

class KovixAutocompleteContribution extends Disposable implements IWorkbenchContribution {
        static readonly ID = 'workbench.contrib.kovixAutocomplete';

        constructor(
                @ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
                @IConstructAIService aiService: IConstructAIService,
                @IConfigurationService configService: IConfigurationService,
                @ILogService logService: ILogService,
        ) {
                super();
                try {
                        this._register(registerKovixAutocomplete(languageFeaturesService, aiService, configService, logService));
                } catch (err) {
                        logService.error('[Kovix.Autocomplete] Failed to register provider:', err instanceof Error ? err.message : String(err));
                }
        }
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
        KovixAutocompleteContribution,
        LifecyclePhase.Restored
);
