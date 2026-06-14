// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { IAgentSkill, ISkillLoadResult } from './agentSkillTypes.js';

export const IAgentSkillService = createDecorator<IAgentSkillService>('construct.agentSkillService');

export interface IAgentSkillService {
	readonly _serviceBrand: undefined;
	loadSkills(): Promise<ISkillLoadResult>;
	getSkills(): IAgentSkill[];
	getSkill(id: string): IAgentSkill | undefined;
	searchSkills(query: string): IAgentSkill[];
	getSkillPrompt(skillIds: string[]): string;
}
