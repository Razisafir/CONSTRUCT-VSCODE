// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

export interface IAgentSkill {
	id: string;
	name: string;
	description: string;
	category: SkillCategory;
	tags: string[];
	instructions: string;
	isBuiltIn: boolean;
	sourcePath?: string;
	requiredTools: string[];
	modifiesFiles: boolean;
}

export type SkillCategory = 'security' | 'testing' | 'refactoring' | 'documentation' | 'debugging' | 'deployment' | 'analysis' | 'custom';

export interface ISkillLoadResult {
	skills: IAgentSkill[];
	errors: Array<{ path: string; error: string }>;
}
