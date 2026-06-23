/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * KovixAgentSettings — the unified settings pane for everything agent-related.
 *
 * Six tabs, all rendered as native DOM inside a ViewPane (so it lives in the
 * Kovix auxiliary bar alongside Agent / Memory / Memory Graph / Control Center):
 *
 *   1. SKILLS      — list, enable/disable, create-from-document, import-from-URL,
 *                    delete, reveal-in-explorer, "convert any document into a skill"
 *   2. MEMORY      — privacy posture (auto-remember, PII scrub, retention,
 *                    scope, network sync, telemetry), forget-everything, open graph
 *   3. MCP         — installed servers, start/stop, browse marketplace, install
 *   4. API KEYS    — provider picker, key entry, validate, activate, test, models
 *   5. SWARM       — spawn N workers with role assignments, monitor live
 *   6. AUTONOMOUS  — idea→app wizard entry point + autonomous-mode toggles
 *                    (milestone gates, max rounds, auto-approve, ponytail enforcement)
 */

import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import * as dom from '../../../../base/browser/dom.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';

import { ISkillRegistry, IKovixSkill } from '../../../../platform/construct/common/skills/skillRegistry.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPMarketplace } from '../../../../platform/construct/common/mcp/mcpMarketplace.js';
import { IConstructMemoryService } from '../../../../platform/construct/common/memory/constructMemory.js';
import { IAgentModeService } from './services/agent/agentModeService.js';
import { describePrivacyPosture, DEFAULT_PRIVACY_CONFIG, IMemoryPrivacyConfig } from './services/memory/memoryPrivacy.js';

import './media/kovixAgentSettings.css';

type TabId = 'skills' | 'memory' | 'mcp' | 'apikeys' | 'swarm' | 'autonomous';

interface ITabDef {
        id: TabId;
        label: string;
        icon: string; // codicon name
}

const TABS: ITabDef[] = [
        { id: 'skills', label: 'Skills', icon: 'spark' },
        { id: 'memory', label: 'Memory', icon: 'database' },
        { id: 'mcp', label: 'MCP Servers', icon: 'plug' },
        { id: 'apikeys', label: 'API Keys', icon: 'key' },
        { id: 'swarm', label: 'Swarm', icon: 'layers' },
        { id: 'autonomous', label: 'Autonomous', icon: 'rocket' },
];

/**
 * SECURITY FIX (M1): Escape HTML metacharacters in dynamic strings before
 * interpolating them into innerHTML template literals.
 *
 * Several places in this file build DOM via `element.innerHTML = \`...${dynamic}...\``
 * where `dynamic` originates from marketplace JSON (item.name / item.author /
 * item.rating — fetched from raw.githubusercontent.com), user-supplied skill
 * metadata (skill.slug / skill.icon / skill.scope — read from SKILL.md files
 * in any cloned repo or ~/.kovix/skills/), MCP server definitions (s.name),
 * and provider config (p.key / p.endpoint). A malicious marketplace entry or
 * a poisoned SKILL.md could ship `"><img src=x onerror=eval(...)>` as the
 * name field and execute arbitrary JS in the Kovix renderer.
 *
 * Defense-in-depth: the webview CSP blocks inline event handlers, but this
 * pane is NOT a webview — it's native DOM in the workbench. There is no CSP
 * here, so escaping is the primary control.
 *
 * The helper escapes the five HTML metacharacters (& < > " '). For values
 * that need to appear inside an attribute, the same escape is sufficient
 * because we always quote attributes with double quotes.
 */
function escapeHtml(s: unknown): string {
        if (s === null || s === undefined) {
                return '';
        }
        return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
}

export class KovixAgentSettingsPane extends ViewPane {

        private root!: HTMLElement;
        private tabbar!: HTMLElement;
        private tabContent!: HTMLElement;
        private currentTab: TabId = 'skills';

        // cached skill list for re-render
        private skillsCache: IKovixSkill[] = [];

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
                @ILogService private readonly logService: ILogService,
                @ICommandService private readonly commandService: ICommandService,
                @INotificationService private readonly notificationService: INotificationService,
                @IQuickInputService private readonly quickInput: IQuickInputService,
                @ISkillRegistry private readonly skillRegistry: ISkillRegistry,
                @IMCPServerManager private readonly mcpManager: IMCPServerManager,
                @IMCPMarketplace private readonly mcpMarketplace: IMCPMarketplace,
                @IConstructMemoryService private readonly memoryService: IConstructMemoryService,
                @IAgentModeService private readonly modeService: IAgentModeService,
        ) {
                super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
                // memoryService is injected for future use (e.g. reading live memory stats
                // in the Memory tab). Referenced via this.memoryService when needed.
                void this.memoryService;
        }

        protected override renderBody(container: HTMLElement): void {
                super.renderBody(container);

                try {
                        this.root = dom.$('.kovix-settings');
                        container.appendChild(this.root);
                        container.style.height = '100%';

                        // --- Header ---
                        const header = dom.$('.kovix-settings__header');
                        const title = dom.$('.kovix-settings__title');
                        title.textContent = 'Agent Settings';
                        const subtitle = dom.$('.kovix-settings__subtitle');
                        subtitle.textContent = 'Skills · Memory · MCP · API Keys · Swarm · Autonomous';
                        header.appendChild(title);
                        header.appendChild(subtitle);
                        this.root.appendChild(header);

                        // --- Tab bar ---
                        this.tabbar = dom.$('.kovix-settings__tabs');
                        for (const tab of TABS) {
                                const btn = dom.$('button.kovix-tab') as HTMLButtonElement;
                                (btn as HTMLElement).dataset.tab = tab.id;
                                btn.innerHTML = `<span class="codicon codicon-${escapeHtml(tab.icon)}"></span> ${escapeHtml(tab.label)}`;
                                btn.onclick = () => this.switchTab(tab.id);
                                if (tab.id === this.currentTab) { btn.classList.add('is-active'); }
                                this.tabbar.appendChild(btn);
                        }
                        this.root.appendChild(this.tabbar);

                        // --- Tab content ---
                        this.tabContent = dom.$('.kovix-settings__content');
                        this.root.appendChild(this.tabContent);

                        // Listen for skill changes
                        this._register(this.skillRegistry.onDidUpdateSkills(skills => {
                                this.skillsCache = skills;
                                if (this.currentTab === 'skills') { this.renderSkillsTab(); }
                        }));

                        // Initial render
                        this.switchTab(this.currentTab);
                } catch (err) {
                        this.logService.error('[KovixAgentSettings] renderBody failed:', err);
                        const errDiv = document.createElement('div');
                        errDiv.style.cssText = 'padding: 16px; color: #ff6b6b; background: #2a1414; border-radius: 6px; margin: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap;';
                        errDiv.textContent = `Agent Settings failed to render:\n${err instanceof Error ? err.stack || err.message : String(err)}`;
                        container.appendChild(errDiv);
                }
        }

        private switchTab(tab: TabId): void {
                this.currentTab = tab;
                // Update tab bar active state
                for (const btn of Array.from(this.tabbar.querySelectorAll('button.kovix-tab'))) {
                        const btnEl = btn as HTMLElement;
                        btnEl.classList.toggle('is-active', btnEl.dataset.tab === tab);
                }
                // Clear and re-render content
                this.tabContent.innerHTML = '';
                switch (tab) {
                        case 'skills': this.renderSkillsTab(); break;
                        case 'memory': this.renderMemoryTab(); break;
                        case 'mcp': this.renderMcPTab(); break;
                        case 'apikeys': this.renderApiKeysTab(); break;
                        case 'swarm': this.renderSwarmTab(); break;
                        case 'autonomous': this.renderAutonomousTab(); break;
                }
        }

        // ============================================================
        //  TAB: Skills
        // ============================================================

        private async renderSkillsTab(): Promise<void> {
                const wrap = dom.$('.kovix-tab-pane');
                const desc = dom.$('.kovix-tab-desc');
                desc.innerHTML = `<strong>Skills</strong> are self-contained, markdown-driven playbooks the agent consults to perform specialised tasks. Drop a <code>SKILL.md</code> into <code>~/.kovix/skills/&lt;slug&gt;/</code> (user-global) or <code>.kovix/skills/&lt;slug&gt;/</code> (project-scoped). The agent auto-discovers relevant skills for every task — you can also invoke one explicitly with <code>/&lt;slug&gt;</code>.`;
                wrap.appendChild(desc);

                // --- Action bar ---
                const actions = dom.$('.kovix-actionbar');
                const createBtn = this.makeBtn('spark', 'Create from Document', 'Convert any markdown / text document into a skill');
                createBtn.onclick = () => this.commandService.executeCommand('kovix.createSkillFromDocument');
                const importBtn = this.makeBtn('cloud-download', 'Import from URL', 'Fetch a raw SKILL.md from a GitHub raw URL');
                importBtn.onclick = () => this.commandService.executeCommand('kovix.importSkillFromUrl');
                const refreshBtn = this.makeBtn('refresh', 'Refresh', 'Reload skills from disk');
                refreshBtn.onclick = async () => { await this.skillRegistry.refresh(); };
                const openFolderBtn = this.makeBtn('folder-opened', 'Open Skills Folder', 'Reveal ~/.kovix/skills/ in the file explorer');
                openFolderBtn.onclick = () => this.commandService.executeCommand('kovix.openSkillsFolder');
                actions.append(createBtn, importBtn, refreshBtn, openFolderBtn);
                wrap.appendChild(actions);

                // --- Skills list ---
                const listHeader = dom.$('.kovix-listheader');
                listHeader.innerHTML = '<span>Installed Skills</span><span class="kovix-muted">click to toggle · double-click to view</span>';
                wrap.appendChild(listHeader);

                try {
                        this.skillsCache = await this.skillRegistry.getAllSkills();
                } catch (err) {
                        this.logService.warn('[KovixAgentSettings] failed to load skills:', err);
                }

                if (this.skillsCache.length === 0) {
                        const empty = dom.$('.kovix-empty');
                        empty.innerHTML = 'No skills installed yet. Click <strong>Create from Document</strong> to make one, or <strong>Import from URL</strong>.';
                        wrap.appendChild(empty);
                } else {
                        for (const skill of this.skillsCache) {
                                wrap.appendChild(this.renderSkillCard(skill));
                        }
                }

                this.tabContent.appendChild(wrap);
        }

        private renderSkillCard(skill: IKovixSkill): HTMLElement {
                const card = dom.$('.kovix-card');
                if (!skill.enabled) { card.classList.add('is-disabled'); }

                const icon = dom.$('.kovix-card__icon');
                icon.innerHTML = `<span class="codicon codicon-${escapeHtml(skill.icon || 'file-code')}"></span>`;

                const body = dom.$('.kovix-card__body');
                const title = dom.$('.kovix-card__title');
                title.innerHTML = `<code>/${escapeHtml(skill.slug)}</code> <span class="kovix-muted">· ${escapeHtml(skill.scope)}</span>`;
                const desc = dom.$('.kovix-card__desc');
                desc.textContent = skill.description;
                const tags = dom.$('.kovix-card__tags');
                for (const t of skill.tags.slice(0, 6)) {
                        const chip = dom.$('span.kovix-chip');
                        chip.textContent = t;
                        tags.appendChild(chip);
                }
                body.append(title, desc, tags);

                const actions = dom.$('.kovix-card__actions');
                const toggle = dom.$('label.kovix-switch');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = skill.enabled;
                cb.onchange = async () => {
                        await this.skillRegistry.setEnabled(skill.slug, cb.checked);
                        this.notificationService.info(`${skill.slug}: ${cb.checked ? 'enabled' : 'disabled'}`);
                };
                toggle.appendChild(cb);
                toggle.appendChild(dom.$('span.kovix-switch__slider'));

                const viewBtn = this.makeIconBtn('eye', 'View body');
                viewBtn.onclick = () => this.commandService.executeCommand('kovix.viewSkill', skill.slug);
                const revealBtn = this.makeIconBtn('folder', 'Reveal in explorer');
                revealBtn.onclick = async () => {
                        try { await this.skillRegistry.revealSkill(skill.slug); }
                        catch (e) { this.notificationService.warn(e instanceof Error ? e.message : String(e)); }
                };
                const delBtn = this.makeIconBtn('trash', 'Delete');
                delBtn.onclick = async () => {
                        if (skill.scope === 'builtin') {
                                this.notificationService.warn('Builtin skills cannot be deleted — disable them instead.');
                                return;
                        }
                        const confirm = await this.quickInput.pick(
                                [{ label: `Delete /${skill.slug}`, description: 'Irreversible' }, { label: 'Cancel' }],
                                { placeHolder: `Delete skill "${skill.slug}"?` },
                        );
                        if (confirm?.label.startsWith('Delete')) {
                                await this.skillRegistry.deleteSkill(skill.slug, skill.scope);
                                this.notificationService.info(`Skill deleted: /${skill.slug}`);
                        }
                };
                actions.append(toggle, viewBtn, revealBtn, delBtn);

                card.append(icon, body, actions);
                return card;
        }

        // ============================================================
        //  TAB: Memory
        // ============================================================

        private renderMemoryTab(): void {
                const wrap = dom.$('.kovix-tab-pane');
                const desc = dom.$('.kovix-tab-desc');
                desc.innerHTML = `<strong>Memory</strong> is the agent's long-term recall. Kovix stores memories locally by default (Obsidian-style). You're in full control — turn auto-remember off, scrub PII, set retention, or wipe everything. Nothing leaves your machine unless you explicitly enable network sync.`;
                wrap.appendChild(desc);

                // Current posture summary
                const cfg = this.readPrivacyConfig();
                const posture = dom.$('.kovix-posture');
                posture.innerHTML = `<span class="codicon codicon-shield"></span> <strong>Current posture:</strong> ${escapeHtml(describePrivacyPosture(cfg))}`;
                wrap.appendChild(posture);

                // Toggles
                wrap.appendChild(this.makeToggle(
                        'kovix.memory.privacy.autoRemember',
                        'Auto-remember everything',
                        'When ON, the agent automatically stores facts from your conversation (file paths, decisions, errors). When OFF, nothing is stored unless you explicitly ask.',
                        cfg.autoRemember,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.memory.privacy.requireExplicitConsent',
                        'Ask before each memory (audit mode)',
                        'When ON, the agent will ask "OK to remember this?" before storing any new memory. Slower, but maximum control.',
                        cfg.requireExplicitConsent,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.memory.privacy.piiScrub',
                        'Scrub PII before storing',
                        'Redacts emails, phone numbers, credit-card-shaped numbers, SSNs, and common API-key shapes before any memory is stored. Strongly recommended.',
                        cfg.piiScrub,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.memory.privacy.redactFileContents',
                        'Never memorise file contents',
                        'Store metadata about files (path, action, timestamp) but never the actual code. Disable only if you want the agent to remember snippets.',
                        cfg.redactFileContents,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.memory.privacy.crossProjectLearning',
                        'Cross-project learning',
                        'When ON, procedural memories (e.g. "how I like my tests structured") are shared across projects. When OFF, each project is its own silo.',
                        cfg.crossProjectLearning,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.memory.privacy.allowNetworkSync',
                        'Allow network sync (Supermemory cloud)',
                        'When ON, memories are synced to Supermemory cloud (if an API key is set). When OFF, all memory operations are local-only.',
                        cfg.allowNetworkSync,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.memory.privacy.telemetryOptOut',
                        'Telemetry opt-out (no memory data leaves machine)',
                        'When ON, no memory-related telemetry is sent anywhere. Kovix never sells or transmits your memories.',
                        cfg.telemetryOptOut,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.memory.privacy.forgetOnWindowClose',
                        'Forget short-term memory on window close',
                        'When ON, working memory is cleared when you close the Kovix window. Long-term memory is preserved.',
                        cfg.forgetOnWindowClose,
                ));

                // Scope selector
                wrap.appendChild(this.makeSelect(
                        'kovix.memory.privacy.scope',
                        'Memory scope',
                        'How wide should memory scope be? Tighter = more privacy.',
                        [
                                { value: 'per-project', label: 'Per project (default)' },
                                { value: 'per-workspace', label: 'Per workspace' },
                                { value: 'global', label: 'Global (all projects)' },
                        ],
                        cfg.scope,
                ));

                // Retention
                wrap.appendChild(this.makeNumber(
                        'kovix.memory.privacy.retentionDays',
                        'Retention (days)',
                        'Memories older than this are automatically forgotten. 1 = ephemeral, 3650 = ~permanent.',
                        cfg.retentionDays, 1, 3650,
                ));

                // Danger zone
                const danger = dom.$('.kovix-dangerzone');
                danger.innerHTML = '<div class="kovix-dangerzone__title">Danger Zone</div>';
                const forgetBtn = this.makeBtn('trash', 'Forget Everything', 'Wipe ALL stored memories. Irreversible.', true);
                forgetBtn.onclick = async () => {
                        const confirm = await this.quickInput.pick(
                                [{ label: 'Yes, forget everything', description: 'Irreversible' }, { label: 'Cancel' }],
                                { placeHolder: 'Forget ALL stored memories? This cannot be undone.' },
                        );
                        if (confirm?.label.startsWith('Yes')) {
                                this.commandService.executeCommand('kovix.forgetAllMemories');
                        }
                };
                danger.appendChild(forgetBtn);
                wrap.appendChild(danger);

                // Memory graph link
                const link = dom.$('.kovix-tablink');
                link.innerHTML = `<span class="codicon codicon-graph"></span> <a href="#">Open Memory Graph</a>`;
                link.querySelector('a')!.onclick = (e) => {
                        e.preventDefault();
                        this.commandService.executeCommand('kovix.openMemoryGraph');
                };
                wrap.appendChild(link);

                this.tabContent.appendChild(wrap);
        }

        // ============================================================
        //  TAB: MCP
        // ============================================================

        private async renderMcPTab(): Promise<void> {
                const wrap = dom.$('.kovix-tab-pane');
                const desc = dom.$('.kovix-tab-desc');
                desc.innerHTML = `<strong>MCP (Model Context Protocol)</strong> servers give the agent extra tools — filesystem access, web search, Figma, GitHub, 21st.dev components, Ponytail, Supermemory, Obsidian, and more. Start/stop servers here, or browse the marketplace to install new ones.`;
                wrap.appendChild(desc);

                // Action bar
                const actions = dom.$('.kovix-actionbar');
                const startBtn = this.makeBtn('play', 'Start Server', 'Start an installed MCP server');
                startBtn.onclick = () => this.commandService.executeCommand('kovix.mcp.startServer');
                const stopBtn = this.makeBtn('debug-stop', 'Stop Server', 'Stop a running MCP server');
                stopBtn.onclick = () => this.commandService.executeCommand('kovix.mcp.stopServer');
                const marketBtn = this.makeBtn('shopping-cart', 'Browse Marketplace', 'Browse the MCP marketplace catalog');
                marketBtn.onclick = () => this.commandService.executeCommand('kovix.mcp.openMarketplace');
                actions.append(startBtn, stopBtn, marketBtn);
                wrap.appendChild(actions);

                // Installed servers
                const listHeader = dom.$('.kovix-listheader');
                listHeader.innerHTML = '<span>Installed Servers</span><span class="kovix-muted">status · tools</span>';
                wrap.appendChild(listHeader);

                try {
                        const servers = this.mcpManager.listInstalledServers();
                        if (servers.length === 0) {
                                const empty = dom.$('.kovix-empty');
                                empty.innerHTML = 'No MCP servers installed. Click <strong>Browse Marketplace</strong> to install 21st.dev, Ponytail, Supermemory, Obsidian, and more.';
                                wrap.appendChild(empty);
                        } else {
                                for (const s of servers) {
                                        const status = this.mcpManager.getServerStatus(s.name);
                                        // SEC-7 (H2 follow-up): Compute approval state.
                                        // Built-ins are always pre-approved; marketplace servers
                                        // require explicit user approval before they can spawn.
                                        const isApproved = !!(s.isBuiltin || s.userApproved);
                                        const card = dom.$('.kovix-card');
                                        const icon = dom.$('.kovix-card__icon');
                                        icon.innerHTML = `<span class="codicon codicon-${status === 'running' ? 'circle-filled' : 'circle-outline'}"></span>`; // status is internal state, no escaping needed
                                        const body = dom.$('.kovix-card__body');
                                        const title = dom.$('.kovix-card__title');
                                        const approvalBadge = isApproved
                                                ? '<span class="kovix-muted">· approved</span>'
                                                : '<span class="kovix-warn" style="color:var(--kovix-warn-500,#f0a020)">· needs approval</span>';
                                        title.innerHTML = `<strong>${escapeHtml(s.name)}</strong> <span class="kovix-muted">· ${escapeHtml(status)}</span> ${approvalBadge}`;
                                        const sub = dom.$('.kovix-card__desc');
                                        sub.textContent = `${s.command} ${(s.args || []).join(' ')}`.slice(0, 120);
                                        body.append(title, sub);

                                        // SEC-7 (H2 follow-up): For unapproved marketplace servers,
                                        // show the env keys (redacted) so the user can review what
                                        // credentials/flags will be passed before approving.
                                        if (!isApproved) {
                                                const envPreview = dom.$('.kovix-card__desc');
                                                const envKeys = Object.keys(s.env ?? {});
                                                const envSummary = envKeys.length === 0
                                                        ? '(no env vars)'
                                                        : envKeys.map(k => k.endsWith('_KEY') || k.endsWith('_TOKEN') || k.includes('SECRET') ? `${k}=<redacted>` : `${k}`).join(', ');
                                                envPreview.textContent = `env: ${envSummary}`;
                                                envPreview.style.fontSize = '11px';
                                                envPreview.style.opacity = '0.7';
                                                body.appendChild(envPreview);
                                        }

                                        card.append(icon, body);

                                        const cardActions = dom.$('.kovix-card__actions');

                                        // SEC-7 (H2 follow-up): Approve button for unapproved
                                        // non-builtin servers. Clicking it calls
                                        // mcpManager.approveServer(name), which persists the
                                        // approval flag and re-renders the tab.
                                        if (!isApproved) {
                                                const approve = this.makeBtn('check', 'Approve', 'Review command/env above, then approve to allow spawning');
                                                approve.onclick = async () => {
                                                        try {
                                                                await this.mcpManager.approveServer(s.name);
                                                                this.notificationService.info(`Approved MCP server: ${s.name}`);
                                                                this.renderMcPTab();
                                                        } catch (e) {
                                                                this.notificationService.error(`Approve failed: ${e instanceof Error ? e.message : String(e)}`);
                                                        }
                                                };
                                                cardActions.appendChild(approve);
                                        }

                                        if (status === 'running') {
                                                const stop = this.makeIconBtn('debug-stop', 'Stop');
                                                stop.onclick = () => this.commandService.executeCommand('kovix.mcp.stopServer');
                                                cardActions.appendChild(stop);
                                        } else if (isApproved) {
                                                // Only show Start if approved; unapproved servers
                                                // get the Approve button instead (clicking Start
                                                // would just fail with the consent-gate error).
                                                const start = this.makeIconBtn('play', 'Start');
                                                start.onclick = () => this.commandService.executeCommand('kovix.mcp.startServer');
                                                cardActions.appendChild(start);
                                        }
                                        card.appendChild(cardActions);
                                        wrap.appendChild(card);
                                }
                        }
                } catch (err) {
                        this.logService.warn('[KovixAgentSettings] MCP list failed:', err);
                }

                // Featured catalog preview
                const featuredHeader = dom.$('.kovix-listheader');
                featuredHeader.innerHTML = '<span>Featured Servers</span><span class="kovix-muted">one-click install</span>';
                wrap.appendChild(featuredHeader);

                try {
                        const featured = await this.mcpMarketplace.getFeaturedServers();
                        for (const item of featured.slice(0, 8)) {
                                const card = dom.$('.kovix-card');
                                const icon = dom.$('.kovix-card__icon');
                                icon.innerHTML = '<span class="codicon codicon-package"></span>';
                                const body = dom.$('.kovix-card__body');
                                const title = dom.$('.kovix-card__title');
                                title.innerHTML = `<strong>${escapeHtml(item.name)}</strong> <span class="kovix-muted">· ${escapeHtml(item.author)} · ★ ${escapeHtml(item.rating)}</span>`;
                                const sub = dom.$('.kovix-card__desc');
                                sub.textContent = item.description.slice(0, 140);
                                body.append(title, sub);
                                card.append(icon, body);

                                const cardActions = dom.$('.kovix-card__actions');
                                const installed = this.mcpMarketplace.isInstalled(item.id);
                                const btn = this.makeBtn(installed ? 'check' : 'cloud-download', installed ? 'Installed' : 'Install', '', installed);
                                if (!installed) {
                                        btn.onclick = async () => {
                                                try {
                                                        await this.mcpMarketplace.installFromMarketplace(item.id);
                                                        this.notificationService.info(`Installed: ${item.name}`);
                                                        this.renderMcPTab();
                                                } catch (e) {
                                                        this.notificationService.error(`Install failed: ${e instanceof Error ? e.message : String(e)}`);
                                                }
                                        };
                                }
                                cardActions.appendChild(btn);
                                card.appendChild(cardActions);
                                wrap.appendChild(card);
                        }
                } catch (err) {
                        this.logService.warn('[KovixAgentSettings] featured fetch failed:', err);
                }

                this.tabContent.appendChild(wrap);
        }

        // ============================================================
        //  TAB: API Keys
        // ============================================================

        private renderApiKeysTab(): void {
                const wrap = dom.$('.kovix-tab-pane');
                const desc = dom.$('.kovix-tab-desc');
                desc.innerHTML = `<strong>API Keys</strong> are stored in your OS keychain (Keychain on macOS, libsecret on Linux, Credential Manager on Windows). Kovix never logs keys, never sends them anywhere except the provider endpoint, and never embeds them in telemetry.`;
                wrap.appendChild(desc);

                const actions = dom.$('.kovix-actionbar');
                const manageBtn = this.makeBtn('key', 'Manage API Keys', 'Open the key manager — add, validate, activate, test');
                manageBtn.onclick = () => this.commandService.executeCommand('kovix.manageApiKeys');
                const switchBtn = this.makeBtn('arrow-swap', 'Switch Provider', 'Switch the active LLM provider');
                switchBtn.onclick = () => this.commandService.executeCommand('kovix.switchProvider.quick');
                const selectBtn = this.makeBtn('list-selection', 'Select Model', 'Pick a model from the active provider');
                selectBtn.onclick = () => this.commandService.executeCommand('kovix.selectModel');
                const testBtn = this.makeBtn('pulse', 'Test Connection', 'Run a minimal API call to verify the active provider');
                testBtn.onclick = () => this.commandService.executeCommand('kovix.testCloudConnection');
                actions.append(manageBtn, switchBtn, selectBtn, testBtn);
                wrap.appendChild(actions);

                // Provider list
                const providers = [
                        { name: 'NVIDIA NIM', key: 'nvapi-', endpoint: 'integrate.api.nvidia.com/v1', models: 'Llama 3.1 70B, Nemotron, Mistral, Qwen, DeepSeek' },
                        { name: 'Anthropic', key: 'sk-ant-', endpoint: 'api.anthropic.com', models: 'Claude Sonnet/Opus/Haiku' },
                        { name: 'OpenAI', key: 'sk-', endpoint: 'api.openai.com', models: 'GPT-4o, GPT-4, GPT-3.5' },
                        { name: 'OpenRouter', key: 'sk-or-', endpoint: 'openrouter.ai', models: 'All major models via one API' },
                        { name: 'Groq', key: 'gsk_', endpoint: 'api.groq.com', models: 'Llama, Mixtral, Gemma (ultra-fast)' },
                        { name: 'Together AI', key: '(any)', endpoint: 'api.together.xyz', models: 'Llama, Qwen, etc.' },
                        { name: 'Mistral', key: '(any)', endpoint: 'api.mistral.ai', models: 'Mistral Large, Codestral, Mixtral' },
                        { name: 'Google Gemini', key: 'AIza…', endpoint: 'generativelanguage.googleapis.com', models: 'Gemini 1.5/2.0 Pro/Flash' },
                        { name: 'DeepSeek', key: '(any)', endpoint: 'api.deepseek.com', models: 'DeepSeek Chat, Coder, R1' },
                        { name: 'Ollama (local)', key: '(none)', endpoint: 'localhost:11434', models: 'Any locally installed model' },
                        { name: 'LM Studio (local)', key: '(none)', endpoint: 'localhost:1234', models: 'Any loaded GGUF model' },
                        { name: 'LiteLLM (proxy)', key: '(any)', endpoint: 'user-configured', models: 'Any model the proxy exposes' },
                ];

                const listHeader = dom.$('.kovix-listheader');
                listHeader.innerHTML = '<span>Supported Providers</span><span class="kovix-muted">key prefix · endpoint</span>';
                wrap.appendChild(listHeader);

                for (const p of providers) {
                        const card = dom.$('.kovix-card');
                        const icon = dom.$('.kovix-card__icon');
                        icon.innerHTML = '<span class="codicon codicon-key"></span>';
                        const body = dom.$('.kovix-card__body');
                        const title = dom.$('.kovix-card__title');
                        title.innerHTML = `<strong>${escapeHtml(p.name)}</strong>`;
                        const sub = dom.$('.kovix-card__desc');
                        sub.innerHTML = `<code>${escapeHtml(p.key)}</code> · <code>${escapeHtml(p.endpoint)}</code><br><span class="kovix-muted">${escapeHtml(p.models)}</span>`;
                        body.append(title, sub);
                        card.append(icon, body);
                        wrap.appendChild(card);
                }

                this.tabContent.appendChild(wrap);
        }

        // ============================================================
        //  TAB: Swarm
        // ============================================================

        private renderSwarmTab(): void {
                const wrap = dom.$('.kovix-tab-pane');
                const desc = dom.$('.kovix-tab-desc');
                desc.innerHTML = `<strong>Agent Swarm</strong> lets you spawn multiple specialised sub-agents that work in parallel on a single task. The active agent (supervisor) breaks the task into role-specific subtasks (architect, coder, reviewer, debugger, etc.) and dispatches them. Each sub-agent has its own mode, tool-set, and model.`;
                wrap.appendChild(desc);

                const actions = dom.$('.kovix-actionbar');
                const spawnBtn = this.makeBtn('rocket', 'Spawn Sub-Agent', 'Spawn a single sub-agent with a specific mode and task');
                spawnBtn.onclick = () => this.commandService.executeCommand('kovix.spawnSubAgent');
                const swarmBtn = this.makeBtn('layers', 'Launch Swarm', 'Launch a full multi-agent swarm (opens the swarm wizard)');
                swarmBtn.onclick = () => this.commandService.executeCommand('kovix.openSwarm');
                const ccBtn = this.makeBtn('dashboard', 'Open Control Center', 'Open the live agent control center');
                ccBtn.onclick = () => this.commandService.executeCommand('kovix.openControlCenter');
                actions.append(spawnBtn, swarmBtn, ccBtn);
                wrap.appendChild(actions);

                // Built-in modes
                const modesHeader = dom.$('.kovix-listheader');
                modesHeader.innerHTML = '<span>Built-in Agent Modes</span><span class="kovix-muted">each mode = a specialised sub-agent role</span>';
                wrap.appendChild(modesHeader);

                const modes = this.modeService.getAllModes();
                const active = this.modeService.getActiveMode();
                for (const m of modes) {
                        const card = dom.$('.kovix-card');
                        if (m.slug === active.slug) { card.classList.add('is-active'); }
                        const icon = dom.$('.kovix-card__icon');
                        icon.innerHTML = `<span class="codicon codicon-${escapeHtml(m.icon)}"></span>`;
                        const body = dom.$('.kovix-card__body');
                        const title = dom.$('.kovix-card__title');
                        title.innerHTML = `<strong>${escapeHtml(m.displayName)}</strong> ${m.slug === active.slug ? '<span class="kovix-badge">active</span>' : ''}`;
                        const sub = dom.$('.kovix-card__desc');
                        sub.textContent = m.description;
                        body.append(title, sub);
                        card.append(icon, body);

                        const cardActions = dom.$('.kovix-card__actions');
                        const activateBtn = this.makeBtn('arrow-right', 'Activate', '');
                        activateBtn.onclick = () => {
                                this.modeService.setActiveMode(m.slug);
                                this.notificationService.info(`Mode: ${m.displayName}`);
                                this.renderSwarmTab();
                        };
                        cardActions.appendChild(activateBtn);
                        card.appendChild(cardActions);
                        wrap.appendChild(card);
                }

                const createModeBtn = this.makeBtn('add', 'Create Custom Mode', 'Define your own agent role with custom tools and prompt');
                createModeBtn.onclick = () => this.commandService.executeCommand('kovix.createAgentMode');
                wrap.appendChild(createModeBtn);

                this.tabContent.appendChild(wrap);
        }

        // ============================================================
        //  TAB: Autonomous
        // ============================================================

        private renderAutonomousTab(): void {
                const wrap = dom.$('.kovix-tab-pane');
                const desc = dom.$('.kovix-tab-desc');
                desc.innerHTML = `<strong>Autonomous Mode</strong> turns a one-line idea into a fully functional app — no stops, no approvals, end-to-end. The agent refines the idea, plans milestones, writes the code, runs the tests, and commits. Milestone gates (optional) let you pause-and-review at sensible boundaries.`;
                wrap.appendChild(desc);

                // Big CTA
                const cta = dom.$('.kovix-cta');
                cta.innerHTML = `
                        <div class="kovix-cta__icon"><span class="codicon codicon-rocket"></span></div>
                        <div class="kovix-cta__body">
                                <div class="kovix-cta__title">Idea → App</div>
                                <div class="kovix-cta__sub">Describe your idea in one line. Kovix will refine it, plan it, build it, and ship it.</div>
                        </div>`;
                cta.onclick = () => this.commandService.executeCommand('kovix.autonomousBuild');
                wrap.appendChild(cta);

                // Autonomous toggles
                wrap.appendChild(this.makeToggle(
                        'kovix.ideaRefinement.enabled',
                        'Idea refinement (ask clarifying questions before planning)',
                        'When ON, the agent asks 1-3 clarifying questions before planning. When OFF, it plans immediately from your raw idea.',
                        this.configurationService.getValue<boolean>('kovix.ideaRefinement.enabled') !== false,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.autonomous.autoApprovePlan',
                        'Auto-approve plan (no manual approval gate)',
                        'When ON, the agent skips the "Approve plan?" gate and starts executing immediately. Faster, less control.',
                        !!this.configurationService.getValue<boolean>('kovix.autonomous.autoApprovePlan'),
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.autonomous.milestoneGates',
                        'Milestone gates (pause at sensible boundaries)',
                        'When ON, the agent pauses at logical milestones (e.g. "scaffold done", "MVP works") for you to review.',
                        this.configurationService.getValue<boolean>('kovix.autonomous.milestoneGates') !== false,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.autonomous.runTests',
                        'Run tests after each milestone',
                        'When ON, the agent runs the project\'s test suite after each milestone and stops if tests fail.',
                        this.configurationService.getValue<boolean>('kovix.autonomous.runTests') !== false,
                ));
                wrap.appendChild(this.makeToggle(
                        'kovix.autonomous.gitCommitPerStep',
                        'Git commit per step',
                        'When ON, the agent commits after each plan step on a dedicated branch. Easy to roll back.',
                        !!this.configurationService.getValue<boolean>('kovix.autonomous.gitCommitPerStep'),
                ));

                wrap.appendChild(this.makeNumber(
                        'kovix.autonomous.maxRounds',
                        'Max rounds per task',
                        'Hard ceiling on agent-loop iterations. Prevents runaway costs. 50 is a sensible default.',
                        this.configurationService.getValue<number>('kovix.autonomous.maxRounds') || 50, 1, 500,
                ));

                // Ponytail enforcement
                const pony = dom.$('.kovix-card');
                pony.innerHTML = `
                        <div class="kovix-card__icon"><span class="codicon codicon-shield"></span></div>
                        <div class="kovix-card__body">
                                <div class="kovix-card__title"><strong>Ponytail enforcement</strong></div>
                                <div class="kovix-card__desc">Ponytail (YAGNI → stdlib → native → deps → one-line → minimum) is enforced during autonomous builds to prevent the agent from over-engineering. <a href="https://github.com/DietrichGebert/ponytail" class="kovix-link">learn more</a></div>
                        </div>
                        <div class="kovix-card__actions"></div>`;
                const ponyBtn = this.makeBtn('settings-gear', 'Configure Ponytail', 'lite / full / ultra / off');
                ponyBtn.onclick = () => this.commandService.executeCommand('kovix.ponytailSetMode');
                pony.querySelector('.kovix-card__actions')!.appendChild(ponyBtn);
                wrap.appendChild(pony);

                this.tabContent.appendChild(wrap);
        }

        // ============================================================
        //  Helpers
        // ============================================================

        private readPrivacyConfig(): IMemoryPrivacyConfig {
                const g = <T>(k: string, def: T): T => {
                        const v = this.configurationService.getValue<T>(k);
                        return (v === undefined || v === null) ? def : v;
                };
                return {
                        autoRemember: g('kovix.memory.privacy.autoRemember', DEFAULT_PRIVACY_CONFIG.autoRemember),
                        requireExplicitConsent: g('kovix.memory.privacy.requireExplicitConsent', DEFAULT_PRIVACY_CONFIG.requireExplicitConsent),
                        piiScrub: g('kovix.memory.privacy.piiScrub', DEFAULT_PRIVACY_CONFIG.piiScrub),
                        scope: g('kovix.memory.privacy.scope', DEFAULT_PRIVACY_CONFIG.scope),
                        retentionDays: g('kovix.memory.privacy.retentionDays', DEFAULT_PRIVACY_CONFIG.retentionDays),
                        crossProjectLearning: g('kovix.memory.privacy.crossProjectLearning', DEFAULT_PRIVACY_CONFIG.crossProjectLearning),
                        redactFileContents: g('kovix.memory.privacy.redactFileContents', DEFAULT_PRIVACY_CONFIG.redactFileContents),
                        telemetryOptOut: g('kovix.memory.privacy.telemetryOptOut', DEFAULT_PRIVACY_CONFIG.telemetryOptOut),
                        forgetOnWindowClose: g('kovix.memory.privacy.forgetOnWindowClose', DEFAULT_PRIVACY_CONFIG.forgetOnWindowClose),
                        allowNetworkSync: g('kovix.memory.privacy.allowNetworkSync', DEFAULT_PRIVACY_CONFIG.allowNetworkSync),
                };
        }

        private makeBtn(icon: string, label: string, tooltip: string, disabled = false): HTMLButtonElement {
                const btn = dom.$('button.kovix-btn') as HTMLButtonElement;
                btn.innerHTML = `<span class="codicon codicon-${escapeHtml(icon)}"></span> ${escapeHtml(label)}`;
                btn.title = tooltip;
                if (disabled) { btn.disabled = true; }
                return btn;
        }

        private makeIconBtn(icon: string, tooltip: string): HTMLButtonElement {
                const btn = dom.$('button.kovix-iconbtn') as HTMLButtonElement;
                btn.innerHTML = `<span class="codicon codicon-${escapeHtml(icon)}"></span>`;
                btn.title = tooltip;
                btn.setAttribute('aria-label', tooltip);
                return btn;
        }

        private makeToggle(settingKey: string, label: string, desc: string, checked: boolean): HTMLElement {
                const row = dom.$('.kovix-toggle');
                const text = dom.$('.kovix-toggle__text');
                const l = dom.$('.kovix-toggle__label');
                l.textContent = label;
                const d = dom.$('.kovix-toggle__desc');
                d.textContent = desc;
                text.append(l, d);

                const sw = dom.$('label.kovix-switch');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = checked;
                cb.onchange = () => {
                        this.configurationService.updateValue(settingKey, cb.checked);
                };
                sw.appendChild(cb);
                sw.appendChild(dom.$('span.kovix-switch__slider'));

                row.append(text, sw);
                return row;
        }

        private makeSelect(settingKey: string, label: string, desc: string, options: Array<{ value: string; label: string }>, current: string): HTMLElement {
                const row = dom.$('.kovix-toggle');
                const text = dom.$('.kovix-toggle__text');
                const l = dom.$('.kovix-toggle__label');
                l.textContent = label;
                const d = dom.$('.kovix-toggle__desc');
                d.textContent = desc;
                text.append(l, d);

                const select = document.createElement('select');
                select.className = 'kovix-select';
                for (const opt of options) {
                        const o = document.createElement('option');
                        o.value = opt.value;
                        o.textContent = opt.label;
                        if (opt.value === current) { o.selected = true; }
                        select.appendChild(o);
                }
                select.onchange = () => {
                        this.configurationService.updateValue(settingKey, select.value);
                };
                row.append(text, select);
                return row;
        }

        private makeNumber(settingKey: string, label: string, desc: string, current: number, min: number, max: number): HTMLElement {
                const row = dom.$('.kovix-toggle');
                const text = dom.$('.kovix-toggle__text');
                const l = dom.$('.kovix-toggle__label');
                l.textContent = label;
                const d = dom.$('.kovix-toggle__desc');
                d.textContent = desc;
                text.append(l, d);

                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'kovix-input';
                input.value = String(current);
                input.min = String(min);
                input.max = String(max);
                input.onchange = () => {
                        const v = Number(input.value);
                        if (!isNaN(v) && v >= min && v <= max) {
                                this.configurationService.updateValue(settingKey, v);
                        }
                };
                row.append(text, input);
                return row;
        }
}
