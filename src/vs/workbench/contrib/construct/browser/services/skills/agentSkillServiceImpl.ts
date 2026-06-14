// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IAgentSkillService } from '../../../../../../platform/construct/common/skills/agentSkillService.js';
import { IAgentSkill, ISkillLoadResult, SkillCategory } from '../../../../../../platform/construct/common/skills/agentSkillTypes.js';

/**
 * Built-in agent skills defined as part of the Construct platform.
 */
const builtInAgentSkills: IAgentSkill[] = [
	{
		id: 'security-audit',
		name: 'Security Audit',
		description: 'Perform a comprehensive security audit of the codebase, identifying vulnerabilities, injection points, and insecure patterns.',
		category: 'security' as SkillCategory,
		tags: ['security', 'audit', 'vulnerability', 'owasp'],
		instructions: `Perform a comprehensive security audit of the codebase:

1. Scan the project for common vulnerability patterns:
   - SQL injection, XSS, CSRF, and command injection
   - Hardcoded secrets, API keys, and credentials
   - Insecure deserialization and path traversal
   - Improper input validation and sanitization
2. Check dependency versions against known CVE databases
3. Review authentication and authorization logic
4. Analyze data flow for sensitive information leaks
5. Generate a prioritized report with:
   - Critical, High, Medium, Low severity ratings
   - Specific file locations and line numbers
   - Recommended remediation steps
   - References to OWASP or CWE standards`,
		isBuiltIn: true,
		requiredTools: ['read_file', 'search_codebase', 'run_terminal'],
		modifiesFiles: false,
	},
	{
		id: 'test-generation',
		name: 'Test Generation',
		description: 'Automatically generate comprehensive unit and integration tests for selected files or the entire project.',
		category: 'testing' as SkillCategory,
		tags: ['testing', 'unit-test', 'integration', 'coverage'],
		instructions: `Generate comprehensive tests for the target code:

1. Analyze the source file(s) to understand:
   - Exported functions, classes, and interfaces
   - Dependencies and side effects
   - Error handling paths
2. Detect the project's test framework (jest, vitest, mocha, pytest, etc.)
3. Generate tests covering:
   - Happy path scenarios for all public APIs
   - Edge cases and boundary conditions
   - Error handling and exception paths
   - Input validation and sanitization
4. Place test files in the project's convention location
5. Run the generated tests and report results
6. Iterate on failing tests to fix issues`,
		isBuiltIn: true,
		requiredTools: ['read_file', 'write_file', 'run_terminal', 'search_codebase'],
		modifiesFiles: true,
	},
	{
		id: 'code-review',
		name: 'Code Review',
		description: 'Perform an automated code review analyzing code quality, maintainability, performance, and adherence to best practices.',
		category: 'analysis' as SkillCategory,
		tags: ['review', 'quality', 'best-practices', 'clean-code'],
		instructions: `Perform a thorough code review of the target changes:

1. Examine the git diff or specified files for:
   - Logic errors and potential bugs
   - Performance issues and inefficiencies
   - Security vulnerabilities
   - Code style and naming convention violations
   - Missing error handling
   - Incomplete test coverage
2. Evaluate architectural concerns:
   - Separation of concerns
   - Proper abstraction levels
   - Dependency management
3. Check for code smells:
   - Duplicated code
   - Overly complex functions
   - Deep nesting
   - Magic numbers and hardcoded values
4. Provide structured feedback with:
   - Severity level (critical, warning, suggestion)
   - Specific file and line references
   - Concrete improvement suggestions
   - Code examples where helpful`,
		isBuiltIn: true,
		requiredTools: ['read_file', 'search_codebase', 'run_terminal'],
		modifiesFiles: false,
	},
	{
		id: 'refactoring',
		name: 'Refactoring',
		description: 'Analyze code for refactoring opportunities and apply safe, behavior-preserving transformations to improve code quality.',
		category: 'refactoring' as SkillCategory,
		tags: ['refactoring', 'clean-code', 'design-patterns', 'simplification'],
		instructions: `Analyze and refactor the target code:

1. Identify refactoring opportunities:
   - Extract method / function for repeated logic
   - Replace magic numbers with named constants
   - Simplify conditional logic
   - Remove dead code and unused imports
   - Reduce function complexity (long methods, deep nesting)
   - Apply appropriate design patterns
2. Before making changes:
   - Ensure existing tests exist or create them first
   - Document the current behavior
3. Apply refactoring transformations:
   - Make small, incremental changes
   - Run tests after each transformation
   - Preserve all existing behavior
4. Verify:
   - All tests still pass
   - No regressions introduced
   - Code is more readable and maintainable`,
		isBuiltIn: true,
		requiredTools: ['read_file', 'write_file', 'run_terminal', 'search_codebase'],
		modifiesFiles: true,
	},
	{
		id: 'documentation',
		name: 'Documentation Generation',
		description: 'Generate comprehensive documentation including JSDoc/TSDoc comments, README sections, API documentation, and architecture guides.',
		category: 'documentation' as SkillCategory,
		tags: ['documentation', 'jsdoc', 'readme', 'api-docs'],
		instructions: `Generate comprehensive documentation for the target code:

1. Analyze the source code to understand:
   - Public APIs and interfaces
   - Function signatures and return types
   - Class hierarchies and relationships
   - Module dependencies
2. Generate documentation:
   - JSDoc/TSDoc comments for all public members
   - Parameter descriptions and return type documentation
   - Usage examples for complex APIs
   - Type constraint documentation for generics
3. Update or create README sections:
   - Module overview and purpose
   - Installation and setup instructions
   - Quick start examples
   - API reference table
4. For architecture-level documentation:
   - Module dependency diagrams (text-based)
   - Data flow descriptions
   - Design decision rationale
5. Ensure documentation follows project conventions
   - Match existing documentation style
   - Use consistent terminology`,
		isBuiltIn: true,
		requiredTools: ['read_file', 'write_file', 'search_codebase'],
		modifiesFiles: true,
	},
];

export class AgentSkillServiceImpl extends Disposable implements IAgentSkillService {
	declare readonly _serviceBrand: undefined;

	private skills: Map<string, IAgentSkill> = new Map();
	private loaded: boolean = false;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
		// Register built-in skills immediately
		for (const skill of builtInAgentSkills) {
			this.skills.set(skill.id, skill);
		}
	}

	async loadSkills(): Promise<ISkillLoadResult> {
		const errors: Array<{ path: string; error: string }> = [];

		if (this.loaded) {
			return { skills: this.getSkills(), errors };
		}

		this.loaded = true;

		// Built-in skills are already loaded in constructor.
		// Future: load custom skills from .kovix/agent-skills/ directory.
		this.logService.info(`[AgentSkillService] Loaded ${this.skills.size} built-in skills`);

		return { skills: this.getSkills(), errors };
	}

	getSkills(): IAgentSkill[] {
		return Array.from(this.skills.values());
	}

	getSkill(id: string): IAgentSkill | undefined {
		return this.skills.get(id);
	}

	searchSkills(query: string): IAgentSkill[] {
		const lowerQuery = query.toLowerCase();
		const terms = lowerQuery.split(/\s+/).filter(t => t.length > 0);

		return this.getSkills().filter(skill => {
			const searchableText = [
				skill.name,
				skill.description,
				skill.category,
				...skill.tags,
			].join(' ').toLowerCase();

			return terms.every(term => searchableText.includes(term));
		});
	}

	getSkillPrompt(skillIds: string[]): string {
		if (skillIds.length === 0) {
			return '';
		}

		const parts: string[] = [];

		for (const id of skillIds) {
			const skill = this.skills.get(id);
			if (!skill) {
				this.logService.warn(`[AgentSkillService] Unknown skill ID in prompt request: ${id}`);
				continue;
			}

			parts.push(`## Skill: ${skill.name} (${skill.category})\n\n${skill.instructions}\n\n**Required tools:** ${skill.requiredTools.join(', ')}\n**Modifies files:** ${skill.modifiesFiles ? 'Yes' : 'No'}`);
		}

		if (parts.length === 0) {
			return '';
		}

		return `# Active Agent Skills\n\nThe following skills are available for this session. Apply their instructions when relevant:\n\n${parts.join('\n\n---\n\n')}`;
	}
}
