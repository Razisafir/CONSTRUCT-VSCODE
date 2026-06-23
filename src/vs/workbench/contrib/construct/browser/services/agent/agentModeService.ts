/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { LLMProvider } from '../../../../../../platform/construct/common/security/secureKeyManager.js';
import { AIProviderType } from '../../../../../../platform/construct/common/llm/constructAIProvider.js';

export const IAgentModeService = createDecorator<IAgentModeService>('kovix.agentModeService');

/**
 * Tool groups available to an agent mode.
 * Maps to the tool registry's groupings.
 */
export type ToolGroup =
	| 'file'        // read, write, edit, delete files
	| 'terminal'    // execute shell commands
	| 'search'      // ripgrep, semantic search, find references
	| 'browser'     // web browsing / scraping
	| 'mcp'         // MCP server tools
	| 'memory'      // long-term memory CRUD
	| 'git'         // git operations
	| 'diff'        // apply diffs / approve changes
	| 'planning'    // create/edit plans
	| 'subagent'    // spawn sub-agents (for supervisor mode)
	;

/**
 * A named agent mode (Roo Code "custom modes" pattern).
 *
 * Each mode defines:
 * - a slug (unique identifier)
 * - a role definition (system prompt prefix)
 * - the tool groups it can access
 * - a model preference (provider + model)
 * - an API provider override (per-mode model selection)
 *
 * Stored in `.construct/modes.json` (workspace-scoped) and persisted
 * to IStorageService for cross-session continuity.
 *
 * The user can create unlimited modes. Each spawn of the agent loop
 * takes a mode, and the supervisor can route work to specialist
 * sub-agents each running their own mode.
 */
export interface IConstructAgentMode {
	/** Unique slug, e.g. 'architect', 'coder', 'reviewer'. */
	slug: string;
	/** Display name shown in the UI. */
	displayName: string;
	/** Description for the mode picker tooltip. */
	description: string;
	/** Icon (codicon name) shown in the UI. */
	icon: string;
	/** System prompt prefix appended to the agent's system prompt. */
	roleDefinition: string;
	/** Tool groups this mode can access. */
	toolGroups: ToolGroup[];
	/** Whether this mode can spawn sub-agents. */
	canSpawnSubAgents: boolean;
	/** Per-mode model preference. */
	modelPreference: IModeModelPreference;
	/** Whether this is a built-in mode (cannot be deleted). */
	builtin: boolean;
	/** Color accent for the mode badge (CSS color, optional). */
	accentColor?: string;
}

/**
 * Per-mode model preference.
 * If unset, the mode uses the global active provider + model.
 * If set, the mode uses the specified provider + model when active.
 */
export interface IModeModelPreference {
	/** Whether to override the global model selection. */
	enabled: boolean;
	/** LLM provider to use. */
	provider?: LLMProvider;
	/** Model ID within the provider. */
	modelId?: string;
	/** API provider type (cloud/ollama/xenova). */
	apiProvider?: AIProviderType;
}

/**
 * A sub-agent spawned by a supervisor agent.
 * Each sub-agent runs its own agent loop with its own mode + model.
 */
export interface ISubAgent {
	/** Unique ID for this sub-agent instance. */
	id: string;
	/** The mode this sub-agent is running. */
	mode: IConstructAgentMode;
	/** The task assigned to this sub-agent. */
	task: string;
	/** Current status. */
	status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	/** Output produced by this sub-agent (filled when status=completed). */
	output?: string;
	/** Error message (filled when status=failed). */
	error?: string;
	/** When this sub-agent was spawned. */
	startedAt: number;
	/** When this sub-agent finished (completed/failed/cancelled). */
	completedAt?: number;
	/** Token usage for this sub-agent. */
	tokenUsage?: { prompt: number; completion: number };
}

/**
 * Handoff event — when one agent hands control to another.
 * OpenAI Swarm-style: agent returns `{ handoff: agentB, context }`.
 */
export interface IAgentHandoff {
	/** The sub-agent being handed off to. */
	targetSubAgentId: string;
	/** Context to pass to the next agent. */
	context: string;
	/** Reason for the handoff. */
	reason: string;
}

export interface IAgentModeService {
	readonly _serviceBrand: undefined;

	/** All registered modes (built-in + user-created). */
	getAllModes(): IConstructAgentMode[];
	/** Get a specific mode by slug. */
	getMode(slug: string): IConstructAgentMode | undefined;
	/** Get the currently active mode. */
	getActiveMode(): IConstructAgentMode;
	/** Set the active mode. */
	setActiveMode(slug: string): void;
	/** Create or update a mode. */
	upsertMode(mode: IConstructAgentMode): void;
	/** Delete a mode (built-in modes cannot be deleted). */
	deleteMode(slug: string): boolean;
	/** Event fired when the active mode changes. */
	readonly onDidChangeActiveMode: Event<IConstructAgentMode>;
	/** Event fired when the mode list changes (add/update/delete). */
	readonly onDidChangeModes: Event<void>;

	/** Spawn a sub-agent with a specific mode + task. */
	spawnSubAgent(modeSlug: string, task: string): ISubAgent;
	/** Get all currently-tracked sub-agents. */
	getActiveSubAgents(): ISubAgent[];
	/** Get a specific sub-agent by ID. */
	getSubAgent(id: string): ISubAgent | undefined;
	/** Update a sub-agent's status/output. */
	updateSubAgent(id: string, update: Partial<ISubAgent>): void;
	/** Cancel a running sub-agent. */
	cancelSubAgent(id: string): void;
	/** Event fired when a sub-agent's status changes. */
	readonly onDidChangeSubAgent: Event<ISubAgent>;
}

/**
 * Built-in modes. These are always available and cannot be deleted.
 * Inspired by Roo Code's default modes + Cline's plan/act toggle +
 * Claude Code's sub-agent patterns.
 */
const BUILTIN_MODES: IConstructAgentMode[] = [
	{
		slug: 'general',
		displayName: 'General',
		description: 'All-purpose assistant with full tool access. Default mode for chat.',
		icon: 'spark',
		roleDefinition: 'You are Kovix, an AI coding assistant. Help the user with any task. Use tools when needed; otherwise respond concisely.',
		toolGroups: ['file', 'terminal', 'search', 'memory', 'git', 'diff', 'planning', 'browser', 'mcp'],
		canSpawnSubAgents: false,
		modelPreference: { enabled: false },
		builtin: true,
	},
	{
		slug: 'architect',
		displayName: 'Architect',
		description: 'Plans multi-file changes. Read-only access — proposes a plan, then hands off to a Coder.',
		icon: 'library',
		roleDefinition: 'You are the Architect. Analyze the codebase, propose a detailed multi-step plan, then hand off to the Coder sub-agent. Do NOT modify files directly. Use the planning and search tools to explore and design.',
		toolGroups: ['search', 'planning', 'memory', 'subagent'],
		canSpawnSubAgents: true,
		modelPreference: { enabled: false },
		builtin: true,
		accentColor: 'var(--kovix-volt-400)',
	},
	{
		slug: 'coder',
		displayName: 'Coder',
		description: 'Executes plans by editing files and running commands. Hands back to Architect for review.',
		icon: 'code',
		roleDefinition: 'You are the Coder. Execute the plan step by step. Use file/edit/terminal tools. When stuck, hand off back to the Architect with your findings.',
		toolGroups: ['file', 'terminal', 'search', 'diff', 'memory', 'subagent'],
		canSpawnSubAgents: true,
		modelPreference: { enabled: false },
		builtin: true,
		accentColor: 'var(--kovix-ignite-400)',
	},
	{
		slug: 'reviewer',
		displayName: 'Reviewer',
		description: 'Reviews pending diffs for bugs, security issues, and style. Read-only.',
		icon: 'eye',
		roleDefinition: 'You are the Reviewer. Inspect pending file changes for bugs, security issues, and style violations. Do NOT modify files. Report findings; the user decides whether to approve or reject.',
		toolGroups: ['search', 'memory'],
		canSpawnSubAgents: false,
		modelPreference: { enabled: false },
		builtin: true,
		accentColor: 'var(--kovix-state-running)',
	},
	{
		slug: 'debugger',
		displayName: 'Debugger',
		description: 'Investigates errors by reading stack traces, running tests, and bisecting code. Read+execute only.',
		icon: 'bug',
		roleDefinition: 'You are the Debugger. Reproduce the issue, read stack traces, run tests, and bisect the code to find the root cause. Propose a minimal fix; do not apply it.',
		toolGroups: ['file', 'terminal', 'search', 'memory'],
		canSpawnSubAgents: false,
		modelPreference: { enabled: false },
		builtin: true,
	},
	{
		slug: 'ask',
		displayName: 'Ask',
		description: 'Pure Q&A — no file modifications. Cheapest mode for "how do I..." questions.',
		icon: 'comment-discussion',
		roleDefinition: 'You are the Ask mode. Answer questions about the codebase concisely. Do NOT modify files. Use search tools only to look things up.',
		toolGroups: ['search', 'memory'],
		canSpawnSubAgents: false,
		modelPreference: { enabled: false },
		builtin: true,
	},
];

const STORAGE_KEY_MODES = 'kovix.agentModes';
const STORAGE_KEY_ACTIVE_MODE = 'kovix.agentActiveMode';

export class AgentModeService extends Disposable implements IAgentModeService {
	declare readonly _serviceBrand: undefined;

	private _modes: Map<string, IConstructAgentMode> = new Map();
	private _activeModeSlug: string = 'general';
	private _subAgents: Map<string, ISubAgent> = new Map();

	private readonly _onDidChangeActiveMode = this._register(new Emitter<IConstructAgentMode>());
	readonly onDidChangeActiveMode = this._onDidChangeActiveMode.event;

	private readonly _onDidChangeModes = this._register(new Emitter<void>());
	readonly onDidChangeModes = this._onDidChangeModes.event;

	private readonly _onDidChangeSubAgent = this._register(new Emitter<ISubAgent>());
	readonly onDidChangeSubAgent = this._onDidChangeSubAgent.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._loadModes();
		this._loadActiveMode();
		this.logService.info(`[AgentModeService] Initialized with ${this._modes.size} modes (active: ${this._activeModeSlug})`);
	}

	private _loadModes(): void {
		// Always load built-in modes first
		for (const mode of BUILTIN_MODES) {
			this._modes.set(mode.slug, mode);
		}
		// Then load user-created modes from storage (these override built-ins with same slug)
		try {
			const raw = this.storageService.get(STORAGE_KEY_MODES, StorageScope.APPLICATION);
			if (raw) {
				const userModes = JSON.parse(raw) as IConstructAgentMode[];
				for (const mode of userModes) {
					this._modes.set(mode.slug, mode);
				}
			}
		} catch (err) {
			this.logService.warn('[AgentModeService] Failed to load user modes: ' + (err as Error).message);
		}
	}

	private _loadActiveMode(): void {
		const stored = this.storageService.get(STORAGE_KEY_ACTIVE_MODE, StorageScope.APPLICATION);
		if (stored && this._modes.has(stored)) {
			this._activeModeSlug = stored;
		}
	}

	private _persistUserModes(): void {
		const userModes = Array.from(this._modes.values()).filter(m => !m.builtin);
		this.storageService.store(STORAGE_KEY_MODES, JSON.stringify(userModes), StorageScope.APPLICATION, StorageTarget.USER);
	}

	getAllModes(): IConstructAgentMode[] {
		return Array.from(this._modes.values());
	}

	getMode(slug: string): IConstructAgentMode | undefined {
		return this._modes.get(slug);
	}

	getActiveMode(): IConstructAgentMode {
		return this._modes.get(this._activeModeSlug) ?? BUILTIN_MODES[0];
	}

	setActiveMode(slug: string): void {
		const mode = this._modes.get(slug);
		if (!mode) {
			this.logService.warn(`[AgentModeService] Cannot set active mode: unknown slug '${slug}'`);
			return;
		}
		if (slug === this._activeModeSlug) { return; }
		this._activeModeSlug = slug;
		this.storageService.store(STORAGE_KEY_ACTIVE_MODE, slug, StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeActiveMode.fire(mode);
		this.logService.info(`[AgentModeService] Active mode: ${slug}`);
	}

	upsertMode(mode: IConstructAgentMode): void {
		// Built-in modes can be updated but not deleted
		this._modes.set(mode.slug, mode);
		this._persistUserModes();
		this._onDidChangeModes.fire();
		this.logService.info(`[AgentModeService] Upserted mode: ${mode.slug}`);
	}

	deleteMode(slug: string): boolean {
		const mode = this._modes.get(slug);
		if (!mode) { return false; }
		if (mode.builtin) {
			this.logService.warn(`[AgentModeService] Cannot delete built-in mode: ${slug}`);
			return false;
		}
		this._modes.delete(slug);
		this._persistUserModes();
		// If the deleted mode was active, fall back to 'general'
		if (this._activeModeSlug === slug) {
			this.setActiveMode('general');
		}
		this._onDidChangeModes.fire();
		return true;
	}

	spawnSubAgent(modeSlug: string, task: string): ISubAgent {
		const mode = this._modes.get(modeSlug);
		if (!mode) {
			throw new Error(`Cannot spawn sub-agent: unknown mode '${modeSlug}'`);
		}
		const sub: ISubAgent = {
			id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			mode,
			task,
			status: 'pending',
			startedAt: Date.now(),
		};
		this._subAgents.set(sub.id, sub);
		this._onDidChangeSubAgent.fire(sub);
		this.logService.info(`[AgentModeService] Spawned sub-agent ${sub.id} (mode: ${modeSlug}, task: ${task.slice(0, 80)}...)`);
		return sub;
	}

	getActiveSubAgents(): ISubAgent[] {
		return Array.from(this._subAgents.values());
	}

	getSubAgent(id: string): ISubAgent | undefined {
		return this._subAgents.get(id);
	}

	updateSubAgent(id: string, update: Partial<ISubAgent>): void {
		const sub = this._subAgents.get(id);
		if (!sub) { return; }
		Object.assign(sub, update);
		if (update.status === 'completed' || update.status === 'failed' || update.status === 'cancelled') {
			sub.completedAt = Date.now();
		}
		this._onDidChangeSubAgent.fire(sub);
	}

	cancelSubAgent(id: string): void {
		this.updateSubAgent(id, { status: 'cancelled' });
	}
}
