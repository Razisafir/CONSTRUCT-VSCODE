// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { IChatMessage } from '../../../../../../platform/construct/common/llm/constructAIProvider.js';
import { IConstructToolRegistry } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';
import { IDocumentToSkillConverter } from '../../../../../../platform/construct/common/skill/documentToSkillConverter.js';
import {
        IDocumentToSkillInput,
        IDocumentToSkillResult,
        ISkillManifest,
        validateSkillManifest,
} from '../../../../../../platform/construct/common/skill/skillTypes.js';

/**
 * System prompt for the LLM that converts a document into a skill manifest.
 *
 * The LLM is asked to return a single JSON object (no markdown fences, no
 * commentary) matching the ISkillManifest shape. We then parse + validate.
 */
const CONVERSION_SYSTEM_PROMPT = `You are a skill-extraction assistant for the Kovix AI coding agent.

Given a Markdown document (e.g. a runbook, code-review checklist, debugging guide, or workflow doc), extract a structured "skill" definition that the Kovix agent can load to handle tasks of that kind.

Return ONLY a single JSON object with this exact schema (no markdown fences, no commentary, no leading/trailing text):

{
  "name": "kebab-case-name",
  "description": "One-sentence description of what this skill does.",
  "version": "1.0.0",
  "systemPrompt": "A self-contained system prompt fragment the agent will use when this skill is active. Should be 3-10 sentences, instruction-style, second person. Must not reference external resources.",
  "allowedTools": ["read_file", "write_file", "run_command", "search_codebase", "list_directory", "create_directory", "edit_file", "web_search"],
  "triggers": {
    "keywords": ["phrase one", "phrase two"],
    "autoInvoke": false
  },
  "examples": [
    { "user": "Example user input that should trigger this skill", "expectedBehavior": "What the skill should do in response" }
  ]
}

Rules:
- "name" MUST be lowercase kebab-case (a-z, 0-9, hyphens).
- "allowedTools" MUST be a subset of the tool names listed in the Available Tools section below. If no tools are needed, return an empty array.
- "triggers.keywords" should contain 2-5 short phrases a user might naturally type.
- "triggers.autoInvoke" should be false unless the skill is safe to run without confirmation (rare).
- "examples" should contain 1-3 representative interactions.
- The "systemPrompt" is the most important field. It should encode the document's instructions as direct commands to the agent.`;

/**
 * DocumentToSkillConverterService — LLM-backed implementation.
 *
 * Workflow:
 * 1. Build a user-message containing the document + the list of available tools.
 * 2. Call IConstructAIService.chat() with the conversion system prompt.
 * 3. Accumulate the streamed response.
 * 4. Parse the response as JSON, validate against the schema.
 * 5. Fill in sourceDocument, createdAt, updatedAt.
 * 6. Return the manifest + any warnings.
 */
export class DocumentToSkillConverterService extends Disposable implements IDocumentToSkillConverter {
        readonly _serviceBrand: undefined;

        constructor(
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IConstructToolRegistry private readonly toolRegistry: IConstructToolRegistry,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[DocToSkill] Service created');
        }

        async convert(input: IDocumentToSkillInput): Promise<IDocumentToSkillResult> {
                if (!this.aiService.activeProvider) {
                        throw new Error('No AI provider available. Install Ollama or configure a cloud provider in Settings.');
                }

                // Build the list of available tool names so the LLM can pick a subset.
                const availableTools = this.toolRegistry.listTools().map(t => t.name);
                const toolList = availableTools.length > 0
                        ? availableTools.join(', ')
                        : '(no tools registered)';

                const userMessage = `Available Tools: ${toolList}

Source document path: ${input.sourcePath}
${input.nameHint ? `Suggested name (override if inappropriate): ${input.nameHint}` : ''}

Document content:
---
${input.content}
---

Extract the skill JSON now. Remember: ONLY the JSON object, no fences, no commentary.`;

                const messages: IChatMessage[] = [
                        { role: 'user', content: userMessage },
                ];

                // Accumulate the streamed response.
                let rawResponse = '';
                const stream = this.aiService.chat(messages, [], { systemPrompt: CONVERSION_SYSTEM_PROMPT });
                for await (const event of stream) {
                        if (event.type === 'token') {
                                rawResponse += event.text;
                        } else if (event.type === 'error') {
                                throw new Error(`LLM error during conversion: ${event.text}`);
                        }
                        // Ignore tool_start/tool_end/done — we don't request tools.
                }

                // Strip markdown fences if the LLM added them anyway.
                const cleaned = rawResponse
                        .replace(/^```(?:json)?\s*\n?/i, '')
                        .replace(/\n?```\s*$/i, '')
                        .trim();

                let parsed: unknown;
                try {
                        parsed = JSON.parse(cleaned);
                } catch (err) {
                        this.logService.error('[DocToSkill] Failed to parse LLM output as JSON:', cleaned.substring(0, 500));
                        throw new Error(`LLM did not return valid JSON. Parse error: ${err instanceof Error ? err.message : String(err)}. First 200 chars: ${cleaned.substring(0, 200)}`);
                }

                const errors = validateSkillManifest(parsed);
                if (errors.length > 0) {
                        throw new Error(`LLM output failed validation:\n  - ${errors.join('\n  - ')}`);
                }

                const warnings: string[] = [];
                const manifest = parsed as Omit<ISkillManifest, 'sourceDocument' | 'createdAt' | 'updatedAt'>;

                // Check that all allowedTools actually exist in the registry.
                const toolNamesSet = new Set(availableTools);
                const unknownTools = manifest.allowedTools.filter(t => !toolNamesSet.has(t));
                if (unknownTools.length > 0) {
                        warnings.push(`LLM returned allowedTools that are not in the registry: ${unknownTools.join(', ')}. These will be filtered out on save.`);
                }

                // Warn if no triggers.
                if (manifest.triggers.keywords.length === 0) {
                        warnings.push('No trigger keywords provided. The skill can only be invoked manually.');
                }

                const now = new Date().toISOString();
                const fullManifest: ISkillManifest = {
                        ...manifest,
                        sourceDocument: input.sourcePath,
                        createdAt: now,
                        updatedAt: now,
                };

                this.logService.info(`[DocToSkill] Conversion complete: "${fullManifest.name}" with ${fullManifest.allowedTools.length} tools, ${fullManifest.triggers.keywords.length} triggers`);
                return { manifest: fullManifest, warnings };
        }

        async saveSkill(manifest: ISkillManifest, workspaceRoot: string): Promise<string> {
                // Re-validate before writing.
                const errors = validateSkillManifest(manifest);
                if (errors.length > 0) {
                        throw new Error(`Cannot save invalid manifest:\n  - ${errors.join('\n  - ')}`);
                }

                // Filter out any allowedTools that are not in the registry.
                const availableTools = new Set(this.toolRegistry.listTools().map(t => t.name));
                const filteredTools = manifest.allowedTools.filter(t => availableTools.has(t));

                const finalManifest: ISkillManifest = {
                        ...manifest,
                        allowedTools: filteredTools,
                };

                // Use the file service via dynamic import to avoid a hard
                // dependency on the file service in this constructor (keeps
                // the service browser-safe). The node fs module is used
                // directly because the file service API for writing arbitrary
                // paths outside the workspace can be restricted.
                const fs = await import('fs');
                const path = await import('path');

                const skillsDir = path.join(workspaceRoot, '.kovix', 'skills');
                await fs.promises.mkdir(skillsDir, { recursive: true });

                const filePath = path.join(skillsDir, `${finalManifest.name}.json`);
                await fs.promises.writeFile(filePath, JSON.stringify(finalManifest, null, 2), 'utf8');

                this.logService.info(`[DocToSkill] Saved skill "${finalManifest.name}" to ${filePath}`);
                return filePath;
        }

        async listSkills(workspaceRoot: string): Promise<ISkillManifest[]> {
                const fs = await import('fs');
                const path = await import('path');

                const skillsDir = path.join(workspaceRoot, '.kovix', 'skills');
                try {
                        const entries = await fs.promises.readdir(skillsDir);
                        const jsonFiles = entries.filter(e => e.endsWith('.json'));
                        const manifests: ISkillManifest[] = [];
                        for (const file of jsonFiles) {
                                const fullPath = path.join(skillsDir, file);
                                try {
                                        const content = await fs.promises.readFile(fullPath, 'utf8');
                                        const parsed = JSON.parse(content);
                                        const errors = validateSkillManifest(parsed);
                                        if (errors.length === 0) {
                                                manifests.push(parsed as ISkillManifest);
                                        } else {
                                                this.logService.warn(`[DocToSkill] Skipping invalid skill file ${file}: ${errors[0]}`);
                                        }
                                } catch (err) {
                                        this.logService.warn(`[DocToSkill] Failed to read ${file}:`, err instanceof Error ? err.message : String(err));
                                }
                        }
                        return manifests;
                } catch (err) {
                        // Directory doesn't exist or unreadable — return empty.
                        return [];
                }
        }
}
