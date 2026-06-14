// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { IAgentHook, IAgentHookContext, IHookExecutionResult, AgentHookEvent } from './agentHookTypes.js';

export const IAgentHookService = createDecorator<IAgentHookService>('construct.agentHookService');

export interface IAgentHookService {
	readonly _serviceBrand: undefined;
	registerHook(hook: IAgentHook): { dispose: () => void };
	runHooks(event: AgentHookEvent, context: Omit<IAgentHookContext, 'event'>): Promise<IHookExecutionResult>;
	getHooks(): IAgentHook[];
	setHookEnabled(id: string, enabled: boolean): void;
}
