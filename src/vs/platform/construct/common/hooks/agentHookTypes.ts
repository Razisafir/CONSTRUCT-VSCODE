// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

export type AgentHookEvent = 'beforeExecute' | 'afterExecute' | 'beforeCodeModification' | 'afterCodeModification' | 'onError' | 'onComplete';

export interface IAgentHookContext {
	event: AgentHookEvent;
	toolName?: string;
	toolArgs?: Record<string, unknown>;
	toolResult?: unknown;
	filePath?: string;
	error?: Error;
	sessionId: string;
}

export interface IAgentHook {
	id: string;
	events: AgentHookEvent[];
	handler: (context: IAgentHookContext) => boolean | void | Promise<boolean | void>;
	enabled: boolean;
	priority: number;
}

export interface IHookExecutionResult {
	allowed: boolean;
	error?: Error;
}
