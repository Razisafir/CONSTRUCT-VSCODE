// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IAgentHookService } from '../../../../../../platform/construct/common/hooks/agentHookService.js';
import { IAgentHook, IAgentHookContext, IHookExecutionResult, AgentHookEvent } from '../../../../../../platform/construct/common/hooks/agentHookTypes.js';

export class AgentHookServiceImpl extends Disposable implements IAgentHookService {
	declare readonly _serviceBrand: undefined;

	private hooks: Map<string, IAgentHook> = new Map();
	private sortedHookCache: Map<AgentHookEvent, IAgentHook[]> = new Map();
	private cacheDirty: boolean = true;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	registerHook(hook: IAgentHook): { dispose: () => void } {
		if (this.hooks.has(hook.id)) {
			this.logService.warn(`[AgentHookService] Overwriting existing hook with id: ${hook.id}`);
		}

		this.hooks.set(hook.id, hook);
		this.cacheDirty = true;

		return {
			dispose: () => {
				this.hooks.delete(hook.id);
				this.cacheDirty = true;
			},
		};
	}

	async runHooks(event: AgentHookEvent, context: Omit<IAgentHookContext, 'event'>): Promise<IHookExecutionResult> {
		const hooks = this.getSortedHooksForEvent(event);

		if (hooks.length === 0) {
			return { allowed: true };
		}

		const fullContext: IAgentHookContext = { ...context, event };
		const isBeforeEvent = event.startsWith('before');

		for (const hook of hooks) {
			if (!hook.enabled) {
				continue;
			}

			try {
				const result = await hook.handler(fullContext);

				// For before* events, returning false cancels the action
				if (isBeforeEvent && result === false) {
					this.logService.info(`[AgentHookService] Hook "${hook.id}" blocked ${event} for session ${context.sessionId}`);
					return { allowed: false };
				}
			} catch (error) {
				// If a hook throws, log the error and continue execution
				const hookError = error instanceof Error ? error : new Error(String(error));
				this.logService.error(
					`[AgentHookService] Hook "${hook.id}" threw an error during ${event}: ${hookError.message}`
				);
				// Continue with remaining hooks — do not abort on hook error
			}
		}

		return { allowed: true };
	}

	getHooks(): IAgentHook[] {
		return Array.from(this.hooks.values());
	}

	setHookEnabled(id: string, enabled: boolean): void {
		const hook = this.hooks.get(id);
		if (!hook) {
			this.logService.warn(`[AgentHookService] Cannot set enabled state for unknown hook: ${id}`);
			return;
		}
		hook.enabled = enabled;
		this.cacheDirty = true;
		this.logService.info(`[AgentHookService] Hook "${id}" ${enabled ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Get hooks sorted by priority (lower number = higher priority = runs first)
	 * for a given event.
	 */
	private getSortedHooksForEvent(event: AgentHookEvent): IAgentHook[] {
		if (this.cacheDirty) {
			this.rebuildCache();
		}

		return this.sortedHookCache.get(event) ?? [];
	}

	private rebuildCache(): void {
		this.sortedHookCache.clear();

		// Group hooks by event
		const byEvent = new Map<AgentHookEvent, IAgentHook[]>();

		for (const hook of this.hooks.values()) {
			for (const event of hook.events) {
				if (!byEvent.has(event)) {
					byEvent.set(event, []);
				}
				byEvent.get(event)!.push(hook);
			}
		}

		// Sort each group by priority (ascending: lower priority number runs first)
		for (const [event, hooks] of byEvent) {
			hooks.sort((a, b) => a.priority - b.priority);
			this.sortedHookCache.set(event, hooks);
		}

		this.cacheDirty = false;
	}
}
