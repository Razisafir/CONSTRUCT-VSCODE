/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import * as dom from '../../../../base/browser/dom.js';
import { IConstructMemoryService, IConstructMemoryItem, IConstructMemoryProfile } from '../../../../platform/construct/common/memory/constructMemory.js';
import { IUniversalMemoryService } from '../../../../platform/construct/common/memory/universalMemoryService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
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


/**
 * Categories for the memory tree view.
 */
enum MemoryCategory {
                ProfileStatic = 'profile-static',
                ProfileDynamic = 'profile-dynamic',
                RecentMemories = 'recent-memories',
                WorkspaceContext = 'workspace-context'
}

/**
 * A single item in the memory tree.
 */
interface IMemoryTreeItem {
                readonly id: string;
                readonly label: string;
                readonly description?: string;
                readonly icon: string;
                readonly iconColor: string;
                readonly backgroundColor?: string;
                readonly category: MemoryCategory;
                readonly fullContent?: string;
                readonly memoryId?: string;
                readonly timestamp?: number;
}

export class ConstructMemoryViewPane extends ViewPane {

                private searchBox!: HTMLInputElement;
                private treeContent!: HTMLElement;
                private statsBar!: HTMLElement;

                private profile: IConstructMemoryProfile = { static: [], dynamic: [] };
                private recentMemories: IConstructMemoryItem[] = [];
                private currentFilter: string = '';
                private localStats: { totalEntries: number } | null = null;

                constructor(
                                options: IViewPaneOptions,
                                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
                                @IUniversalMemoryService private readonly universalMemory: IUniversalMemoryService,
                                @ILogService private readonly logService: ILogService,
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
                ) {
                                super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
                }

                protected override renderBody(container: HTMLElement): void {
                                super.renderBody(container);

                                container.style.display = 'flex';
                                container.style.flexDirection = 'column';
                                container.style.height = '100%';

                                // Header with connection status
                                const header = dom.$('.construct-memory-header');
                                header.style.cssText = `
                                                padding: 8px 12px; border-bottom: 1px solid var(--kovix-border);
                                                display: flex; justify-content: space-between; align-items: center;
                                `;

                                const statusText = dom.$('.construct-memory-status');
                                // Kovix badge utility (from kovix-tokens.css):
                                //   - "Vector search" (info-blue badge) when embeddings are live
                                //   - "Keyword fallback" (idle, no badge bg) when running on BM25
                                // Wording matters: BM25 fallback is a designed feature, not a failure,
                                // so we avoid any phrasing that reads as an error state.
                                statusText.className = 'kovix-badge ' + (this.constructMemory.isInitialized ? 'kovix-badge--info' : 'kovix-badge--idle');
                                statusText.textContent = this.constructMemory.isInitialized ? 'Vector search' : 'Keyword fallback';

                                const refreshBtn = dom.$('button') as HTMLButtonElement;
                                refreshBtn.textContent = 'R';
                                refreshBtn.title = 'Refresh memories';
                                refreshBtn.style.cssText = `
                                                background: none; border: 1px solid var(--kovix-border); color: var(--kovix-text-tertiary);
                                                border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;
                                `;
                                refreshBtn.onclick = () => this.refresh();

                                header.appendChild(statusText);
                                header.appendChild(refreshBtn);
                                container.appendChild(header);

                                // Search box
                                const searchContainer = dom.$('.construct-memory-search');
                                searchContainer.style.cssText = `padding: 6px 8px;`;

                                this.searchBox = dom.$('input') as HTMLInputElement;
                                this.searchBox.type = 'text';
                                this.searchBox.placeholder = 'Search memories...';
                                this.searchBox.style.cssText = `
                                                width: 100%; background: var(--kovix-bg-ink); border: 1px solid var(--kovix-border);
                                                border-radius: 3px; padding: 5px 8px; color: var(--kovix-text-primary);
                                                font-size: 11px; outline: none; box-sizing: border-box;
                                `;
                                this.searchBox.oninput = () => {
                                                this.currentFilter = this.searchBox.value.trim();
                                                this.renderTree();
                                };

                                searchContainer.appendChild(this.searchBox);
                                container.appendChild(searchContainer);

                                // Tree content
                                this.treeContent = dom.$('.construct-memory-tree');
                                this.treeContent.style.cssText = `
                                                flex: 1; overflow-y: auto; padding: 4px 8px;
                                `;
                                container.appendChild(this.treeContent);

                                // Stats bar
                                this.statsBar = dom.$('.construct-memory-stats');
                                this.statsBar.style.cssText = `
                                                padding: 4px 12px; border-top: 1px solid var(--kovix-border);
                                                font-size: 10px; color: var(--kovix-text-tertiary);
                                `;
                                container.appendChild(this.statsBar);

                                // Initial load
                                this.refresh();

                                // Listen for initialization changes
                                this._register(this.constructMemory.onDidChangeInitialization(() => {
                                                statusText.className = 'kovix-badge ' + (this.constructMemory.isInitialized ? 'kovix-badge--info' : 'kovix-badge--idle');
                                                                statusText.textContent = this.constructMemory.isInitialized ? 'Vector search' : 'Keyword fallback';
                                                this.refresh();
                                }));

                                // Listen for new memories
                                this._register(this.constructMemory.onDidAddMemory(() => {
                                                this.refresh();
                                }));
                }

                protected override layoutBody(height: number, width: number): void {
                                // Layout handled by flexbox
                }

                async refresh(): Promise<void> {
                                try {
                                                // Load profile
                                                if (this.constructMemory.isInitialized && this.constructMemory.config.enabled) {
                                                                this.profile = await this.constructMemory.getProfile();
                                                                this.recentMemories = await this.constructMemory.getRecentMemories(20);
                                                } else {
                                                                this.profile = { static: [], dynamic: [] };
                                                                this.recentMemories = [];
                                                }

                                                // Load local stats
                                                // Phase 5.5 (Fix 2): use universalMemory (real persistent store) instead of
                                                // the dead 4-layer orchestrator. The orchestrator's getMemoryStats()
                                                // was reading from empty in-memory Maps, so this is an improvement.
                                                this.localStats = null;
                                                this.universalMemory.getStats().then((stats: { totalEntries: number }) => {
                                                        this.localStats = { totalEntries: stats.totalEntries };
                                                        this.renderStats();
                                                }).catch(() => { /* non-critical */ });

                                                this.renderTree();
                                                this.renderStats();
                                } catch (error) {
                                                this.logService.warn('[ConstructMemoryView] Refresh failed:', error);
                                }
                }

                private renderTree(): void {
                                // Clear existing content
                                dom.clearNode(this.treeContent);

                                const items = this.getFilteredItems();

                                if (items.length === 0) {
                                                const empty = dom.$('.construct-memory-empty');
                                                empty.style.cssText = `
                                                                padding: 20px; text-align: center; color: var(--kovix-text-tertiary); font-size: 11px;
                                                `;
                                                empty.textContent = this.constructMemory.isInitialized
                                                                ? 'No memories yet. Start a conversation to build your memory.'
                                                                : 'Connect Supermemory to enable persistent memory across sessions.';
                                                this.treeContent.appendChild(empty);
                                                return;
                                }

                                // Group items by category
                                const grouped = new Map<MemoryCategory, IMemoryTreeItem[]>();
                                for (const item of items) {
                                                const group = grouped.get(item.category) ?? [];
                                                group.push(item);
                                                grouped.set(item.category, group);
                                }

                                // Render each category
                                const categoryOrder: MemoryCategory[] = [
                                                MemoryCategory.ProfileStatic,
                                                MemoryCategory.ProfileDynamic,
                                                MemoryCategory.RecentMemories,
                                                MemoryCategory.WorkspaceContext
                                ];

                                const categoryLabels: Record<MemoryCategory, string> = {
                                                [MemoryCategory.ProfileStatic]: '[MEM] Preferences & Facts',
                                                [MemoryCategory.ProfileDynamic]: '[ACTIVE] Recent Activity',
                                                [MemoryCategory.RecentMemories]: '[NOTE] Recent Memories',
                                                [MemoryCategory.WorkspaceContext]: '[DIR] Workspace Context'
                                };

                                for (const category of categoryOrder) {
                                                const groupItems = grouped.get(category);
                                                if (!groupItems || groupItems.length === 0) { continue; }

                                                // Category header
                                                const catHeader = dom.$('.construct-memory-cat-header');
                                                catHeader.style.cssText = `
                                                                padding: 6px 4px 2px 4px; font-size: 11px; font-weight: 600;
                                                                color: var(--kovix-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;
                                                `;
                                                catHeader.textContent = categoryLabels[category];
                                                this.treeContent.appendChild(catHeader);

                                                // Items
                                                for (const item of groupItems) {
                                                                this.renderTreeItem(item);
                                                }
                                }
                }

                private renderTreeItem(item: IMemoryTreeItem): void {
                                const row = dom.$('.kovix-memory-entry');
                                const bgColor = item.backgroundColor ?? 'transparent';
                                row.style.cssText = `
                                                display: flex; align-items: flex-start; padding: var(--kovix-space-1) var(--kovix-space-2);
                                                margin: 1px 0; cursor: pointer;
                                                background: ${bgColor}; border-left: 2px solid ${item.iconColor};
                                `;
                                row.title = item.fullContent ?? item.label;

                                // v2.0: Scope badge — project-scoped vs universal
                                const isProject = item.category === MemoryCategory.WorkspaceContext;
                                const scopeBadge = dom.$(`.kovix-memory-entry__scope--${isProject ? 'project' : 'universal'}`);
                                scopeBadge.textContent = isProject ? 'PROJ' : 'UNIV';
                                scopeBadge.title = isProject ? 'Project-scoped memory' : 'Universal cross-project memory';
                                row.appendChild(scopeBadge);

                                // Icon
                                const icon = dom.$('.kovix-memory-item-icon');
                                icon.style.cssText = `
                                                min-width: 16px; margin-right: var(--kovix-space-1); font-size: 11px;
                                `;
                                icon.textContent = item.icon;
                                row.appendChild(icon);

                                // Content
                                const content = dom.$('.construct-memory-item-content');
                                content.style.cssText = `flex: 1; min-width: 0; color: var(--kovix-text-primary);`;

                                const label = dom.$('.construct-memory-item-label');
                                label.style.cssText = `
                                                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                                `;
                                label.textContent = item.label;
                                content.appendChild(label);

                                if (item.description) {
                                                const desc = dom.$('.construct-memory-item-desc');
                                                desc.style.cssText = `
                                                                font-size: 9px; color: var(--kovix-text-tertiary); overflow: hidden;
                                                                text-overflow: ellipsis; white-space: nowrap;
                                                `;
                                                desc.textContent = item.description;
                                                content.appendChild(desc);
                                }

                                row.appendChild(content);

                                // Delete button (only for Supermemory items)
                                if (item.memoryId && this.constructMemory.isInitialized) {
                                                const deleteBtn = dom.$('button') as HTMLButtonElement;
                                                deleteBtn.textContent = 'x';
                                                deleteBtn.title = 'Delete this memory';
                                                deleteBtn.style.cssText = `
                                                                background: none; border: none; color: var(--kovix-text-tertiary);
                                                                cursor: pointer; font-size: 12px; padding: 0 2px;
                                                                min-width: 16px; opacity: 0;
                                                                transition: opacity 0.15s;
                                                `;
                                                row.onmouseenter = () => { deleteBtn.style.opacity = '1'; };
                                                row.onmouseleave = () => { deleteBtn.style.opacity = '0'; };
                                                deleteBtn.onclick = (e) => {
                                                                e.stopPropagation();
                                                                if (item.memoryId && confirm('Delete this memory?')) {
                                                                                this.constructMemory.forgetMemory(item.memoryId).then(() => {
                                                                                                this.refresh();
                                                                                }).catch(err => {
                                                                                                this.logService.warn('[ConstructMemoryView] Failed to delete memory:', err);
                                                                                });
                                                                }
                                                };
                                                row.appendChild(deleteBtn);
                                }

                                // Click to see full content
                                row.onclick = () => {
                                                if (item.fullContent) {
                                                                this.showMemoryDetail(item);
                                                }
                                };

                                this.treeContent.appendChild(row);
                }

                private showMemoryDetail(item: IMemoryTreeItem): void {
                                // Replace tree with detail view temporarily
                                dom.clearNode(this.treeContent);

                                const detail = dom.$('.construct-memory-detail');
                                detail.style.cssText = `padding: 8px;`;

                                const backBtn = dom.$('button') as HTMLButtonElement;
                                backBtn.textContent = '<- Back';
                                backBtn.style.cssText = `
                                                background: none; border: 1px solid var(--kovix-border); color: var(--kovix-volt-400);
                                                border-radius: 3px; padding: 3px 8px; cursor: pointer;
                                                font-size: 11px; margin-bottom: 8px;
                                `;
                                backBtn.onclick = () => this.renderTree();
                                detail.appendChild(backBtn);

                                const title = dom.$('.construct-memory-detail-title');
                                title.style.cssText = `
                                                font-size: 12px; font-weight: 600; color: var(--kovix-text-primary); margin-bottom: 4px;
                                `;
                                title.textContent = item.label;
                                detail.appendChild(title);

                                if (item.timestamp) {
                                                const time = dom.$('.construct-memory-detail-time');
                                                time.style.cssText = `font-size: 9px; color: var(--kovix-text-tertiary); margin-bottom: 8px;`;
                                                time.textContent = new Date(item.timestamp).toLocaleString();
                                                detail.appendChild(time);
                                }

                                const content = dom.$('.construct-memory-detail-content');
                                content.style.cssText = `
                                                font-size: 11px; color: var(--kovix-text-secondary); white-space: pre-wrap;
                                                line-height: 1.5; word-break: break-word;
                                `;
                                content.textContent = item.fullContent ?? '';
                                detail.appendChild(content);

                                this.treeContent.appendChild(detail);
                }

                private renderStats(): void {
                                dom.clearNode(this.statsBar);

                                const parts: string[] = [];

                                if (this.localStats) {
                                                parts.push(`Local: ${this.localStats.totalEntries} entries`);
                                }

                                if (this.constructMemory.isInitialized) {
                                                const profileCount = this.profile.static.length + this.profile.dynamic.length;
                                                parts.push(`Profile: ${profileCount} facts`);
                                                parts.push(`Memories: ${this.recentMemories.length}`);
                                }

                                this.statsBar.textContent = parts.join(' | ') || 'No memory data';
                }

                private getFilteredItems(): IMemoryTreeItem[] {
                                const items: IMemoryTreeItem[] = [];
                                const filter = this.currentFilter.toLowerCase();

                                // Static profile facts
                                for (const fact of this.profile.static) {
                                                const item: IMemoryTreeItem = {
                                                                id: `static-${items.length}`,
                                                                label: fact,
                                                                icon: '[MEM]',
                                                                iconColor: 'var(--kovix-text-tertiary)',
                                                                backgroundColor: 'var(--kovix-bg-ink)',
                                                                category: MemoryCategory.ProfileStatic,
                                                                fullContent: fact,
                                                };
                                                if (!filter || fact.toLowerCase().includes(filter)) {
                                                                items.push(item);
                                                }
                                }

                                // Dynamic profile facts
                                for (const activity of this.profile.dynamic) {
                                                const item: IMemoryTreeItem = {
                                                                id: `dynamic-${items.length}`,
                                                                label: activity,
                                                                icon: '[ACTIVE]',
                                                                iconColor: 'var(--kovix-volt-400)',
                                                                backgroundColor: 'var(--kovix-bg-ink)',
                                                                category: MemoryCategory.ProfileDynamic,
                                                                fullContent: activity,
                                                };
                                                if (!filter || activity.toLowerCase().includes(filter)) {
                                                                items.push(item);
                                                }
                                }

                                // Recent memories
                                for (const memory of this.recentMemories) {
                                                const memoryType = memory.metadata?.type as string | undefined;
                                                let icon = '[NOTE]';
                                                let iconColor = 'var(--kovix-text-primary)';

                                                if (memoryType === 'tool_result') {
                                                                icon = '[TOOL]';
                                                                iconColor = 'var(--kovix-state-running)';
                                                } else if (memoryType === 'error') {
                                                                icon = '[WARN]';
                                                                iconColor = 'var(--kovix-state-error)';
                                                } else if (memoryType === 'task_summary') {
                                                                icon = '[PLAN]';
                                                                iconColor = 'var(--kovix-volt-400)';
                                                } else if (memoryType === 'user_message') {
                                                                icon = '[CHAT]';
                                                                iconColor = 'var(--kovix-volt-400)';
                                                }

                                                const item: IMemoryTreeItem = {
                                                                id: memory.id,
                                                                label: memory.content.length > 80 ? memory.content.substring(0, 80) + '...' : memory.content,
                                                                description: this.formatTimestamp(memory.createdAt),
                                                                icon,
                                                                iconColor,
                                                                category: MemoryCategory.RecentMemories,
                                                                fullContent: memory.content,
                                                                memoryId: memory.id,
                                                                timestamp: memory.createdAt,
                                                };

                                                if (!filter || memory.content.toLowerCase().includes(filter)) {
                                                                items.push(item);
                                                }
                                }

                                // Workspace context (from local stats)
                                // Phase 5.5 (Fix 2): the 4-layer memory (working/episodic/semantic/procedural)
                                // was deleted as dead infrastructure. The orchestrator that populated
                                // entriesByLayer was reading from empty Maps. We now show only the
                                // totalEntries count from universalMemory (the real persistent store).
                                if (this.localStats && this.localStats.totalEntries > 0) {
                                                items.push({
                                                                id: 'ws-total',
                                                                label: `Local Memory: ${this.localStats.totalEntries} entries`,
                                                                icon: '[DIR]',
                                                                iconColor: 'var(--kovix-text-tertiary)',
                                                                category: MemoryCategory.WorkspaceContext,
                                                });
                                }

                                return items;
                }

                private formatTimestamp(ts: number): string {
                                if (!ts) { return ''; }
                                const now = Date.now();
                                const diff = now - ts;

                                if (diff < 60000) { return 'just now'; }
                                if (diff < 3600000) { return `${Math.floor(diff / 60000)}m ago`; }
                                if (diff < 86400000) { return `${Math.floor(diff / 3600000)}h ago`; }
                                return new Date(ts).toLocaleDateString();
                }
}
