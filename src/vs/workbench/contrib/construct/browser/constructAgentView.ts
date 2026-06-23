/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import * as dom from '../../../../base/browser/dom.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IConstructMemoryService } from '../../../../platform/construct/common/memory/constructMemory.js';
import { IAgentLoop, IPlanResult } from '../../../../platform/construct/common/agent/agentLoop.js';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { AIProviderType } from '../../../../platform/construct/common/llm/constructAIProvider.js';
import { IDiffApplier } from '../../../../platform/construct/common/editor/diffApplier.js';
import { IPendingChangesService } from '../../../../platform/construct/common/diff/pendingChanges.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ConstructProgressPanel } from './constructProgressPanel.js';
import { LoadingState, FileChangeEntry, TaskMetrics } from '../../../../platform/construct/common/agent/loadingState.js';
import { IRefinedIdea, IRefinementQuestion, IRefinementAnswer } from '../../../../platform/construct/common/agent/ideaRefinementTypes.js';
import { IIdeaRefinementService } from '../../../../platform/construct/common/agent/ideaRefinementService.js';

import { IConstructSessionService } from '../../../../platform/construct/common/session/constructSessionService.js';
import { ISelectablePlanStep, IApprovedPlan, IMilestone } from '../../../../platform/construct/common/agent/milestoneStateMachine.js';
import { showStopModePicker } from './constructStopModePicker.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ISkillRegistry } from '../../../../platform/construct/common/skills/skillRegistry.js';
// P0-3: Slash command autocomplete dropdown — instantiates one per agent input.
import { KovixSlashDropdown } from './kovixSlashDropdown.js';
// v2.0: Shared component library — createButton, createCheckbox, etc.
import { createButton, createCheckbox, createErrorState } from '../../../browser/parts/kovix/ui/kovixUiComponents.js';
import './media/kovixAgent.css';
// v2.0 teal-identity additions: persistent status bar, plan-approval redesign,
// stop-mode segmented control, message-category distinctions, memory scope
// badges, error states, milestone pause redesign, onboarding step treatment.
import './media/kovixAgentV2.css';

type ExecutionState = 'idle' | 'planning' | 'refining' | 'awaiting_approval' | 'executing' | 'verifying' | 'verification_failed' | 'paused_at_milestone' | 'complete' | 'error' | 'stopped';

type ContextScope = 'currentFile' | 'workspace' | 'selectedText';

interface PendingDiff {
        id: string;
        filePath: string;
        content: string;
        originalContent: string | null; // Original file content before the diff, for reject/revert
        changeType: 'write' | 'edit';
        element: HTMLElement;
        accepted: boolean;
}

interface ToolLogEntry {
        toolName: string;
        target: string;
        durationMs: number;
        success: boolean;
}

export class ConstructAgentViewPane extends ViewPane {

        private messageContainer!: HTMLElement;
        private inputBox!: HTMLTextAreaElement;
        private clearBtn!: HTMLButtonElement;
        private sendBtn!: HTMLButtonElement;
        private stopBtn!: HTMLButtonElement;
        private statusIndicator!: HTMLElement;
        /** v2.0: persistent agent status bar (always visible when agent is active) */
        private statusBarEl!: HTMLElement;
        private statusBarDotEl!: HTMLElement;
        private statusBarLabelEl!: HTMLElement;
        private statusBarTaskEl!: HTMLElement;
        private planContainer: HTMLElement | null = null;
        private progressPanel!: ConstructProgressPanel;
        private messageCount = 0;
        private currentTaskId: string | null = null;
        private executionState: ExecutionState = 'idle';
        private currentCancellationToken: CancellationTokenSource | null = null;
        private _abortController: AbortController | null = null;

        // Kovix v1.3.0 — new UI element references
        private agentRoot!: HTMLElement;
        private agentNameEl!: HTMLElement;
        private agentSublineEl!: HTMLElement;
        // P2-3: Subline segments, individually clickable
        private agentSublineModeEl!: HTMLElement;
        private agentSublineProviderEl!: HTMLElement;
        private agentSublineModelEl!: HTMLElement;
        private modeBadgeEl!: HTMLElement;
        private memoryPillEl!: HTMLElement;
        private ponytailBadgeEl!: HTMLElement;
        private chipsRowEl!: HTMLElement;
        private inputRowEl!: HTMLElement;
        private inputHintEl!: HTMLElement;

        // Performance metrics tracking
        private taskStartTime = 0;
        private planningStartTime = 0;
        private planningEndTime = 0;
        private stepMetrics: Array<{
                stepNumber: number;
                label: string;
                startTime: number;
                endTime?: number;
                subSteps: Array<{ label: string; startTime: number; endTime?: number }>;
        }> = [];
        private currentStepStart = 0;
        private llmCallCount = 0;

        // Phase 2: Model picker
        private modelPickerBtn!: HTMLButtonElement;
        private currentModelInfo: { name: string; providerType: AIProviderType | undefined; isLocal: boolean } = {
                name: 'No Model', providerType: undefined, isLocal: true,
        };

        // Phase 2: Context selector
        private contextScope: ContextScope = 'workspace';

        // Phase 2: Tool activity log
        private toolLogEntries: ToolLogEntry[] = [];
        private toolLogContainer: HTMLElement | null = null;
        private toolLogCollapsed = true;

        // Phase 2: Pending diffs
        private pendingDiffs: PendingDiff[] = [];
        private diffCounter = 0;

        constructor(
                options: IViewPaneOptions,
                @IKeybindingService keybindingService: IKeybindingService,
                @IContextMenuService contextMenuService: IContextMenuService,
                @IConfigurationService configurationService: IConfigurationService,
                @IContextKeyService contextKeyService: IContextKeyService,
                @IViewDescriptorService viewDescriptorService: IViewDescriptorService,
                @IInstantiationService instantiationService: IInstantiationService,
                @IOpenerService openerService: IOpenerService,
                @IThemeService themeService: IThemeService,
                @ITelemetryService telemetryService: ITelemetryService,
                @IHoverService hoverService: IHoverService,
                @IMemoryOrchestrator _memoryOrchestrator: IMemoryOrchestrator,
                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
                @IAgentLoop private readonly agentLoop: IAgentLoop,
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IDiffApplier private readonly diffApplier: IDiffApplier,
                @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
                @ILogService private readonly logService: ILogService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @INotificationService private readonly notificationService: INotificationService,
                @ICommandService private readonly commandService: ICommandService,
                @IFileService private readonly fileService: IFileService,
                @IPendingChangesService private readonly pendingChangesService: IPendingChangesService,
                @IIdeaRefinementService private readonly ideaRefinementService: IIdeaRefinementService,
                @IConstructSessionService private readonly sessionService: IConstructSessionService,
                @IQuickInputService private readonly quickInputService: IQuickInputService,
                @ISkillRegistry private readonly skillRegistry: ISkillRegistry,
        ) {
                super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
                // DIAGNOSTIC: confirm the constructor ran (i.e. super() completed without throwing)
                console.log('[Kovix Agent] ConstructAgentViewPane constructor completed — instance created');
        }

        protected override renderBody(container: HTMLElement): void {
                super.renderBody(container);

                try {
                        this._renderBody(container);
                } catch (err) {
                        this.logService.error('[Kovix] ConstructAgentViewPane.renderBody failed:', err);
                        console.error('[Kovix] ConstructAgentViewPane.renderBody failed:', err);
                        // Render a visible error placeholder so silent failures are obvious.
                        const errDiv = document.createElement('div');
                        errDiv.style.cssText = 'padding: 16px; color: var(--kovix-error); background: var(--kovix-error-bg); border: 1px solid var(--kovix-error); border-radius: 6px; margin: 12px; font-family: var(--kovix-font-mono, monospace); font-size: 12px; white-space: pre-wrap;';
                        errDiv.textContent = `[Kovix Agent] Failed to render panel:\n${err instanceof Error ? err.stack || err.message : String(err)}\n\nCheck Developer Tools console for details. The agent backend services may have failed to initialize.`;
                        container.appendChild(errDiv);
                }
        }

        private _renderBody(container: HTMLElement): void {
                // Root — Kovix luxury chromium
                this.agentRoot = dom.$('.kovix-agent');
                container.appendChild(this.agentRoot);
                container.style.height = '100%';

                // --- v2.0: Persistent agent status bar (always visible at top) ---
                // 7 states: idle/planning/executing/refining/paused/awaiting/complete/error
                // Replaces the buried statusIndicator with a glanceable persistent bar.
                this.statusBarEl = dom.$('.kovix-agent-statusbar');
                this.statusBarEl.classList.add('is-idle');
                this.statusBarEl.setAttribute('role', 'status');
                this.statusBarEl.setAttribute('aria-live', 'polite');
                this.statusBarDotEl = dom.$('.kovix-agent-statusbar__dot');
                this.statusBarLabelEl = dom.$('.kovix-agent-statusbar__label');
                this.statusBarLabelEl.textContent = 'READY';
                this.statusBarTaskEl = dom.$('.kovix-agent-statusbar__task');
                this.statusBarEl.appendChild(this.statusBarDotEl);
                this.statusBarEl.appendChild(this.statusBarLabelEl);
                this.statusBarEl.appendChild(this.statusBarTaskEl);
                this.agentRoot.appendChild(this.statusBarEl);

                // --- Header: avatar + name + subline + actions ---
                const header = dom.$('.kovix-agent__header');

                const avatar = dom.$('.kovix-agent__avatar');
                avatar.textContent = 'K';
                avatar.setAttribute('aria-label', 'Kovix Agent');

                const titles = dom.$('.kovix-agent__titles');
                this.agentNameEl = dom.$('.kovix-agent__name');
                this.agentNameEl.textContent = 'Kovix Agent';
                this.agentSublineEl = dom.$('.kovix-agent__subline');
                // P2-3: Make each subline segment individually clickable.
                // The three segments are: mode · provider · model. Each opens its
                // respective picker on click.
                this.agentSublineEl.innerHTML = '';
                const subMode = dom.$('span.kovix-agent__subline-seg');
                subMode.textContent = 'General';
                subMode.title = 'Switch agent mode';
                subMode.onclick = () => { this.commandService.executeCommand('kovix.switchAgentMode'); };
                const subDot1 = dom.$('span');
                subDot1.textContent = ' \u00b7 ';
                subDot1.style.color = 'var(--kovix-text-tertiary)';
                const subProvider = dom.$('span.kovix-agent__subline-seg');
                subProvider.textContent = 'No Provider';
                subProvider.title = 'Switch LLM provider';
                subProvider.onclick = () => { this.commandService.executeCommand('kovix.switchProvider'); };
                const subDot2 = dom.$('span');
                subDot2.textContent = ' \u00b7 ';
                subDot2.style.color = 'var(--kovix-text-tertiary)';
                const subModel = dom.$('span.kovix-agent__subline-seg');
                subModel.textContent = 'No Model';
                subModel.title = 'Select model';
                subModel.onclick = () => { this.commandService.executeCommand('kovix.selectModel'); };
                this.agentSublineEl.appendChild(subMode);
                this.agentSublineEl.appendChild(subDot1);
                this.agentSublineEl.appendChild(subProvider);
                this.agentSublineEl.appendChild(subDot2);
                this.agentSublineEl.appendChild(subModel);
                // Keep references so updateStatusIndicator can refresh the text.
                this.agentSublineModeEl = subMode;
                this.agentSublineProviderEl = subProvider;
                this.agentSublineModelEl = subModel;
                titles.appendChild(this.agentNameEl);
                titles.appendChild(this.agentSublineEl);

                const actions = dom.$('.kovix-agent__header-actions');

                const newChatBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                newChatBtn.textContent = '\u2795';
                newChatBtn.title = 'New chat';
                newChatBtn.setAttribute('aria-label', 'New chat');
                newChatBtn.onclick = () => { this.clearMessages(); };

                const historyBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                historyBtn.textContent = '\uD83D\uDCDC';
                historyBtn.title = 'Session history';
                historyBtn.setAttribute('aria-label', 'Session history');
                historyBtn.onclick = () => { this.showSessionHistory(); };

                const settingsBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                settingsBtn.textContent = '\u2699';
                settingsBtn.title = 'API settings — add or manage API keys';
                settingsBtn.setAttribute('aria-label', 'API settings');
                settingsBtn.onclick = () => {
                        // Kovix v1.3.1: route the gear button to the friendly QuickInput-based
                        // key manager (kovix.manageApiKeys) instead of the raw JSON settings
                        // page. The key manager walks the user through provider selection, key
                        // entry, validation, and activation — far more discoverable than a
                        // settings.json text filter.
                        this.commandService.executeCommand('kovix.manageApiKeys');
                };

                const controlCenterBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                controlCenterBtn.textContent = '\uD83D\uDCCA';
                controlCenterBtn.title = 'Agent Control Center';
                controlCenterBtn.setAttribute('aria-label', 'Agent Control Center');
                controlCenterBtn.onclick = () => {
                        this.commandService.executeCommand('kovix.openControlCenter');
                };

                actions.appendChild(newChatBtn);
                actions.appendChild(historyBtn);
                actions.appendChild(controlCenterBtn);
                actions.appendChild(settingsBtn);

                header.appendChild(avatar);
                header.appendChild(titles);
                header.appendChild(actions);
                this.agentRoot.appendChild(header);

                // --- P1-1: Secondary header button row (6 missing buttons) ---
                // These are the 6 commands the audit flagged as command-palette-only.
                // Placed in a secondary row below the primary header to avoid
                // overcrowding the top row.
                const secondaryActions = dom.$('.kovix-agent__header-secondary');

                const modeBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                modeBtn.textContent = '\u21C5';
                modeBtn.title = 'Switch Agent Mode (Ctrl+Shift+M)';
                modeBtn.setAttribute('aria-label', 'Switch agent mode');
                modeBtn.onclick = () => { this.commandService.executeCommand('kovix.switchAgentMode'); };

                const swarmBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                swarmBtn.textContent = '\u2B21';
                swarmBtn.title = 'Open Swarm Dashboard (Ctrl+Shift+S)';
                swarmBtn.setAttribute('aria-label', 'Open swarm dashboard');
                swarmBtn.onclick = () => { this.commandService.executeCommand('kovix.openSwarm'); };

                const skillsBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                skillsBtn.textContent = '\u25AE';
                skillsBtn.title = 'View installed skills';
                skillsBtn.setAttribute('aria-label', 'View installed skills');
                skillsBtn.onclick = () => { this.commandService.executeCommand('kovix.viewSkill'); };

                const mcpBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                mcpBtn.textContent = '\u229E';
                mcpBtn.title = 'Open MCP Marketplace';
                mcpBtn.setAttribute('aria-label', 'Open MCP marketplace');
                mcpBtn.onclick = () => { this.commandService.executeCommand('kovix.mcp.openMarketplace'); };

                const autonomousBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                autonomousBtn.textContent = '\uD83D\uDE80';
                autonomousBtn.title = 'Start Autonomous Build (idea \u2192 app wizard)';
                autonomousBtn.setAttribute('aria-label', 'Start autonomous build');
                autonomousBtn.onclick = () => { this.commandService.executeCommand('kovix.autonomousBuild'); };

                const ponytailBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                ponytailBtn.textContent = '\uD83D\uDCE7';
                ponytailBtn.title = 'Ponytail: set lazy-dev mode';
                ponytailBtn.setAttribute('aria-label', 'Ponytail: set mode');
                ponytailBtn.onclick = () => { this.commandService.executeCommand('kovix.ponytailSetMode'); };

                secondaryActions.appendChild(modeBtn);
                secondaryActions.appendChild(swarmBtn);
                secondaryActions.appendChild(skillsBtn);
                secondaryActions.appendChild(mcpBtn);
                secondaryActions.appendChild(autonomousBtn);
                secondaryActions.appendChild(ponytailBtn);
                this.agentRoot.appendChild(secondaryActions);

                // --- Session tabs ---
                const sessions = dom.$('.kovix-agent__sessions');
                const activeSession = dom.$('.kovix-session-tab.is-active');
                activeSession.textContent = 'auth-refactor';
                const activeClose = dom.$('.kovix-session-tab__close');
                activeClose.textContent = '\u00d7';
                activeSession.appendChild(activeClose);
                sessions.appendChild(activeSession);

                const altSession = dom.$('.kovix-session-tab');
                altSession.textContent = 'nmap-scan';
                const altClose = dom.$('.kovix-session-tab__close');
                altClose.textContent = '\u00d7';
                altSession.appendChild(altClose);
                sessions.appendChild(altSession);
                this.agentRoot.appendChild(sessions);

                // --- Model bar: mode badge + model pill + spacer + memory pill + ponytail badge ---
                const modelBar = dom.$('.kovix-agent__modelbar');

                this.modeBadgeEl = dom.$('.kovix-mode-badge.kovix-mode-badge--general');
                this.modeBadgeEl.textContent = 'GENERAL';
                this.modeBadgeEl.title = 'Switch agent mode';
                this.modeBadgeEl.onclick = () => {
                        this.commandService.executeCommand('kovix.switchAgentMode');
                };

                this.modelPickerBtn = dom.$('button.kovix-model-pill') as HTMLButtonElement;
                this.modelPickerBtn.title = 'Select model';
                this.modelPickerBtn.setAttribute('aria-label', 'Select model');
                this.modelPickerBtn.onclick = () => {
                        this.commandService.executeCommand('kovix.selectModel');
                };
                this.updateModelPickerLabel();

                const spacer = dom.$('.kovix-modelbar__spacer');

                this.memoryPillEl = dom.$('.kovix-memory-pill');
                this.memoryPillEl.title = 'Open memory graph';
                this.memoryPillEl.textContent = this.constructMemory.isInitialized ? '\u25CF memory' : '\u25CB memory';
                if (this.constructMemory.isInitialized) {
                        this.memoryPillEl.classList.add('is-connected');
                }
                this.memoryPillEl.onclick = () => {
                        this.commandService.executeCommand('kovix.openMemoryGraph');
                };

                this.ponytailBadgeEl = dom.$('.kovix-ponytail-badge');
                const ponytailMode = this.configurationService.getValue<string>('kovix.ponytail.mode') ?? 'off';
                this.ponytailBadgeEl.textContent = `PONYTAIL \u00b7 ${ponytailMode.toUpperCase()}`;
                if (ponytailMode === 'off') {
                        this.ponytailBadgeEl.classList.add('is-off');
                }
                this.ponytailBadgeEl.title = 'Ponytail lazy-developer mode — click to change';
                this.ponytailBadgeEl.onclick = () => {
                        this.commandService.executeCommand('kovix.ponytailSetMode');
                };

                modelBar.appendChild(this.modeBadgeEl);
                modelBar.appendChild(this.modelPickerBtn);
                modelBar.appendChild(spacer);
                modelBar.appendChild(this.memoryPillEl);
                modelBar.appendChild(this.ponytailBadgeEl);
                this.agentRoot.appendChild(modelBar);

                // --- Messages area ---
                // F-008 (#78): aria-live so screen readers announce new agent messages.
                this.messageContainer = dom.$('.kovix-agent__messages');
                this.messageContainer.setAttribute('role', 'log');
                this.messageContainer.setAttribute('aria-live', 'polite');
                this.messageContainer.setAttribute('aria-label', 'Agent conversation');

                // Welcome / empty state
                const welcome = dom.$('.kovix-welcome');
                const logo = dom.$('.kovix-welcome__logo');
                logo.textContent = '\u2B21';
                const welcomeTitle = dom.$('.kovix-welcome__title');
                welcomeTitle.textContent = 'Kovix Agent';
                const welcomeSubtitle = dom.$('.kovix-welcome__subtitle');
                welcomeSubtitle.textContent = 'Your AI pair programmer with its own OS';

                this.statusIndicator = dom.$('.kovix-msg__status');
                this.statusIndicator.classList.add('kovix-msg__status--done');
                this.statusIndicator.textContent = 'READY';
                this.updateStatusIndicator();

                const hint = dom.$('.kovix-welcome__hint');
                hint.innerHTML = '<kbd>Ctrl+Shift+K</kbd> focus panel &nbsp;\u00b7&nbsp; <kbd>Ctrl+Shift+I</kbd> inline edit &nbsp;\u00b7&nbsp; <kbd>Ctrl+Shift+P</kbd> commands';

                welcome.appendChild(logo);
                welcome.appendChild(welcomeTitle);
                welcome.appendChild(welcomeSubtitle);
                welcome.appendChild(this.statusIndicator);
                welcome.appendChild(hint);
                this.messageContainer.appendChild(welcome);
                this.agentRoot.appendChild(this.messageContainer);

                // --- Input area: chips row + input row + hint row ---
                const inputArea = dom.$('.kovix-inputarea');

                this.chipsRowEl = dom.$('.kovix-inputchips');

                this.inputRowEl = dom.$('.kovix-inputrow');
                this.inputBox = document.createElement('textarea');
                this.inputBox.className = 'kovix-input';
                this.inputBox.rows = 1;
                this.inputBox.placeholder = 'Ask Kovix to plan a change...';
                this.inputBox.setAttribute('aria-label', 'Message Kovix Agent');
                this.inputBox.addEventListener('input', () => {
                        this.inputBox.style.height = 'auto';
                        this.inputBox.style.height = Math.min(this.inputBox.scrollHeight, 200) + 'px';
                        this.scanInputForChips();
                });

                this.sendBtn = dom.$('button.kovix-send') as HTMLButtonElement;
                this.sendBtn.textContent = '\u2192';
                this.sendBtn.title = 'Send (Ctrl+Enter)';
                this.sendBtn.setAttribute('aria-label', 'Send message');

                this.stopBtn = dom.$('button.kovix-stop') as HTMLButtonElement;
                this.stopBtn.textContent = '\u25A0';
                this.stopBtn.title = 'Stop';
                this.stopBtn.style.display = 'none';

                this.clearBtn = dom.$('button.kovix-icon-btn') as HTMLButtonElement;
                this.clearBtn.textContent = '\uD83D\uDDB1';
                this.clearBtn.title = 'Clear chat';
                this.clearBtn.style.display = 'none';
                this.clearBtn.onclick = () => { this.clearMessages(); };

                // P2-5: Attach-file button — opens the OS file picker and inserts
                // the selected file as an @filename chip in the input.
                const attachBtn = dom.$('button.kovix-attach-btn') as HTMLButtonElement;
                attachBtn.textContent = '\uD83D\uDCCE'; // paperclip
                attachBtn.title = 'Attach file (inserts as @filename chip)';
                attachBtn.setAttribute('aria-label', 'Attach file');
                attachBtn.onclick = () => {
                        // Use a hidden file input to trigger the OS picker.
                        const fileInput = document.createElement('input');
                        fileInput.type = 'file';
                        fileInput.multiple = false;
                        fileInput.onchange = () => {
                                const file = fileInput.files?.[0];
                                if (file) {
                                        // Insert as @filename chip — append to the textarea value
                                        // and trigger the chip scanner.
                                        const filename = file.name;
                                        const current = this.inputBox.value;
                                        const sep = current.length > 0 && !current.endsWith(' ') ? ' ' : '';
                                        this.inputBox.value = `${current}${sep}@${filename} `;
                                        this.inputBox.dispatchEvent(new Event('input', { bubbles: true }));
                                        this.inputBox.focus();
                                        const len = this.inputBox.value.length;
                                        this.inputBox.setSelectionRange(len, len);
                                }
                        };
                        fileInput.click();
                };

                this.inputRowEl.appendChild(attachBtn);
                this.inputRowEl.appendChild(this.inputBox);
                this.inputRowEl.appendChild(this.stopBtn);
                this.inputRowEl.appendChild(this.sendBtn);

                this.inputHintEl = dom.$('.kovix-inputhint');
                this.inputHintEl.innerHTML = '<span><kbd>Enter</kbd> send \u00b7 <kbd>Shift+Enter</kbd> newline \u00b7 <kbd>@</kbd> file \u00b7 <kbd>#</kbd> tag</span><span>0 tokens</span>';

                inputArea.appendChild(this.chipsRowEl);
                inputArea.appendChild(this.inputRowEl);
                inputArea.appendChild(this.inputHintEl);
                this.agentRoot.appendChild(inputArea);

                // --- P0-3: Slash command autocomplete dropdown ---
                // Wires the KovixSlashDropdown to the textarea. The dropdown shows
                // when the user types "/" and lists all 7 slash commands with
                // descriptions, filterable, arrow-key navigable.
                this._register(new KovixSlashDropdown(this.inputBox, (cmd) => {
                        // onSelect callback — no-op here; the textarea value is already
                        // updated by the dropdown. The user hits Enter to send as usual.
                        // Logging could go here if we want telemetry on slash usage.
                        void cmd;
                }));

                // --- Send handler ---
                const sendMessage = async () => {
                        const text = this.inputBox.value.trim();
                        if (!text || this.executionState !== 'idle') { return; }

                        this.currentTaskId = `task-${Date.now()}`;
                        this.messageCount++;

                        const welcomeEl = this.messageContainer.querySelector('.kovix-welcome');
                        if (welcomeEl) { welcomeEl.remove(); }

                        this.addUserMessage(text);
                        this.inputBox.value = '';
                        this.inputBox.style.height = 'auto';
                        this.clearChips();
                        this.updateClearBtnVisibility();

                        // --- Slash-command handling (Kovix v1.4.0) -------------------
                        // /<skill-slug> <args...>  →  load the skill body and run
                        // plan-act with it as the system prompt prefix.
                        if (text.startsWith('/')) {
                                const handled = await this.handleSlashCommand(text);
                                if (handled) { return; }
                                // If not handled, fall through to normal flow
                        }

                        if (this.constructMemory.config.enabled && this.constructMemory.config.autoLearn) {
                                this.constructMemory.addMemory(`User asked: ${text}`, {
                                        type: 'user_message',
                                        taskId: this.currentTaskId,
                                        messageNumber: this.messageCount
                                }).catch(() => { /* non-critical */ });
                        }

                        const hasAIProvider = !!this.aiService.activeProvider;

                        const refinementEnabled = this.configurationService.getValue<boolean>('kovix.ideaRefinement.enabled');
                        if (refinementEnabled !== false && hasAIProvider) {
                                await this.runRefinementFlow(text);
                                return;
                        }

                        if (!hasAIProvider) {
                                this.addAgentMessage(
                                        '[SETUP] No AI provider configured yet. [Add an API key](command:kovix.manageApiKeys) to use the Kovix agent — NVIDIA NIM, OpenAI, Anthropic, OpenRouter, Groq, Together, Mistral, Gemini, DeepSeek, or local Ollama / LM Studio.',
                                        'error'
                                );
                                this.notificationService.warn('No AI provider configured. Click the gear icon or run "Kovix: Manage API Keys" to add one.');
                                return;
                        }

                        const contextText = this.gatherContext();
                        const taskWithContext = contextText ? `${text}\n\n[Context (${this.contextScope})]:\n${contextText}` : text;
                        this.toolLogEntries = [];
                        await this.runPlanActFlow(taskWithContext);
                };

                this.sendBtn.onclick = sendMessage;
                this.inputBox.onkeydown = (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                        }
                };

                this.stopBtn.onclick = () => {
                        if (this.currentCancellationToken) {
                                this.currentCancellationToken.cancel();
                                this.currentCancellationToken = null;
                        }
                        const controller = this._abortController;
                        if (controller) {
                                controller.abort();
                                this._abortController = null;
                        }
                };

                // --- Listen for memory init changes ---
                this._register(this.constructMemory.onDidChangeInitialization((initialized) => {
                        if (initialized) {
                                this.memoryPillEl.classList.add('is-connected');
                                this.memoryPillEl.textContent = '\u25CF memory';
                        } else {
                                this.memoryPillEl.classList.remove('is-connected');
                                this.memoryPillEl.textContent = '\u25CB memory';
                        }
                }));

                // --- Subscribe to agent loop events ---
                this._register(this.agentLoop.onLoadingStateChange((state: LoadingState) => {
                        this.handleLoadingStateChange(state);
                }));
                this._register(this.agentLoop.onFileChange((change: FileChangeEntry) => {
                        this.handleFileChange(change);
                }));

                // --- AI service model/provider change ---
                this._register(this.aiService.onDidChangeActiveProvider(() => {
                        this.refreshModelPickerInfo();
                }));
                this._register(this.aiService.onDidChangeActiveModel(() => {
                        this.refreshModelPickerInfo();
                }));
                this.refreshModelPickerInfo();

                // --- Wire kovix.newChat to clear ---
                this._register(this.commandService.onWillExecuteCommand(e => {
                        if (e.commandId === 'kovix.newChat') {
                                this.clearMessages();
                        }
                }));
        }

        /**
         * Handle loading state changes from the agent loop.
         * Updates the progress panel with granular, function-level feedback.
         */
        private handleLoadingStateChange(state: LoadingState): void {
                if (!this.progressPanel) { return; }
                this.progressPanel.updateState(state);

                // Track metrics based on phase transitions
                switch (state.phase) {
                        case 'planning':
                                this.planningStartTime = state.startTime;
                                break;
                        case 'planning-complete':
                                this.planningEndTime = Date.now();
                                break;
                        case 'reading-file':
                        case 'writing-file':
                        case 'creating-directory':
                        case 'applying-diff':
                        case 'running-command':
                                break;
                        case 'error':
                                // Show error in progress panel with recovery context
                                this.progressPanel.showError(
                                        state.detail ?? state.message,
                                        state.stepNumber,
                                        state.totalSteps
                                );
                                break;
                        case 'complete': {
                                // Build and show performance metrics
                                const metrics: TaskMetrics = {
                                        totalStartTime: this.taskStartTime,
                                        totalEndTime: Date.now(),
                                        planningStartTime: this.planningStartTime,
                                        planningEndTime: this.planningEndTime,
                                        steps: this.stepMetrics,
                                        llmCallCount: this.llmCallCount,
                                };
                                this.progressPanel.showMetrics(metrics);
                                break;
                        }
                }

                this.scrollToBottom();
        }

        /**
         * Handle file change events from the agent loop.
         * Updates the file tree diff in the progress panel.
         * Phase 2: Also shows inline diff viewer for write/edit operations.
         */
        private handleFileChange(change: FileChangeEntry): void {
                if (!this.progressPanel) { return; }
                this.progressPanel.addFileChange(change);

                // Phase 2: Show diff viewer for write/edit operations
                if (change.status === 'created' || change.status === 'modified') {
                        this.showPendingDiff(change.path, change.status === 'created' ? 'write' : 'edit');
                }

                this.scrollToBottom();
        }

        /**
         * Handle a slash command of the form `/<skill-slug> <args...>`.
         *
         * Returns true if the command was recognised and handled (in which
         * case the caller should NOT fall through to the normal flow).
         * Returns false for unknown commands so the caller can treat the
         * input as a regular message.
         *
         * Built-in slash commands:
         *   /skills                 — list all installed skills
         *   /skill <slug>           — show details of a skill
         *   /skill-create           — open the create-skill flow
         *   /forget-everything      — wipe all stored memories (with confirm)
         *   /memory                 — show current memory privacy posture
         *   /swarm                  — open the swarm spawner
         *   /idea <description>     — kick off the autonomous idea→app wizard
         *   /<skill-slug> <args...> — run a skill against the workspace
         */
        private async handleSlashCommand(text: string): Promise<boolean> {
                const parts = text.slice(1).split(/\s+/);
                const cmd = parts[0]?.toLowerCase();
                const args = parts.slice(1).join(' ');

                // --- /skills : list installed skills ---
                if (cmd === 'skills') {
                        const skills = await this.skillRegistry.getAllSkills();
                        if (skills.length === 0) {
                                this.addAgentMessage('No skills installed yet. Run `/skill-create` to make one from a document, or drop a SKILL.md into `~/.kovix/skills/<slug>/`.');
                        } else {
                                const lines = skills.map(s => {
                                        const icon = s.enabled ? '✓' : '✗';
                                        const scope = s.scope === 'builtin' ? 'builtin' : s.scope;
                                        return `${icon} **/${s.slug}** (${scope}) — ${s.description}`;
                                });
                                this.addAgentMessage(
                                        `**${skills.length} skills available:**\n\n${lines.join('\n\n')}\n\nRun \`/<slug>\` to invoke one, or \`/skill <slug>\` for details. Manage them in the Kovix Agent Settings pane.`,
                                );
                        }
                        return true;
                }

                // --- /skill <slug> : show details ---
                if (cmd === 'skill' && args) {
                        const skill = await this.skillRegistry.getSkill(args);
                        if (!skill) {
                                this.addAgentMessage(`No skill named \`${args}\` found. Run \`/skills\` to see what's installed.`, 'error');
                                return true;
                        }
                        const bodyPreview = skill.body.length > 1500
                                ? skill.body.slice(0, 1500) + '\n…(truncated)'
                                : skill.body;
                        this.addAgentMessage(
                                `**/${skill.slug}** — ${skill.title}\n\n${skill.description}\n\n` +
                                `**Scope:** ${skill.scope}  **Enabled:** ${skill.enabled}  **Tags:** ${skill.tags.join(', ') || '—'}\n\n` +
                                `**Body:**\n\n\`\`\`markdown\n${bodyPreview}\n\`\`\``,
                        );
                        return true;
                }

                // --- /skill-create : open the create flow ---
                if (cmd === 'skill-create') {
                        this.commandService.executeCommand('kovix.createSkillFromDocument');
                        return true;
                }

                // --- /forget-everything : wipe memories ---
                if (cmd === 'forget-everything' || cmd === 'forget') {
                        const confirm = await this.quickInputService.pick(
                                [
                                        { label: 'Yes, forget everything', description: 'Irreversible' },
                                        { label: 'Cancel' },
                                ],
                                { placeHolder: 'Forget ALL stored memories? This cannot be undone.' },
                        );
                        if (confirm?.label.startsWith('Yes')) {
                                this.commandService.executeCommand('kovix.forgetAllMemories');
                        }
                        return true;
                }

                // --- /memory : show privacy posture ---
                if (cmd === 'memory') {
                        this.commandService.executeCommand('kovix.openMemorySettings');
                        return true;
                }

                // --- /swarm : open swarm spawner ---
                if (cmd === 'swarm') {
                        this.commandService.executeCommand('kovix.openSwarm');
                        return true;
                }

                // --- /idea : autonomous idea→app wizard ---
                if (cmd === 'idea' && args) {
                        this.commandService.executeCommand('kovix.autonomousBuild', args);
                        return true;
                }
                if (cmd === 'idea') {
                        this.commandService.executeCommand('kovix.autonomousBuild');
                        return true;
                }

                // --- /<skill-slug> : invoke a skill ---
                const skill = await this.skillRegistry.getSkill(cmd);
                if (skill) {
                        if (!skill.enabled) {
                                this.addAgentMessage(`Skill \`/${cmd}\` is disabled. Enable it in the Kovix Agent Settings pane.`, 'error');
                                return true;
                        }
                        // Inject the skill body as a prefix to the task
                        const taskWithSkill = `**Invoking skill: /${skill.slug}**\n\n${skill.body}\n\n---\n\n**User task:** ${args || '(apply this skill to the current workspace)'}`;
                        const contextText = this.gatherContext();
                        const taskWithContext = contextText ? `${taskWithSkill}\n\n[Context (${this.contextScope})]:\n${contextText}` : taskWithSkill;
                        this.toolLogEntries = [];
                        await this.runPlanActFlow(taskWithContext);
                        return true;
                }

                // Unknown slash command — let it fall through as a regular message
                return false;
        }

        /**
         * Run the Plan/Act approval flow.
         */
        private async runPlanActFlow(task: string): Promise<void> {
                this.setExecutionState('planning');
                this.currentCancellationToken = new CancellationTokenSource();
                // BUG 2 FIX: Create a real AbortController and bridge cancellation
                this._abortController = new AbortController();
                const abortController = this._abortController;
                this.currentCancellationToken.token.onCancellationRequested(() => abortController.abort());
                this.taskStartTime = Date.now();
                this.planningStartTime = Date.now();
                this.planningEndTime = 0;
                this.stepMetrics = [];
                this.llmCallCount = 0;

                // Create a progress panel for this task
                this.progressPanel = new ConstructProgressPanel(this.messageContainer);

                // Add planning indicator
                const planningMsg = this.addAgentMessage('', 'info');

                try {
                        // Phase 1: Planning — pass real AbortSignal, NOT CancellationToken cast
                        const plan = await this.agentLoop.runPlanningPhase(task, abortController.signal);

                        if (abortController.signal.aborted) {
                                this.setExecutionState('stopped');
                                this.updateMessageContent(planningMsg, '[STOP] Stopped by user');
                                // Transition back to idle after showing stopped state
                                setTimeout(() => { this.setExecutionState('idle'); }, 1500);
                                return;
                        }

                        // Phase 2: Show plan and await approval
                        this.planningEndTime = Date.now();
                        this.setExecutionState('awaiting_approval');
                        this.updateMessageContent(planningMsg, '');
                        this.renderPlan(plan, task);

                } catch (error) {
                        this.setExecutionState('error');
                        const msg = error instanceof Error ? error.message : String(error);
                        this.updateMessageContent(planningMsg, '');
                        // v2.0: render error using shared ErrorState component
                        const errorEl = createErrorState({
                                title: 'Planning failed',
                                detail: msg,
                                recovery: 'Try rephrasing the task or check your API key and network connection.',
                                onRetry: () => { this.setExecutionState('idle'); },
                                onDismiss: () => { this.setExecutionState('idle'); },
                        });
                        this.messageContainer.appendChild(errorEl);
                        this.logService.error('[AgentView] Planning error:', msg);

                        // Transition back to idle after showing error
                        setTimeout(() => { this.setExecutionState('idle'); }, 5000);
                } finally {
                        // BUG 6 FIX: Clean up cancellation state to prevent stale references
                        this.currentCancellationToken?.dispose();
                        this.currentCancellationToken = null;
                        this._abortController = null;
                }
        }

        /**
         * Render the plan with Approve/Cancel buttons.
         */
        private selectableSteps: ISelectablePlanStep[] = [];

        private renderPlan(plan: IPlanResult, task: string): void {
                // Remove any existing plan container
                this.planContainer?.remove();

                // Create selectable steps from the plan
                this.selectableSteps = plan.steps.map((step, idx) => ({
                        index: idx,
                        action: step.action,
                        target: step.target,
                        description: step.description,
                        selected: true,
                }));

                // v2.0: use .kovix-plan-card class from kovixAgentV2.css
                this.planContainer = dom.$('.kovix-plan-card');

                // Plan header
                const header = dom.$('.kovix-plan-card__header');
                const title = dom.$('.kovix-plan-card__title');
                title.textContent = `\uD83D\uDCA1 Plan ready`;
                const meta = dom.$('.kovix-plan-card__meta');
                meta.textContent = `${plan.steps.length} steps`;
                header.appendChild(title);
                header.appendChild(meta);
                this.planContainer.appendChild(header);

                // Steps container
                const stepsContainer = dom.$('.kovix-plan-card__steps');

                // Select All / Deselect All controls
                if (this.selectableSteps.length > 0) {
                        const controls = dom.$('.kovix-plan-card__controls');
                        const selectAllBtn = dom.$('button.kovix-plan-card__select-all') as HTMLButtonElement;
                        selectAllBtn.textContent = 'Select All';
                        selectAllBtn.onclick = () => {
                                this.selectableSteps.forEach(s => s.selected = true);
                                this.planContainer?.querySelectorAll<HTMLInputElement>('.kovix-plan-card__steps .kovix-checkbox__input').forEach(cb => { cb.checked = true; });
                                this.planContainer?.querySelectorAll('.kovix-plan-step').forEach(el => { el.classList.remove('is-failed'); });
                        };
                        const deselectAllBtn = dom.$('button.kovix-plan-card__select-all') as HTMLButtonElement;
                        deselectAllBtn.textContent = 'Deselect All';
                        deselectAllBtn.onclick = () => {
                                this.selectableSteps.forEach(s => s.selected = false);
                                this.planContainer?.querySelectorAll<HTMLInputElement>('.kovix-plan-card__steps .kovix-checkbox__input').forEach(cb => { cb.checked = false; });
                        };
                        controls.appendChild(selectAllBtn);
                        controls.appendChild(deselectAllBtn);
                        this.planContainer.appendChild(controls);
                }

                // Plan steps with checkboxes (using shared createCheckbox)
                if (this.selectableSteps.length > 0) {
                        for (const step of this.selectableSteps) {
                                const stepRow = dom.$('.kovix-plan-step');
                                const icon = this.getActionIcon(step.action);
                                const { container: checkboxContainer } = createCheckbox({
                                        label: `${icon} ${step.action}: ${step.target}`,
                                        checked: step.selected,
                                        onChange: (checked) => {
                                                step.selected = checked;
                                                stepRow.classList.toggle('is-complete', !checked);
                                        },
                                });
                                stepRow.appendChild(checkboxContainer);
                                stepsContainer.appendChild(stepRow);
                        }
                        this.planContainer.appendChild(stepsContainer);
                } else {
                        // No structured steps — show the raw summary
                        const summaryEl = dom.$('.kovix-plan-card__summary');
                        summaryEl.textContent = plan.summary.substring(0, 500);
                        this.planContainer.appendChild(summaryEl);
                }

                // Buttons (using shared createButton)
                const btnContainer = dom.$('.kovix-plan-card__actions');

                const approveBtn = createButton({
                        label: '\u2705 Approve',
                        variant: 'primary',
                        ariaLabel: 'Approve plan and start execution',
                        onClick: async () => {
                                // Show stop mode picker
                                const milestones = this.agentLoop.extractMilestonesFromPlan(plan.steps);
                                const pickResult = await showStopModePicker(this.quickInputService, milestones);
                                if (!pickResult) { return; } // cancelled

                                const approvedPlan: IApprovedPlan = {
                                        task,
                                        steps: this.selectableSteps,
                                        executionMode: pickResult.mode,
                                        selectedMilestoneIds: pickResult.selectedMilestoneIds,
                                        milestones,
                                        approved: true,
                                        approvedAt: Date.now(),
                                };

                                this.planContainer?.remove();
                                this.planContainer = null;
                                this.runExecution(task, approvedPlan);
                        },
                });

                const cancelBtn = createButton({
                        label: '\u274C Cancel',
                        variant: 'ghost',
                        ariaLabel: 'Cancel plan',
                        onClick: () => {
                                this.planContainer?.remove();
                                this.planContainer = null;
                                this.addAgentMessage('[CANCEL] Task cancelled', 'info');
                                this.setExecutionState('idle');
                                this.progressPanel?.clear();
                        },
                });

                btnContainer.appendChild(approveBtn);
                btnContainer.appendChild(cancelBtn);
                this.planContainer.appendChild(btnContainer);

                this.messageContainer.appendChild(this.planContainer);
                this.scrollToBottom();
        }

        /**
         * Run the execution phase with full tool access.
         * Now shows granular, function-level progress indicators.
         */
        private async runExecution(task: string, approvedPlan?: IApprovedPlan): Promise<void> {
                this.setExecutionState('executing');
                this.currentCancellationToken = new CancellationTokenSource();
                // BUG 2 FIX: Create a real AbortController and bridge cancellation
                this._abortController = new AbortController();
                const abortController = this._abortController;
                this.currentCancellationToken.token.onCancellationRequested(() => abortController.abort());

                // Clear and re-initialize progress panel for execution phase
                if (this.progressPanel) {
                        this.progressPanel.clear();
                }

                // Add execution message container with structured layout
                const execContainer = dom.$('.construct-exec-container');
                execContainer.style.cssText = `
                        margin: 6px 0;
                `;

                // Streaming output area
                const execMsg = this.addAgentMessage('', 'streaming');

                let fullText = '';
                let stepCount = 0;
                let currentToolName = '';
                let currentToolDetail = '';

                try {
                        // Use approved plan with milestone support if available, otherwise standard execution
                        const stream = approvedPlan
                                ? this.agentLoop.runWithApprovedPlan(approvedPlan, abortController.signal)
                                : this.agentLoop.run(task, abortController.signal);

                        for await (const event of stream) {
                                switch (event.type) {
                                        case 'thinking':
                                                fullText += `[THINK] ${event.text}`;
                                                break;

                                        case 'token':
                                                fullText += event.text;
                                                break;

                                        case 'tool_start':
                                                stepCount++;
                                                currentToolName = event.toolName;
                                                // Track step metric start
                                                this.currentStepStart = Date.now();
                                                fullText += `\n\n[TOOL] ${event.toolName}`;
                                                if (event.toolInput && typeof event.toolInput === 'object') {
                                                        const input = event.toolInput as Record<string, string>;
                                                        if (input.path) {
                                                                fullText += `: ${input.path}`;
                                                                currentToolDetail = input.path;
                                                        }
                                                        else if (input.command) {
                                                                fullText += `: ${input.command.substring(0, 60)}`;
                                                                currentToolDetail = input.command.substring(0, 60);
                                                        }
                                                }
                                                break;

                                        case 'tool_executing':
                                                // The progress panel is already updated via onLoadingStateChange.
                                                // We no longer treat this as a no-op -- the progress panel handles it.
                                                break;

                                        case 'tool_result': {
                                                // Record step metric
                                                const stepEnd = Date.now();
                                                this.stepMetrics.push({
                                                        stepNumber: stepCount,
                                                        label: currentToolName + (currentToolDetail ? `: ${currentToolDetail}` : ''),
                                                        startTime: this.currentStepStart,
                                                        endTime: stepEnd,
                                                        subSteps: [],
                                                });

                                                // Phase 2: Track tool activity log
                                                this.toolLogEntries.push({
                                                        toolName: currentToolName,
                                                        target: currentToolDetail,
                                                        durationMs: stepEnd - this.currentStepStart,
                                                        success: event.success,
                                                });

                                                if (event.success) {
                                                        fullText += `\n[OK] ${event.toolName} completed`;
                                                } else {
                                                        fullText += `\n[FAIL] ${event.toolName} failed: ${event.result.substring(0, 200)}`;
                                                }
                                                break;
                                        }

                                        case 'file_written':
                                                // Refresh file explorer after writes
                                                this.refreshFileExplorer();
                                                break;

                                        case 'milestone_reached':
                                                fullText += `\n\n\uD83D\uDEA9 Milestone reached: ${event.milestone.name}`;
                                                break;

                                        case 'milestone_paused':
                                                this.setExecutionState('paused_at_milestone');
                                                fullText += `\n\n\u23F8 Paused at milestone: ${event.milestone.name}`;
                                                this.renderMilestonePauseControls(event.milestone);
                                                break;

                                        case 'milestone_resumed':
                                                this.setExecutionState('executing');
                                                fullText += `\n\n\u25B6 Resumed from milestone: ${event.milestone.name}`;
                                                break;

                                        case 'milestone_completed':
                                                fullText += `\n\n\u2705 Milestone completed: ${event.milestone.name}`;
                                                break;

                                        // ──────────────────────────────────────────────────────────────────────
                                        // Phase 3.1 — Verification status surface.
                                        // The agent has declared "done"; the harness is now running a real
                                        // check (test/build/typecheck) before the milestone is allowed to
                                        // advance. The chip + status bar reflect this in real time.
                                        // ──────────────────────────────────────────────────────────────────────
                                        case 'verification_start':
                                                this.setExecutionState('verifying');
                                                fullText += `\n\n\uD83D\uDD0D Verifying: ${event.command}`;
                                                break;

                                        case 'verification_result': {
                                                if (event.unverified) {
                                                        // No test/build/typecheck available — mark unverified, not failed.
                                                        // Ignite-orange chip in the UI (rendered by updateStatusIndicator),
                                                        // warning-toned but not alarming.
                                                        fullText += `\n\n\u26A0\uFE0F Unverified: ${event.output}`;
                                                } else if (event.passed) {
                                                        fullText += `\n\n\u2705 Verification passed`;
                                                } else {
                                                        // Verification failed — the agent loop's runVerification() already
                                                        // fired an 'error' event with the failure detail. We just mark
                                                        // the state here; the error event handler above adds the
                                                        // user-visible failure text.
                                                        this.setExecutionState('verification_failed');
                                                        fullText += `\n\n\u274C Verification failed`;
                                                }
                                                break;
                                        }

                                        case 'complete':
                                                fullText += `\n\n[OK] Task complete`;
                                                break;

                                        case 'error':
                                                if (event.text.includes('Rate limited')) {
                                                        fullText += `\n\n[WAIT] ${event.text}`;
                                                } else if (event.text.includes('API key')) {
                                                        fullText += `\n\n[KEY] ${event.text} [Open Settings](command:kovix.openApiSettings)`;
                                                } else if (event.text.includes('Connection')) {
                                                        fullText += `\n\n[NET] ${event.text} [Retry](command:kovix.focusPanel)`;
                                                } else if (event.text.includes('[STOP]')) {
                                                        fullText += `\n\n[STOP] Stopped by user`;
                                                } else {
                                                        fullText += `\n\n[FAIL] ${event.text}`;
                                                }
                                                break;
                                }

                                this.updateMessageContent(execMsg, fullText);
                                this.scrollToBottom();
                        }

                        this.setExecutionState(abortController.signal.aborted ? 'stopped' : 'complete');

                        // Transition back to idle after a brief delay so the user can
                        // see the final state indicator, then send another message.
                        setTimeout(() => { this.setExecutionState('idle'); }, 1500);

                        // Auto-learn the task completion
                        if (this.constructMemory.config.enabled && this.constructMemory.config.autoLearn) {
                                this.constructMemory.addMemory(`Agent completed task: ${task}`, {
                                        type: 'task_completion',
                                        taskId: this.currentTaskId ?? 'unknown',
                                }).catch(() => { /* non-critical */ });
                        }

                        // Phase 2: Show tool activity log after execution
                        this.renderToolActivityLog();

                } catch (error) {
                        this.setExecutionState('error');
                        const msg = error instanceof Error ? error.message : String(error);
                        this.updateMessageContent(execMsg, '');
                        // v2.0: render error using shared ErrorState component
                        const errorEl = createErrorState({
                                title: 'Execution failed',
                                detail: msg,
                                recovery: 'The agent encountered an error. Check the log for details, then retry.',
                                onRetry: () => { this.setExecutionState('idle'); },
                                onDismiss: () => { this.setExecutionState('idle'); },
                        });
                        this.messageContainer.appendChild(errorEl);
                        this.logService.error('[AgentView] Execution error:', msg);

                        // Transition back to idle after showing error
                        setTimeout(() => { this.setExecutionState('idle'); }, 5000);
                } finally {
                        // BUG 6 FIX: Clean up cancellation state to prevent stale references
                        this.currentCancellationToken?.dispose();
                        this.currentCancellationToken = null;
                        this._abortController = null;
                }
        }

        // --- UI Helpers ---

        private addUserMessage(text: string): void {
                const msg = dom.$('.kovix-msg.kovix-msg--user');
                const row = dom.$('.kovix-msg__row');
                const avatar = dom.$('.kovix-msg__avatar.kovix-msg__avatar--user');
                avatar.textContent = 'U';
                const body = dom.$('.kovix-msg__body');
                const head = dom.$('.kovix-msg__head');
                const author = dom.$('.kovix-msg__author');
                author.textContent = 'You';
                head.appendChild(author);
                const bubble = dom.$('.kovix-msg__bubble');
                bubble.textContent = text;
                body.appendChild(head);
                body.appendChild(bubble);
                row.appendChild(avatar);
                row.appendChild(body);
                msg.appendChild(row);
                this.messageContainer.appendChild(msg);
                this.scrollToBottom();
        }

        private addAgentMessage(text: string, type: 'info' | 'error' | 'streaming' = 'info'): HTMLElement {
                const msg = dom.$('.kovix-msg.kovix-msg--agent');
                const row = dom.$('.kovix-msg__row');
                const avatar = dom.$('.kovix-msg__avatar.kovix-msg__avatar--agent');
                avatar.textContent = 'K';
                const body = dom.$('.kovix-msg__body');
                const head = dom.$('.kovix-msg__head');
                const author = dom.$('.kovix-msg__author');
                author.textContent = 'Kovix Agent';
                const status = dom.$('.kovix-msg__status');
                const statusClass = type === 'error' ? 'kovix-msg__status--error'
                        : type === 'streaming' ? 'kovix-msg__status--working'
                        : 'kovix-msg__status--done';
                status.classList.add(statusClass);
                status.textContent = type === 'error' ? 'ERROR'
                        : type === 'streaming' ? 'WORKING'
                        : 'DONE';
                head.appendChild(author);
                head.appendChild(status);
                const bubble = dom.$('.kovix-msg__bubble');
                // v2.0: error bubbles get the error token via CSS class, not inline style
                if (type === 'error') { bubble.classList.add('kovix-msg__bubble--error'); }
                bubble.textContent = text;
                body.appendChild(head);
                body.appendChild(bubble);
                row.appendChild(avatar);
                row.appendChild(body);
                msg.appendChild(row);
                this.messageContainer.appendChild(msg);
                this.scrollToBottom();
                return bubble;
        }

        private updateMessageContent(element: HTMLElement, text: string): void {
                element.textContent = text;
        }

        private setExecutionState(state: ExecutionState): void {
                this.executionState = state;
                this.updateStatusIndicator();

                const isRunning = state === 'planning' || state === 'executing' || state === 'verifying';
                this.sendBtn.style.display = isRunning ? 'none' : 'inline-block';
                this.stopBtn.style.display = isRunning ? 'inline-block' : 'none';
                this.inputBox.disabled = isRunning;

                // ── Kovix brand: shift status bar to solid Volt-500 while the agent is
                // actively running. This is the highest-frequency brand touchpoint a user
                // sees — it should feel alive, not decorative. The CSS class is defined
                // in kovix-tokens.css and toggled here for the duration of the run only.
                const isAgentRunning = state === 'planning' || state === 'refining' || state === 'executing' || state === 'verifying';
                const statusbar = document.querySelector('.monaco-workbench .part.statusbar');
                if (statusbar) {
                        statusbar.classList.toggle('kovix-status-running', isAgentRunning);
                        // Phase 3.1 — Verifying state gets a distinct class so the status
                        // bar can shift to a slightly different shade (Ignite-orange tint)
                        // to signal "harness is checking the agent's work" vs "agent is running".
                        statusbar.classList.toggle('kovix-status-verifying', state === 'verifying');
                }

                if (state === 'idle') {
                        this.inputBox.placeholder = 'Ask anything, @ to mention, / for actions';
                        // Clean up progress panel
                        if (this.progressPanel) {
                                this.progressPanel.dispose();
                                this.progressPanel = undefined as any;
                        }
                } else if (state === 'planning') {
                        this.inputBox.placeholder = 'Planning...';
                } else if (state === 'executing') {
                        this.inputBox.placeholder = 'Executing...';
                } else if (state === 'verifying') {
                        // Phase 3.1 — distinct placeholder so the user knows the harness
                        // (not the agent) is in control.
                        this.inputBox.placeholder = 'Verifying — running real check...';
                } else if (state === 'awaiting_approval') {
                        this.inputBox.placeholder = 'Awaiting approval...';
                }
        }

        private updateStatusIndicator(): void {
                const stateConfig: Record<ExecutionState, { text: string; cls: string; barCls: string }> = {
                        idle: { text: 'READY', cls: 'kovix-msg__status--done', barCls: 'is-idle' },
                        planning: { text: 'PLANNING', cls: 'kovix-msg__status--thinking', barCls: 'is-planning' },
                        refining: { text: 'REFINING', cls: 'kovix-msg__status--thinking', barCls: 'is-refining' },
                        awaiting_approval: { text: 'AWAITING APPROVAL', cls: 'kovix-msg__status--awaiting', barCls: 'is-awaiting' },
                        executing: { text: 'EXECUTING', cls: 'kovix-msg__status--working', barCls: 'is-executing' },
                        // Phase 3.1 — Verifying chip. Distinct from executing so the user can
                        // see "the harness is checking the agent's work" vs "the agent is running".
                        // Uses the same working animation but a different label.
                        verifying: { text: 'VERIFYING', cls: 'kovix-msg__status--working', barCls: 'is-verifying' },
                        // Phase 3.1 — VerificationFailed. Distinct from generic error so the
                        // user can see "the agent said done but the test disagreed" — this is
                        // a trust signal, not just a crash.
                        verification_failed: { text: 'VERIFICATION FAILED', cls: 'kovix-msg__status--error', barCls: 'is-verification-failed' },
                        paused_at_milestone: { text: 'PAUSED AT MILESTONE', cls: 'kovix-msg__status--awaiting', barCls: 'is-paused' },
                        complete: { text: 'COMPLETE', cls: 'kovix-msg__status--done', barCls: 'is-complete' },
                        error: { text: 'ERROR', cls: 'kovix-msg__status--error', barCls: 'is-error' },
                        stopped: { text: 'STOPPED', cls: 'kovix-msg__status--error', barCls: 'is-idle' },
                };
                const config = stateConfig[this.executionState] ?? stateConfig.idle;
                this.statusIndicator.className = `kovix-msg__status ${config.cls}`;
                this.statusIndicator.textContent = config.text;

                // v2.0: Drive the persistent status bar with the same state.
                if (this.statusBarEl) {
                        // Clear all is-* classes, then add the current one
                        this.statusBarEl.classList.remove('is-idle', 'is-planning', 'is-executing', 'is-refining', 'is-paused', 'is-awaiting', 'is-complete', 'is-error', 'is-verifying', 'is-verification-failed');
                        this.statusBarEl.classList.add(config.barCls);
                        if (this.statusBarLabelEl) { this.statusBarLabelEl.textContent = config.text; }
                        if (this.statusBarTaskEl) {
                                this.statusBarTaskEl.textContent = this.currentTaskId ? `· ${this.currentTaskId}` : '';
                        }
                }

                if (this.agentSublineEl) {
                        const modelName = this.currentModelInfo.name ?? 'No Model';
                        const mode = (this.modeBadgeEl?.textContent ?? 'GENERAL').toLowerCase();
                        const provider = this.currentModelInfo.isLocal ? 'local' : 'cloud';
                        // P2-3: update the three clickable segments individually
                        // rather than replacing the whole subline string.
                        if (this.agentSublineModeEl) { this.agentSublineModeEl.textContent = mode; }
                        if (this.agentSublineProviderEl) { this.agentSublineProviderEl.textContent = provider; }
                        if (this.agentSublineModelEl) { this.agentSublineModelEl.textContent = modelName; }
                }
        }

        private getActionIcon(action: string): string {
                const icons: Record<string, string> = {
                        Read: '[READ]',
                        Create: '[CREATE]',
                        Edit: '[EDIT]',
                        Run: '[RUN]',
                };
                return icons[action] ?? '\u2022';
        }

        private scrollToBottom(): void {
                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
        }

        /**
         * Phase 4: Clear all messages and reset to welcome state.
         */
        private clearMessages(): void {
                this.messageContainer.replaceChildren();
                this.messageCount = 0;
                this.currentTaskId = null;
                this.pendingDiffs = [];
                this.diffCounter = 0;
                this.toolLogEntries = [];
                this.toolLogContainer = null;

                this.agentLoop.clearConversationHistory();

                // Re-render welcome message (Kovix v1.3.0 class-based)
                const welcome = dom.$('.kovix-welcome');
                const logo = dom.$('.kovix-welcome__logo');
                logo.textContent = '\u2B21';
                const title = dom.$('.kovix-welcome__title');
                title.textContent = 'Kovix Agent';
                const subtitle = dom.$('.kovix-welcome__subtitle');
                subtitle.textContent = 'Your AI pair programmer with its own OS';
                const statusEl = dom.$('.kovix-msg__status.kovix-msg__status--done');
                statusEl.textContent = 'READY';
                const hint = dom.$('.kovix-welcome__hint');
                hint.innerHTML = '<kbd>Ctrl+Shift+K</kbd> focus panel &nbsp;\u00b7&nbsp; <kbd>Ctrl+Shift+I</kbd> inline edit &nbsp;\u00b7&nbsp; <kbd>Ctrl+Shift+P</kbd> commands';
                welcome.appendChild(logo);
                welcome.appendChild(title);
                welcome.appendChild(subtitle);
                welcome.appendChild(statusEl);
                welcome.appendChild(hint);
                this.messageContainer.appendChild(welcome);

                this.setExecutionState('idle');
                this.updateClearBtnVisibility();
        }

        /**
         * Phase 4: Show clear button only when messages exist beyond the welcome.
         */
        private updateClearBtnVisibility(): void {
                if (!this.clearBtn) { return; }
                const hasMessages = this.messageContainer.querySelectorAll('.kovix-msg').length > 0;
                this.clearBtn.style.display = hasMessages ? 'inline-block' : 'none';
        }

        /**
         * Refresh the file explorer to show newly created/modified files.
         * Uses multiple fallback strategies for reliability.
         */
        private async refreshFileExplorer(): Promise<void> {
                try {
                        await this.commandService.executeCommand('workbench.files.action.refreshFilesExplorer');
                } catch {
                        // Fallback: stat the workspace root to trigger file watcher
                        try {
                                const rootUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                                if (rootUri) {
                                        await this.fileService.stat(rootUri);
                                }
                        } catch {
                                // Non-critical -- file explorer will refresh eventually via watchers
                        }
                }
        }

        protected override layoutBody(height: number, width: number): void {
                // Layout handled by flexbox
        }

        // --- Phase 2: Model Picker Methods ---

        private refreshModelPickerInfo(): void {
                const model = this.aiService.getActiveModel();
                const providerType = this.aiService.activeProviderType;
                const isLocal = this.aiService.isOffline();

                this.currentModelInfo = {
                        name: model?.displayName ?? 'No Model',
                        providerType,
                        isLocal,
                };
                this.updateModelPickerLabel();
        }

        private updateModelPickerLabel(): void {
                if (!this.modelPickerBtn) { return; }
                const isLocal = this.currentModelInfo.isLocal;
                const dotCls = isLocal ? 'kovix-model-pill__dot is-local' : 'kovix-model-pill__dot is-cloud';
                const modelLabel = this.currentModelInfo.name ?? 'No Model';
                const typeLabel = this.currentModelInfo.providerType ?? 'none';
                this.modelPickerBtn.innerHTML = '';
                const dot = dom.$(`.${dotCls.replace(/\s+/g, '.')}`);
                const label = document.createElement('span');
                label.textContent = `${modelLabel} \u00b7 ${typeLabel}`;
                const chevron = dom.$('.kovix-model-pill__chevron');
                chevron.textContent = '\u25BE';
                this.modelPickerBtn.appendChild(dot);
                this.modelPickerBtn.appendChild(label);
                this.modelPickerBtn.appendChild(chevron);
        }

        /** Scan the input textarea for @file and #tag chips and render them above the input. */
        private scanInputForChips(): void {
                if (!this.chipsRowEl) { return; }
                const text = this.inputBox.value;
                const matches = text.match(/(@[\w./_-]+|#[\w-]+)/g) ?? [];
                const current = new Set(matches);
                const existing = new Set(Array.from(this.chipsRowEl.querySelectorAll<HTMLElement>('.kovix-chip')).map(c => c.dataset.token ?? ''));
                for (const chip of Array.from(this.chipsRowEl.querySelectorAll<HTMLElement>('.kovix-chip'))) {
                        if (!current.has(chip.dataset.token ?? '')) { chip.remove(); }
                }
                for (const tok of current) {
                        if (!existing.has(tok)) {
                                const chip = dom.$('.kovix-chip');
                                chip.classList.add(tok.startsWith('@') ? 'kovix-chip--file' : 'kovix-chip--tag');
                                chip.dataset.token = tok;
                                chip.textContent = tok;
                                const close = dom.$('.kovix-chip__close');
                                close.textContent = '\u00d7';
                                close.onclick = () => {
                                        this.inputBox.value = this.inputBox.value.replace(tok, '').replace(/\s+/, ' ').trim();
                                        chip.remove();
                                        this.scanInputForChips();
                                };
                                chip.appendChild(close);
                                this.chipsRowEl.appendChild(chip);
                        }
                }
        }

        private clearChips(): void {
                if (this.chipsRowEl) { this.chipsRowEl.replaceChildren(); }
        }

        // --- Phase 2: Context Gathering ---

        private gatherContext(): string {
                switch (this.contextScope) {
                        case 'currentFile': {
                                const editor = this.codeEditorService.getActiveCodeEditor();
                                if (!editor) { return ''; }
                                const model = editor.getModel();
                                if (!model) { return ''; }
                                const fileName = model.uri.path.split('/').pop() ?? 'unknown';
                                const content = model.getValue();
                                // Limit to first 3000 chars to avoid overwhelming context
                                const truncated = content.length > 3000
                                        ? content.substring(0, 3000) + '\n... (truncated)'
                                        : content;
                                return `[File: ${fileName}]\n${truncated}`;
                        }
                        case 'selectedText': {
                                const editor = this.codeEditorService.getActiveCodeEditor();
                                if (!editor) { return ''; }
                                const selection = editor.getSelection();
                                if (!selection || selection.isEmpty()) { return ''; }
                                return editor.getModel()?.getValueInRange(selection) ?? '';
                        }
                        case 'workspace':
                                // Workspace context is handled by the agent loop itself
                                return '';
                        default:
                                return '';
                }
        }

        // --- Phase 2: Tool Activity Log ---

        private renderToolActivityLog(): void {
                if (this.toolLogEntries.length === 0) { return; }

                // Remove previous log if any
                this.toolLogContainer?.remove();

                // v2.0: use .kovix-msg--tool class from kovixAgentV2.css
                // (left-border accent card, monospace, teal tool name)
                this.toolLogContainer = dom.$('.kovix-msg--tool.construct-tool-log');

                // Header with toggle
                const header = dom.$('.construct-tool-log-header');
                header.textContent = `\uD83D\uDD27 Tool Activity (${this.toolLogEntries.length} calls)`;

                const toggle = dom.$('.construct-tool-log-toggle');
                toggle.textContent = this.toolLogCollapsed ? '[+]' : '[-]';

                header.appendChild(toggle);

                // Body
                const body = dom.$('.construct-tool-log-body');
                if (this.toolLogCollapsed) { body.style.display = 'none'; }

                for (const entry of this.toolLogEntries) {
                        const row = dom.$('.construct-tool-log-entry');
                        const statusIcon = entry.success ? '\u2705' : '\u274C';
                        const duration = entry.durationMs > 1000
                                ? `${(entry.durationMs / 1000).toFixed(1)}s`
                                : `${entry.durationMs}ms`;
                        row.textContent = `${statusIcon} ${entry.toolName}${entry.target ? ': ' + entry.target : ''} (${duration})`;
                        body.appendChild(row);
                }

                header.onclick = () => {
                        this.toolLogCollapsed = !this.toolLogCollapsed;
                        body.style.display = this.toolLogCollapsed ? 'none' : 'block';
                        toggle.textContent = this.toolLogCollapsed ? '[+]' : '[-]';
                };

                this.toolLogContainer.appendChild(header);
                this.toolLogContainer.appendChild(body);
                this.messageContainer.appendChild(this.toolLogContainer);
                this.scrollToBottom();
        }

        // --- Phase 2: Diff Viewer ---

        private showPendingDiff(filePath: string, changeType: 'write' | 'edit'): void {
                const diffId = `diff-${++this.diffCounter}`;

                // v2.0: use .construct-diff class from kovixAgentV2.css
                const diffContainer = dom.$(`.construct-diff.construct-diff-${diffId}`);

                // File path header
                const pathHeader = dom.$('.construct-diff-path');
                const changeLabel = changeType === 'write' ? '[NEW]' : '[EDIT]';
                pathHeader.textContent = `${changeLabel} ${filePath}`;

                // Content area (async loaded)
                const contentArea = dom.$('.construct-diff-content');
                contentArea.textContent = 'Loading file content...';

                // Load file content via diffApplier
                this.diffApplier.readFile(filePath).then(content => {
                        const truncated = content.length > 2000
                                ? content.substring(0, 2000) + '\n... (truncated)'
                                : content;
                        contentArea.textContent = truncated;
                        // Store the content in the pending diff entry
                        const entry = this.pendingDiffs.find(d => d.id === diffId);
                        if (entry) { entry.content = content; }
                }).catch(() => {
                        contentArea.textContent = '(Unable to read file content)';
                });

                // v2.0: use shared createButton for diff accept/reject
                const btnRow = dom.$('.construct-diff-buttons');

                const acceptBtn = createButton({
                        label: '\u2705 Accept',
                        variant: 'primary',
                        ariaLabel: 'Accept this diff',
                });
                acceptBtn.style.fontSize = '11px';
                acceptBtn.style.padding = '4px 12px';

                const rejectBtn = createButton({
                        label: '\u274C Reject',
                        variant: 'ghost',
                        ariaLabel: 'Reject this diff',
                });
                rejectBtn.style.fontSize = '11px';
                rejectBtn.style.padding = '4px 12px';

                acceptBtn.onclick = () => {
                        const entry = this.pendingDiffs.find(d => d.id === diffId);
                        if (entry) { entry.accepted = true; }
                        diffContainer.style.borderLeft = '3px solid var(--kovix-state-running)';
                        acceptBtn.disabled = true;
                        rejectBtn.disabled = true;
                        acceptBtn.style.opacity = '0.5';
                        rejectBtn.style.opacity = '0.5';
                        // P0-5 FIX: Accept the pending change (writes to disk)
                        const fileUri = URI.file(filePath);
                        this.pendingChangesService.accept(fileUri).then(() => {
                                this.notificationService.info(`Accepted change: ${filePath}`);
                        }).catch((err: unknown) => {
                                this.logService.error('[AgentView] Failed to accept change:', err);
                                this.notificationService.error(`Failed to accept change: ${err instanceof Error ? err.message : String(err)}`);
                        });
                };

                rejectBtn.onclick = () => {
                        const entry = this.pendingDiffs.find(d => d.id === diffId);
                        if (entry) { entry.accepted = false; }
                        diffContainer.style.borderLeft = '3px solid var(--kovix-state-error)';
                        acceptBtn.disabled = true;
                        rejectBtn.disabled = true;
                        acceptBtn.style.opacity = '0.5';
                        rejectBtn.style.opacity = '0.5';
                        // P0-5 FIX: Reject the pending change (discards in memory, no disk write)
                        const fileUri = URI.file(filePath);
                        this.pendingChangesService.reject(fileUri).then(() => {
                                this.notificationService.info(`Rejected change: ${filePath}`);
                        }).catch((err: unknown) => {
                                this.logService.error('[AgentView] Failed to reject change:', err);
                                this.notificationService.error(`Failed to reject change: ${err instanceof Error ? err.message : String(err)}`);
                        });
                };

                btnRow.appendChild(acceptBtn);
                btnRow.appendChild(rejectBtn);

                diffContainer.appendChild(pathHeader);
                diffContainer.appendChild(contentArea);
                diffContainer.appendChild(btnRow);

                this.messageContainer.appendChild(diffContainer);

                // Track pending diff
                this.pendingDiffs.push({
                        id: diffId,
                        filePath,
                        content: '',
                        originalContent: null, // Will be populated when diff content arrives
                        changeType,
                        element: diffContainer,
                        accepted: false,
                });

                this.scrollToBottom();
        }

        /**
         * Accept all pending diffs via PendingChangesService.
         * P0-5 FIX: Changes are now written to disk only upon explicit accept.
         */
        async acceptAllPendingDiffs(): Promise<void> {
                // Delegate to PendingChangesService which writes to disk
                await this.pendingChangesService.acceptAll();
                // Clean up UI elements
                for (const diff of this.pendingDiffs) {
                        diff.element.remove();
                }
                this.pendingDiffs = [];
        }

        /**
         * Reject all pending diffs via PendingChangesService.
         * P0-5 FIX: Rejecting discards in-memory changes; disk is never modified.
         */
        async rejectAllPendingDiffs(): Promise<void> {
                // Delegate to PendingChangesService which discards in-memory entries
                await this.pendingChangesService.rejectAll();
                // Clean up UI elements
                for (const diff of this.pendingDiffs) {
                        diff.element.remove();
                }
                this.pendingDiffs = [];
        }

        // --- Idea Refinement Flow ---

        private async runRefinementFlow(idea: string): Promise<void> {
                this.setExecutionState('refining');
                try {
                        const questions = await this.ideaRefinementService.startRefinement(idea);
                        if (questions.length === 0) {
                                // No questions - go straight to planning
                                this.setExecutionState('idle');
                                const contextText = this.gatherContext();
                                const taskWithContext = contextText ? `${idea}\n\n[Context (${this.contextScope})]:\n${contextText}` : idea;
                                this.toolLogEntries = [];
                                await this.runPlanActFlow(taskWithContext);
                                return;
                        }
                        this.renderRefinementQuestions(questions, idea);
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.addAgentMessage(`[Refinement Error] ${msg}. Proceeding to planning...`, 'error');
                        this.setExecutionState('idle');
                        const contextText = this.gatherContext();
                        const taskWithContext = contextText ? `${idea}\n\n[Context (${this.contextScope})]:\n${contextText}` : idea;
                        this.toolLogEntries = [];
                        await this.runPlanActFlow(taskWithContext);
                }
        }

        private renderRefinementQuestions(questions: IRefinementQuestion[], idea: string): void {
                const container = dom.$('.construct-refinement');
                container.style.cssText = `
                        background: var(--kovix-bg-raised); border: 1px solid var(--kovix-border);
                        border-radius: 6px; padding: 12px; margin: 8px 0;
                `;

                const header = dom.$('.construct-refinement-header');
                header.style.cssText = `font-weight: 600; color: var(--kovix-text-primary); margin-bottom: 10px; font-size: 13px;`;
                header.textContent = `\uD83D\uDCA1 Idea Refinement \u2014 ${questions.length} questions`;
                container.appendChild(header);

                const answers: Map<string, string> = new Map();

                for (const q of questions) {
                        const qCard = dom.$('.construct-refinement-question');
                        qCard.style.cssText = `
                                background: var(--kovix-bg-ink); border: 1px solid var(--kovix-border);
                                border-radius: 4px; padding: 8px 10px; margin-bottom: 8px;
                        `;

                        const categoryBadge = dom.$('.construct-refinement-category');
                        categoryBadge.style.cssText = `
                                font-size: 10px; background: var(--kovix-bg-raised); color: var(--kovix-volt-400);
                                border-radius: 3px; padding: 1px 6px; display: inline-block; margin-bottom: 4px;
                        `;
                        categoryBadge.textContent = q.category;

                        const qText = dom.$('.construct-refinement-text');
                        qText.style.cssText = `font-size: 12px; color: var(--kovix-text-primary); margin-bottom: 6px;`;
                        qText.textContent = q.text;

                        const input = document.createElement('input');
                        input.type = 'text';
                        input.placeholder = q.suggestions?.[0] ?? 'Your answer...';
                        input.style.cssText = `
                                width: 100%; background: var(--kovix-bg-ink); border: 1px solid var(--kovix-border);
                                border-radius: 3px; padding: 6px 8px; color: var(--kovix-text-primary);
                                font-size: 12px; outline: none; box-sizing: border-box;
                        `;
                        input.oninput = () => { answers.set(q.id, input.value); };

                        qCard.appendChild(categoryBadge);
                        qCard.appendChild(qText);
                        qCard.appendChild(input);

                        // Suggestion chips
                        if (q.suggestions && q.suggestions.length > 0) {
                                const chipContainer = dom.$('.construct-refinement-chips');
                                chipContainer.style.cssText = `display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;`;
                                for (const suggestion of q.suggestions.slice(0, 3)) {
                                        const chip = dom.$('button') as HTMLButtonElement;
                                        chip.textContent = suggestion;
                                        chip.style.cssText = `
                                                background: var(--kovix-bg-raised); border: 1px solid var(--kovix-border); border-radius: 12px;
                                                color: var(--kovix-text-primary); font-size: 10px; padding: 2px 8px; cursor: pointer;
                                        `;
                                        chip.onclick = () => {
                                                input.value = suggestion;
                                                answers.set(q.id, suggestion);
                                        };
                                        chipContainer.appendChild(chip);
                                }
                                qCard.appendChild(chipContainer);
                        }

                        container.appendChild(qCard);
                }

                // Action buttons
                const btnContainer = dom.$('.construct-refinement-buttons');
                btnContainer.style.cssText = `display: flex; gap: 8px; margin-top: 8px;`;

                const submitBtn = dom.$('button') as HTMLButtonElement;
                submitBtn.textContent = 'Submit Answers';
                submitBtn.style.cssText = `
                        background: var(--kovix-volt-400); color: var(--kovix-bg-ink); border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;

                const skipBtn = dom.$('button') as HTMLButtonElement;
                skipBtn.textContent = 'Skip to Planning';
                skipBtn.style.cssText = `
                        background: var(--kovix-bg-raised); border: 1px solid var(--kovix-border); color: var(--kovix-text-primary);
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px;
                `;

                submitBtn.onclick = async () => {
                        container.remove();
                        const refinementAnswers: IRefinementAnswer[] = questions.map(q => ({
                                questionId: q.id,
                                text: answers.get(q.id) ?? '',
                                skipped: !answers.has(q.id),
                        }));
                        await this.handleRefinementAnswers(refinementAnswers, idea);
                };

                skipBtn.onclick = async () => {
                        container.remove();
                        try {
                                const refinedIdea = await this.ideaRefinementService.skipToRefinedIdea();
                                this.proceedWithRefinedIdea(refinedIdea, idea);
                        } catch {
                                this.setExecutionState('idle');
                                const contextText = this.gatherContext();
                                const taskWithContext = contextText ? `${idea}\n\n[Context (${this.contextScope})]:\n${contextText}` : idea;
                                this.toolLogEntries = [];
                                await this.runPlanActFlow(taskWithContext);
                        }
                };

                btnContainer.appendChild(submitBtn);
                btnContainer.appendChild(skipBtn);
                container.appendChild(btnContainer);

                this.messageContainer.appendChild(container);
                this.scrollToBottom();
        }

        private async handleRefinementAnswers(answers: IRefinementAnswer[], idea: string): Promise<void> {
                this.addAgentMessage('\u23F3 Processing your answers...', 'info');
                try {
                        const result = await this.ideaRefinementService.submitAnswers(answers);
                        if (result.type === 'questions') {
                                this.renderRefinementQuestions(result.questions, idea);
                        } else {
                                this.proceedWithRefinedIdea(result.refinedIdea, idea);
                        }
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.addAgentMessage(`[Refinement Error] ${msg}. Proceeding with original idea...`, 'error');
                        this.setExecutionState('idle');
                        const contextText = this.gatherContext();
                        const taskWithContext = contextText ? `${idea}\n\n[Context (${this.contextScope})]:\n${contextText}` : idea;
                        this.toolLogEntries = [];
                        await this.runPlanActFlow(taskWithContext);
                }
        }

        private async proceedWithRefinedIdea(refinedIdea: IRefinedIdea, originalIdea: string): Promise<void> {
                const summaryEl = dom.$('.construct-refined-summary');
                summaryEl.style.cssText = `
                        background: var(--kovix-bg-raised); border: 1px solid var(--kovix-volt-400);
                        border-radius: 6px; padding: 12px; margin: 8px 0;
                `;
                summaryEl.innerHTML = `
                        <div style="font-weight:600;color:var(--kovix-text-primary);margin-bottom:6px;font-size:13px">\u2705 Refined Idea</div>
                        <div style="font-size:12px;color:var(--kovix-text-secondary);margin-bottom:8px">${this.escapeHtml(refinedIdea.refinedDescription)}</div>
                        <div style="font-size:11px;color:var(--kovix-volt-400)">Confidence: ${Math.round(refinedIdea.confidence * 100)}%</div>
                `;
                this.messageContainer.appendChild(summaryEl);
                this.scrollToBottom();

                // Use refined idea for planning
                this.setExecutionState('idle');
                this.toolLogEntries = [];
                await this.runPlanActFlow(refinedIdea.refinedDescription);
        }

        // --- Milestone Pause Controls ---

        private renderMilestonePauseControls(milestone: IMilestone): void {
                // v2.0: uses .kovix-milestone-pause CSS classes from kovixAgentV2.css
                // and the shared createButton factory from the component library.
                // Zero inline styles, zero hardcoded hex.
                const container = dom.$('.kovix-milestone-pause');

                const header = dom.$('.kovix-milestone-pause__header');
                const icon = dom.$('.kovix-milestone-pause__icon');
                icon.textContent = '\u23F8';
                const title = dom.$('.kovix-milestone-pause__title');
                title.textContent = 'Paused at:';
                const name = dom.$('.kovix-milestone-pause__name');
                name.textContent = milestone.name;
                header.appendChild(icon);
                header.appendChild(title);
                header.appendChild(name);
                container.appendChild(header);

                const body = dom.$('.kovix-milestone-pause__body');
                body.textContent = milestone.description;
                container.appendChild(body);

                const actions = dom.$('.kovix-milestone-pause__actions');

                const continueBtn = createButton({
                        label: '\u25B6 Continue',
                        variant: 'primary',
                        ariaLabel: 'Continue from milestone',
                        onClick: () => {
                                container.remove();
                                this.agentLoop.resumeFromMilestone();
                                this.setExecutionState('executing');
                        },
                });

                const skipBtn = createButton({
                        label: '\u23ED Skip',
                        variant: 'secondary',
                        ariaLabel: 'Skip this milestone',
                        onClick: () => {
                                container.remove();
                                this.agentLoop.skipCurrentMilestone();
                                this.setExecutionState('executing');
                        },
                });

                const stopBtn = createButton({
                        label: '\u25A0 Stop',
                        variant: 'destructive',
                        ariaLabel: 'Stop agent execution',
                        onClick: () => {
                                container.remove();
                                if (this._abortController) {
                                        this._abortController.abort();
                                        this._abortController = null;
                                }
                                this.setExecutionState('idle');
                        },
                });

                actions.appendChild(continueBtn);
                actions.appendChild(skipBtn);
                actions.appendChild(stopBtn);
                container.appendChild(actions);

                this.messageContainer.appendChild(container);
                this.scrollToBottom();
        }

        // --- Session History ---

        private async showSessionHistory(): Promise<void> {
                const sessions = this.sessionService.sessions;
                if (sessions.length === 0) {
                        this.notificationService.info('No previous sessions found.');
                        return;
                }

                const picks = sessions.map(s => ({
                        label: s.title,
                        description: `${s.messageCount} messages`,
                        detail: `Last active: ${new Date(s.lastActiveAt).toLocaleString()}`,
                        sessionId: s.id,
                }));

                const pick = await this.quickInputService.pick(picks, {
                        placeHolder: 'Select a session to restore...',
                        title: 'Session History',
                });

                if (pick) {
                        await this.sessionService.switchToSession((pick as any).sessionId);
                        // F-006 (#97): the session service stores metadata only (title, message
                        // count, timestamps) — it does not persist the conversation messages.
                        // Switching sessions updates the active session pointer but does not
                        // restore the chat view, because there are no messages to restore.
                        // Closing #97 as wontfix — message persistence is a separate feature
                        // (see #74, fixed-by-deletion of the unused SQLite service).
                        this.notificationService.info(`Switched to session: ${pick.label}. (Messages from this session are not persisted — start a new chat to begin a fresh conversation.)`);
                }
        }

        // --- Utility ---

        private escapeHtml(text: string): string {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
        }
}
