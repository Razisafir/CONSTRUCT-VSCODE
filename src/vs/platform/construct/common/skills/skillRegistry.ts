/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const ISkillRegistry = createDecorator<ISkillRegistry>('kovix.skillRegistry');

/**
 * A Kovix Skill is a self-contained, markdown-driven playbook that the agent
 * can consult to perform a specialised task (security audit, perf audit,
 * UI polish, design-system generation, etc.).
 *
 * Skills are loaded from two locations:
 *   • ~/.kovix/skills/<slug>/SKILL.md      (user-global, every project)
 *   • <workspace>/.kovix/skills/<slug>/SKILL.md   (project-scoped)
 *
 * The SKILL.md file uses Claude-Code-style frontmatter:
 *   ---
 *   name: security-audit
 *   description: 100 security prompts ...
 *   allowed-tools: Read Edit Write Grep Glob Bash(git *)
 *   ---
 *   # Body…
 *
 * Skills can also be created from any markdown document via
 * {@link ISkillRegistry.createSkillFromDocument}.
 */
export interface IKovixSkill {
	/** Stable slug, also used as the slash-command name (e.g. "security-audit"). */
	readonly slug: string;
	/** Human-readable title (defaults to slug). */
	readonly title: string;
	/** Short description from frontmatter (first line of body if absent). */
	readonly description: string;
	/** Where this skill was loaded from. */
	readonly scope: 'user' | 'project' | 'builtin';
	/** Absolute path to the SKILL.md file (or virtual path for in-memory). */
	readonly filePath: string;
	/** Tool names declared in frontmatter `allowed-tools`. Empty = all tools. */
	readonly allowedTools: string[];
	/** Tools explicitly disallowed for this skill. */
	readonly disallowedTools: string[];
	/** Whether the user has toggled this skill off (default = enabled). */
	readonly enabled: boolean;
	/** Tags for matching skills to tasks. */
	readonly tags: string[];
	/** Full body content (the playbook / prompts). */
	readonly body: string;
	/** Optional icon (codicon name). */
	readonly icon?: string;
	/** Source URL if imported from a GitHub repo. */
	readonly sourceUrl?: string;
	/** ISO timestamp when the skill was installed/created. */
	readonly installedAt: string;
}

export interface ISkillMatch {
	skill: IKovixSkill;
	/** 0..1 relevance score. */
	score: number;
	/** Which tags/keywords matched. */
	matchedTerms: string[];
}

export interface ICreateSkillOptions {
	slug: string;
	title?: string;
	description?: string;
	body: string;
	scope?: 'user' | 'project';
	allowedTools?: string[];
	tags?: string[];
	icon?: string;
	sourceUrl?: string;
}

export interface ISkillRegistry {
	readonly _serviceBrand: undefined;

	/** All known skills (user + project + builtin), sorted by title. */
	getAllSkills(): Promise<IKovixSkill[]>;

	/** Get a single skill by slug. */
	getSkill(slug: string): Promise<IKovixSkill | undefined>;

	/** Refresh the in-memory cache from disk. */
	refresh(): Promise<void>;

	/** Enable or disable a skill (persists to ~/.kovix/skills.json). */
	setEnabled(slug: string, enabled: boolean): Promise<void>;

	/** Create a new skill from a markdown document (or any text body). */
	createSkillFromDocument(options: ICreateSkillOptions): Promise<IKovixSkill>;

	/** Delete a skill (only user/project scope, never builtin). */
	deleteSkill(slug: string, scope: 'user' | 'project'): Promise<void>;

	/** Import a skill from a remote URL (raw markdown). */
	importFromUrl(url: string, scope?: 'user' | 'project'): Promise<IKovixSkill>;

	/** Rank all enabled skills against a task description. */
	rankForTask(task: string, topK?: number): Promise<ISkillMatch[]>;

	/** Get the body of the top-K skills as a single injection string. */
	getContextForTask(task: string, topK?: number): Promise<string>;

	/** Open the skill folder in the system file explorer. */
	revealSkill(slug: string): Promise<void>;

	/** Fired when the skill list changes (refresh / create / delete / toggle). */
	readonly onDidUpdateSkills: Event<IKovixSkill[]>;
}
