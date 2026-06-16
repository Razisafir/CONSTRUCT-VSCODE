// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Skill types for the document-to-skill converter (audit finding F-005 / Section 6.6).
 *
 * A "skill" in Kovix is a declarative capability definition. The agent can
 * load a skill manifest and use its system prompt + allowed tools + triggers
 * to handle a specific category of tasks (e.g. "code review", "debug Python",
 * "write commit messages").
 *
 * The document-to-skill converter takes a Markdown document (runbook,
 * checklist, guide) and uses the LLM to extract these five components,
 * producing a JSON skill manifest that the agent can load.
 */

/**
 * A single example interaction for a skill.
 * Used by the LLM to understand the expected behavior pattern.
 */
export interface ISkillExample {
        /** The user's input that should trigger this skill. */
        readonly user: string;
        /** A description of what the skill should do in response. */
        readonly expectedBehavior: string;
}

/**
 * Trigger conditions for auto-invoking a skill.
 * If any keyword matches the user's message, the skill is suggested.
 */
export interface ISkillTriggers {
        /** Keywords/phrases that should trigger this skill. */
        readonly keywords: string[];
        /** Whether to auto-invoke without user confirmation. */
        readonly autoInvoke: boolean;
}

/**
 * The complete skill manifest.
 *
 * Stored as JSON in `<workspace>/.kovix/skills/<name>.json`.
 * Loaded by the skill registry (future work) and used to augment the
 * agent's system prompt and tool whitelist when triggered.
 */
export interface ISkillManifest {
        /** Unique skill name (kebab-case, e.g. "code-review"). */
        readonly name: string;
        /** Human-readable description of what the skill does. */
        readonly description: string;
        /** Semantic version (e.g. "1.0.0"). */
        readonly version: string;
        /**
         * Path to the source document this skill was derived from.
         * Empty string for manually-authored skills.
         */
        readonly sourceDocument: string;
        /**
         * The system prompt fragment injected into the agent's context
         * when this skill is active. Should be self-contained and not
         * reference external resources.
         */
        readonly systemPrompt: string;
        /**
         * Whitelist of tool names this skill is allowed to use.
         * Must be a subset of names returned by IConstructToolRegistry.listTools().
         * Empty array means "no tools" — skill can only respond with text.
         */
        readonly allowedTools: string[];
        /** Trigger conditions for auto-invocation. */
        readonly triggers: ISkillTriggers;
        /** Optional example interactions for the LLM. */
        readonly examples: ISkillExample[];
        /** ISO 8601 creation timestamp. */
        readonly createdAt: string;
        /** ISO 8601 last-updated timestamp. */
        readonly updatedAt: string;
}

/**
 * Input to the document-to-skill converter.
 */
export interface IDocumentToSkillInput {
        /** The raw document content (Markdown, plain text, etc.). */
        readonly content: string;
        /** The source path or filename, recorded in sourceDocument. */
        readonly sourcePath: string;
        /**
         * Optional name override. If not provided, the converter derives
         * a kebab-case name from the document's first heading or filename.
         */
        readonly nameHint?: string;
}

/**
 * Result of a document-to-skill conversion.
 */
export interface IDocumentToSkillResult {
        /** The generated skill manifest. */
        readonly manifest: ISkillManifest;
        /**
         * Warnings produced during conversion (e.g. "no allowed tools
         * identified — defaulted to empty array"). The UI should display
         * these to the user before saving.
         */
        readonly warnings: string[];
}

/**
 * Validate a skill manifest. Returns a list of error messages
 * (empty array = valid). Used before saving to disk.
 */
export function validateSkillManifest(manifest: unknown): string[] {
        const errors: string[] = [];
        if (typeof manifest !== 'object' || manifest === null) {
                return ['Manifest must be a JSON object.'];
        }
        const m = manifest as Record<string, unknown>;

        if (typeof m.name !== 'string' || !m.name) {
                errors.push('Field "name" must be a non-empty string.');
        } else if (!/^[a-z0-9-]+$/.test(m.name)) {
                errors.push('Field "name" must be kebab-case (lowercase letters, digits, hyphens only).');
        }

        if (typeof m.description !== 'string' || !m.description) {
                errors.push('Field "description" must be a non-empty string.');
        }

        if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) {
                errors.push('Field "version" must be semver (e.g. "1.0.0").');
        }

        if (typeof m.systemPrompt !== 'string' || m.systemPrompt.length < 10) {
                errors.push('Field "systemPrompt" must be a string of at least 10 characters.');
        }

        if (!Array.isArray(m.allowedTools)) {
                errors.push('Field "allowedTools" must be an array of tool name strings.');
        } else {
                for (const t of m.allowedTools) {
                        if (typeof t !== 'string') {
                                errors.push('Each entry in "allowedTools" must be a string.');
                                break;
                        }
                }
        }

        if (typeof m.triggers !== 'object' || m.triggers === null) {
                errors.push('Field "triggers" must be an object.');
        } else {
                const tr = m.triggers as Record<string, unknown>;
                if (!Array.isArray(tr.keywords)) {
                        errors.push('Field "triggers.keywords" must be an array.');
                }
                if (typeof tr.autoInvoke !== 'boolean') {
                        errors.push('Field "triggers.autoInvoke" must be a boolean.');
                }
        }

        if (!Array.isArray(m.examples)) {
                errors.push('Field "examples" must be an array.');
        }

        return errors;
}
