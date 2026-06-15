// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { IChatMessage } from '../../../../../../platform/construct/common/llm/constructAIProvider.js';
import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';
import { IConstructMemoryService } from '../../../../../../platform/construct/common/memory/constructMemory.js';
import { IIdeaRefinementService } from '../../../../../../platform/construct/common/agent/ideaRefinementService.js';
import { IRefinementQuestion, IRefinementAnswer, IRefinedIdea, RefinementEvent } from '../../../../../../platform/construct/common/agent/ideaRefinementTypes.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of refinement rounds before forcing completion. */
const MAX_REFINEMENT_ROUNDS = 5;

/** Maximum time (ms) to wait for a single AI response before timing out. */
const AI_RESPONSE_TIMEOUT_MS = 60_000;

/** System prompt for the question-generation phase. */
const REFINEMENT_SYSTEM_PROMPT = `You are an expert software architect helping to refine a project idea. Generate 3-5 clarifying questions to understand the scope, technical requirements, and constraints. Return your questions as a JSON array where each element has:
- "id": a unique string identifier (e.g. "q1", "q2")
- "text": the question text
- "category": one of "scope", "technical", "ux", "architecture", "constraints", "goals"
- "suggestions": optional array of 2-4 suggested short answers
- "required": boolean indicating if the question must be answered

Focus on areas that are ambiguous or underspecified. Do not ask questions that are already clearly answered by the user's description. Return ONLY the JSON array, no other text.`;

/** System prompt for the refinement-completion phase. */
const COMPLETION_SYSTEM_PROMPT = `You are an expert software architect producing a refined project specification. Based on the original idea and the Q&A that followed, produce a detailed, well-scoped specification. Return your response as a JSON object with:
- "originalIdea": the original user input (verbatim)
- "refinedDescription": a clear, detailed description of the refined idea (2-4 paragraphs)
- "requirements": array of key functional and non-functional requirements (5-10 items)
- "technicalApproach": suggested technical approach / architecture (1-2 paragraphs)
- "risks": array of identified risks or constraints (2-5 items)
- "scope": object with "inScope" (array of what is included) and "outOfScope" (array of what is excluded)
- "confidence": number between 0 and 1 indicating how well you understand the idea

Return ONLY the JSON object, no other text.`;

/** System prompt for the skip-to-refined-idea path (no Q&A). */
const SKIP_SYSTEM_PROMPT = `You are an expert software architect producing a project specification from a rough idea. The user has chosen to skip the clarifying Q&A. Produce your best-effort refined specification based on the idea alone, making reasonable assumptions where details are missing. Return your response as a JSON object with:
- "originalIdea": the original user input (verbatim)
- "refinedDescription": a clear, detailed description (2-4 paragraphs)
- "requirements": array of key requirements (5-10 items)
- "technicalApproach": suggested technical approach (1-2 paragraphs)
- "risks": array of identified risks (2-5 items)
- "scope": object with "inScope" and "outOfScope" arrays
- "confidence": number between 0 and 1 (will be lower due to skipped Q&A)

Return ONLY the JSON object, no other text.`;

/** No tools are needed for the refinement Q&A. */
const NO_TOOLS: IToolDefinition[] = [];

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * IdeaRefinementServiceImpl — interactive Q&A service that refines a raw user
 * idea into a well-scoped specification before the Construct agent begins
 * planning or execution.
 *
 * Flow:
 * 1. User submits a raw idea → startRefinement()
 * 2. AI generates 3-5 clarifying questions
 * 3. User answers → submitAnswers()
 * 4. AI may generate more questions OR produce a final IRefinedIdea
 * 5. Repeat until AI returns a refined idea or user calls skipToRefinedIdea()
 *
 * Robustness:
 * - 4-level JSON parsing fallback (direct → code-fence → regex → heuristic)
 * - Per-round timeout with AbortController
 * - Conversation history tracked for multi-round Q&A
 * - Memory context injected from IConstructMemoryService
 * - Graceful cancellation via cancelRefinement()
 */
export class IdeaRefinementServiceImpl extends Disposable implements IIdeaRefinementService {
        readonly _serviceBrand: undefined;

        // ── State ──────────────────────────────────────────────────────────────

        private _isRefining = false;
        private _rawIdea: string = '';
        private _conversationMessages: IChatMessage[] = [];
        private _currentRound = 0;
        private _abortController: AbortController | null = null;

        // ── Events ─────────────────────────────────────────────────────────────

        private readonly _onRefinementEvent = this._register(new Emitter<RefinementEvent>());
        readonly onRefinementEvent = this._onRefinementEvent.event;

        // ── Constructor ────────────────────────────────────────────────────────

        constructor(
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[IdeaRefinement] Service created');
        }

        // ── Public API ─────────────────────────────────────────────────────────

        get isRefining(): boolean {
                return this._isRefining;
        }

        /**
         * Start the refinement process for a raw user idea.
         * Sends the idea to the AI, which generates 3-5 clarifying questions.
         */
        async startRefinement(idea: string): Promise<IRefinementQuestion[]> {
                if (this._isRefining) {
                        throw new Error('A refinement session is already in progress. Cancel it first.');
                }

                this._isRefining = true;
                this._rawIdea = idea;
                this._conversationMessages = [];
                this._currentRound = 0;

                this.logService.info(`[IdeaRefinement] Starting refinement for idea: "${idea.substring(0, 120)}..."`);

                try {
                        // Build system prompt with memory context
                        const systemPrompt = await this.buildSystemPrompt(REFINEMENT_SYSTEM_PROMPT, idea);

                        // Build the initial user message
                        const userMessage: IChatMessage = {
                                role: 'user',
                                content: `Here is my project idea:\n\n${idea}\n\nGenerate clarifying questions to help refine this idea.`,
                        };

                        this._conversationMessages.push(userMessage);

                        // Call the AI
                        const rawResponse = await this.callAI(systemPrompt);

                        // Parse questions from response
                        const questions = this.parseQuestionsResponse(rawResponse);

                        this._currentRound++;

                        this._onRefinementEvent.fire({ type: 'questions_generated', questions });

                        this.logService.info(`[IdeaRefinement] Generated ${questions.length} questions (round ${this._currentRound})`);
                        return questions;
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[IdeaRefinement] startRefinement failed: ${msg}`);
                        this._onRefinementEvent.fire({ type: 'error', text: msg });
                        this.cleanup();
                        throw error;
                }
        }

        /**
         * Submit answers to the current refinement questions.
         * The AI may generate more questions or produce a final IRefinedIdea.
         */
        async submitAnswers(answers: IRefinementAnswer[]): Promise<
                | { type: 'questions'; questions: IRefinementQuestion[] }
                | { type: 'complete'; refinedIdea: IRefinedIdea }
        > {
                if (!this._isRefining) {
                        throw new Error('No refinement session is active. Call startRefinement() first.');
                }

                if (this._currentRound >= MAX_REFINEMENT_ROUNDS) {
                        this.logService.info('[IdeaRefinement] Max rounds reached, forcing completion');
                        return this.forceCompletion();
                }

                this.logService.info(`[IdeaRefinement] Submitting ${answers.length} answers (round ${this._currentRound})`);

                // Fire events for each answer received
                for (const answer of answers) {
                        this._onRefinementEvent.fire({ type: 'answer_received', answer });
                }

                try {
                        // Build the user message containing the answers
                        const answerLines = answers.map(a => {
                                const label = a.skipped ? '[SKIPPED]' : '';
                                return `**Q: ${a.questionId}** ${label}\nA: ${a.text}`;
                        });
                        const userMessage: IChatMessage = {
                                role: 'user',
                                content: `Here are my answers:\n\n${answerLines.join('\n\n')}\n\n${
                                        this._currentRound < MAX_REFINEMENT_ROUNDS - 1
                                                ? 'If you have enough information to produce a refined specification, respond with a JSON object. Otherwise, generate more clarifying questions as a JSON array.'
                                                : 'Please produce the final refined specification now as a JSON object.'
                                }`,
                        };

                        this._conversationMessages.push(userMessage);

                        // Build system prompt with memory context
                        const systemPrompt = await this.buildSystemPrompt(REFINEMENT_SYSTEM_PROMPT, this._rawIdea);

                        // Call the AI
                        const rawResponse = await this.callAI(systemPrompt);

                        // Try to parse as a refined idea first (completion)
                        const refinedIdea = this.tryParseRefinedIdea(rawResponse);
                        if (refinedIdea) {
                                this._onRefinementEvent.fire({ type: 'refinement_complete', refinedIdea });
                                this.logService.info('[IdeaRefinement] Refinement complete (AI produced final specification)');
                                this.cleanup();
                                return { type: 'complete', refinedIdea };
                        }

                        // Try to parse as more questions
                        const questions = this.parseQuestionsResponse(rawResponse);
                        if (questions.length > 0) {
                                this._currentRound++;
                                this._onRefinementEvent.fire({ type: 'more_questions', questions });
                                this.logService.info(`[IdeaRefinement] AI generated ${questions.length} more questions (round ${this._currentRound})`);
                                return { type: 'questions', questions };
                        }

                        // If neither worked, force completion with whatever we have
                        this.logService.warn('[IdeaRefinement] AI response could not be parsed as questions or refined idea; forcing completion');
                        return this.forceCompletion();
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[IdeaRefinement] submitAnswers failed: ${msg}`);
                        this._onRefinementEvent.fire({ type: 'error', text: msg });
                        throw error;
                }
        }

        /**
         * Skip the refinement process and produce a best-effort refined idea
         * from whatever information is available (the raw idea plus any
         * answers already given).
         */
        async skipToRefinedIdea(): Promise<IRefinedIdea> {
                if (!this._isRefining) {
                        throw new Error('No refinement session is active. Call startRefinement() first.');
                }

                this.logService.info('[IdeaRefinement] Skipping to refined idea');

                try {
                        // If we have no conversation history, just ask the AI to produce from the raw idea
                        if (this._conversationMessages.length === 0) {
                                const systemPrompt = await this.buildSystemPrompt(SKIP_SYSTEM_PROMPT, this._rawIdea);
                                const userMessage: IChatMessage = {
                                        role: 'user',
                                        content: `Here is my project idea:\n\n${this._rawIdea}\n\nProduce a refined specification based on this idea.`,
                                };
                                this._conversationMessages.push(userMessage);

                                const rawResponse = await this.callAI(systemPrompt);
                                const refinedIdea = this.parseRefinedIdeaResponse(rawResponse);

                                this._onRefinementEvent.fire({ type: 'refinement_complete', refinedIdea });
                                this.cleanup();
                                return refinedIdea;
                        }

                        // Otherwise, ask the AI to produce the specification from existing context
                        const skipMessage: IChatMessage = {
                                role: 'user',
                                content: 'I want to skip the remaining questions. Please produce the final refined specification now based on the information we have discussed. Return the JSON object.',
                        };
                        this._conversationMessages.push(skipMessage);

                        const systemPrompt = await this.buildSystemPrompt(COMPLETION_SYSTEM_PROMPT, this._rawIdea);
                        const rawResponse = await this.callAI(systemPrompt);
                        const refinedIdea = this.parseRefinedIdeaResponse(rawResponse);

                        this._onRefinementEvent.fire({ type: 'refinement_complete', refinedIdea });
                        this.cleanup();
                        return refinedIdea;
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[IdeaRefinement] skipToRefinedIdea failed: ${msg}`);
                        this._onRefinementEvent.fire({ type: 'error', text: msg });
                        this.cleanup();
                        throw error;
                }
        }

        /**
         * Cancel the current refinement session and clean up all state.
         */
        cancelRefinement(): void {
                if (!this._isRefining) {
                        return;
                }

                this.logService.info('[IdeaRefinement] Refinement cancelled');
                this.cleanup();
        }

        // ── Private: AI Interaction ────────────────────────────────────────────

        /**
         * Call the AI service with the current conversation messages and
         * return the full text response.
         */
        private async callAI(systemPrompt: string): Promise<string> {
                // Set up abort controller with timeout
                this._abortController = new AbortController();
                const timeoutId = setTimeout(() => {
                        this._abortController?.abort();
                }, AI_RESPONSE_TIMEOUT_MS);

                try {
                        const stream = this.aiService.chat(
                                this._conversationMessages,
                                NO_TOOLS,
                                { signal: this._abortController.signal, systemPrompt }
                        );

                        let fullText = '';

                        for await (const event of stream) {
                                switch (event.type) {
                                        case 'token':
                                                fullText += event.text;
                                                break;
                                        case 'error':
                                                throw new Error(`AI service error: ${event.text}`);
                                        case 'done':
                                                break;
                                }
                        }

                        // Add the assistant response to conversation history
                        if (fullText) {
                                this._conversationMessages.push({
                                        role: 'assistant',
                                        content: fullText,
                                });
                        }

                        return fullText;
                } finally {
                        clearTimeout(timeoutId);
                        this._abortController = null;
                }
        }

        /**
         * Build a system prompt by appending memory context from the
         * Construct memory service (if available).
         */
        private async buildSystemPrompt(basePrompt: string, task: string): Promise<string> {
                let prompt = basePrompt;

                try {
                        const memoryContext = await this.constructMemory.getContextForTask(task);
                        if (memoryContext) {
                                prompt += `\n\n--- User Context from Memory ---\n${memoryContext}`;
                        }
                } catch {
                        // Memory retrieval is non-critical; proceed without it
                        this.logService.debug('[IdeaRefinement] Memory context unavailable, proceeding without');
                }

                return prompt;
        }

        // ── Private: JSON Parsing ──────────────────────────────────────────────

        /**
         * Parse the AI response as an array of IRefinementQuestion objects.
         * Uses a 4-level parsing fallback:
         *   1. Direct JSON parse
         *   2. Extract JSON from markdown code fences
         *   3. Regex brace matching to find JSON array
         *   4. Heuristic line-by-line parsing
         */
        private parseQuestionsResponse(raw: string): IRefinementQuestion[] {
                // Level 1: Direct JSON parse
                try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) {
                                return this.validateQuestions(parsed);
                        }
                } catch {
                        // Fall through to next level
                }

                // Level 2: Extract JSON from markdown code fences (```json ... ``` or ``` ... ```)
                const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
                if (fenceMatch) {
                        try {
                                const parsed = JSON.parse(fenceMatch[1]);
                                if (Array.isArray(parsed)) {
                                        return this.validateQuestions(parsed);
                                }
                        } catch {
                                // Fall through
                        }
                }

                // Level 3: Regex brace matching — find the first top-level JSON array
                const braceMatch = this.extractJsonArray(raw);
                if (braceMatch) {
                        try {
                                const parsed = JSON.parse(braceMatch);
                                if (Array.isArray(parsed)) {
                                        return this.validateQuestions(parsed);
                                }
                        } catch {
                                // Fall through
                        }
                }

                // Level 4: Heuristic line-by-line parsing
                return this.heuristicParseQuestions(raw);
        }

        /**
         * Try to parse the AI response as a single IRefinedIdea object.
         * Returns undefined if parsing fails.
         */
        private tryParseRefinedIdea(raw: string): IRefinedIdea | undefined {
                // Level 1: Direct JSON parse
                try {
                        const parsed = JSON.parse(raw);
                        if (this.isRefinedIdeaShape(parsed)) {
                                return this.validateRefinedIdea(parsed);
                        }
                } catch {
                        // Fall through
                }

                // Level 2: Code fence extraction
                const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
                if (fenceMatch) {
                        try {
                                const parsed = JSON.parse(fenceMatch[1]);
                                if (this.isRefinedIdeaShape(parsed)) {
                                        return this.validateRefinedIdea(parsed);
                                }
                        } catch {
                                // Fall through
                        }
                }

                // Level 3: Regex brace matching for JSON object
                const braceMatch = this.extractJsonObject(raw);
                if (braceMatch) {
                        try {
                                const parsed = JSON.parse(braceMatch);
                                if (this.isRefinedIdeaShape(parsed)) {
                                        return this.validateRefinedIdea(parsed);
                                }
                        } catch {
                                // Fall through
                        }
                }

                return undefined;
        }

        /**
         * Parse the AI response as an IRefinedIdea, throwing if it cannot be parsed.
         * Used in paths where we expect a refined idea response.
         */
        private parseRefinedIdeaResponse(raw: string): IRefinedIdea {
                const result = this.tryParseRefinedIdea(raw);
                if (result) {
                        return result;
                }

                // Level 4: Heuristic — construct a minimal refined idea from raw text
                this.logService.warn('[IdeaRefinement] Could not parse AI response as refined idea JSON; using heuristic fallback');
                return this.heuristicParseRefinedIdea(raw);
        }

        /**
         * Extract the first top-level JSON array from a string using brace counting.
         */
        private extractJsonArray(text: string): string | null {
                const start = text.indexOf('[');
                if (start === -1) {
                        return null;
                }

                let depth = 0;
                let inString = false;
                let escape = false;

                for (let i = start; i < text.length; i++) {
                        const ch = text[i];

                        if (escape) {
                                escape = false;
                                continue;
                        }

                        if (ch === '\\' && inString) {
                                escape = true;
                                continue;
                        }

                        if (ch === '"') {
                                inString = !inString;
                                continue;
                        }

                        if (inString) {
                                continue;
                        }

                        if (ch === '[') {
                                depth++;
                        } else if (ch === ']') {
                                depth--;
                                if (depth === 0) {
                                        return text.substring(start, i + 1);
                                }
                        }
                }

                return null;
        }

        /**
         * Extract the first top-level JSON object from a string using brace counting.
         */
        private extractJsonObject(text: string): string | null {
                const start = text.indexOf('{');
                if (start === -1) {
                        return null;
                }

                let depth = 0;
                let inString = false;
                let escape = false;

                for (let i = start; i < text.length; i++) {
                        const ch = text[i];

                        if (escape) {
                                escape = false;
                                continue;
                        }

                        if (ch === '\\' && inString) {
                                escape = true;
                                continue;
                        }

                        if (ch === '"') {
                                inString = !inString;
                                continue;
                        }

                        if (inString) {
                                continue;
                        }

                        if (ch === '{') {
                                depth++;
                        } else if (ch === '}') {
                                depth--;
                                if (depth === 0) {
                                        return text.substring(start, i + 1);
                                }
                        }
                }

                return null;
        }

        /**
         * Validate and normalise an array of raw question objects into
         * properly typed IRefinementQuestion instances.
         */
        private validateQuestions(raw: unknown[]): IRefinementQuestion[] {
                const validCategories = new Set(['scope', 'technical', 'ux', 'architecture', 'constraints', 'goals']);
                const questions: IRefinementQuestion[] = [];

                for (let i = 0; i < raw.length; i++) {
                        const item = raw[i] as Record<string, unknown>;
                        if (!item || typeof item !== 'object') {
                                continue;
                        }

                        const id = typeof item.id === 'string' ? item.id : `q${i + 1}`;
                        const text = typeof item.text === 'string' ? item.text : '';
                        if (!text) {
                                continue; // Skip items without question text
                        }

                        const category = typeof item.category === 'string' && validCategories.has(item.category)
                                ? item.category as IRefinementQuestion['category']
                                : 'scope';

                        const suggestions = Array.isArray(item.suggestions)
                                ? item.suggestions.filter((s: unknown) => typeof s === 'string')
                                : undefined;

                        const required = typeof item.required === 'boolean' ? item.required : undefined;

                        questions.push({ id, text, category, suggestions, required });
                }

                return questions;
        }

        /**
         * Check if a parsed object has the shape of an IRefinedIdea.
         */
        private isRefinedIdeaShape(obj: unknown): boolean {
                if (!obj || typeof obj !== 'object') {
                        return false;
                }
                const o = obj as Record<string, unknown>;
                return (
                        typeof o.refinedDescription === 'string' &&
                        Array.isArray(o.requirements) &&
                        typeof o.technicalApproach === 'string' &&
                        Array.isArray(o.risks) &&
                        typeof o.scope === 'object' && o.scope !== null
                );
        }

        /**
         * Validate and normalise a raw object into a properly typed IRefinedIdea.
         */
        private validateRefinedIdea(obj: unknown): IRefinedIdea {
                const o = obj as Record<string, unknown>;
                const scope = (typeof o.scope === 'object' && o.scope !== null) ? o.scope as Record<string, unknown> : {};

                return {
                        originalIdea: typeof o.originalIdea === 'string' ? o.originalIdea : this._rawIdea,
                        refinedDescription: typeof o.refinedDescription === 'string' ? o.refinedDescription : '',
                        requirements: Array.isArray(o.requirements)
                                ? o.requirements.filter((r: unknown) => typeof r === 'string') as string[]
                                : [],
                        technicalApproach: typeof o.technicalApproach === 'string' ? o.technicalApproach : '',
                        risks: Array.isArray(o.risks)
                                ? o.risks.filter((r: unknown) => typeof r === 'string') as string[]
                                : [],
                        scope: {
                                inScope: Array.isArray((scope as Record<string, unknown>).inScope)
                                        ? ((scope as Record<string, unknown>).inScope as unknown[]).filter((s: unknown) => typeof s === 'string') as string[]
                                        : [],
                                outOfScope: Array.isArray((scope as Record<string, unknown>).outOfScope)
                                        ? ((scope as Record<string, unknown>).outOfScope as unknown[]).filter((s: unknown) => typeof s === 'string') as string[]
                                        : [],
                        },
                        confidence: typeof o.confidence === 'number'
                                ? Math.max(0, Math.min(1, o.confidence))
                                : 0.5,
                };
        }

        // ── Private: Heuristic Parsing Fallbacks ───────────────────────────────

        /**
         * Heuristic: attempt to extract questions from the AI response when
         * all JSON parsing has failed. Looks for numbered or bulleted lines
         * that contain question marks.
         */
        private heuristicParseQuestions(raw: string): IRefinementQuestion[] {
                const lines = raw.split('\n');
                const questions: IRefinementQuestion[] = [];
                let questionIndex = 0;

                for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) {
                                continue;
                        }

                        // Match lines that look like numbered questions: "1. What...?" or "- What...?"
                        const questionMatch = trimmed.match(/^(?:\d+[\.\)]\s*|[-*]\s*)(.+\?.*)$/);
                        if (questionMatch) {
                                questionIndex++;
                                questions.push({
                                        id: `q${questionIndex}`,
                                        text: questionMatch[1].trim(),
                                        category: 'scope',
                                });
                        }
                }

                if (questions.length > 0) {
                        this.logService.info(`[IdeaRefinement] Heuristic parsing extracted ${questions.length} questions`);
                } else {
                        this.logService.warn('[IdeaRefinement] Heuristic parsing found no questions in AI response');
                }

                return questions;
        }

        /**
         * Heuristic: construct a minimal IRefinedIdea from raw text when
         * JSON parsing has failed entirely.
         */
        private heuristicParseRefinedIdea(raw: string): IRefinedIdea {
                // Try to extract meaningful paragraphs
                const paragraphs = raw
                        .split(/\n{2,}/)
                        .map(p => p.trim())
                        .filter(p => p.length > 20 && !p.startsWith('```'));

                const refinedDescription = paragraphs.length > 0
                        ? paragraphs.slice(0, 3).join('\n\n')
                        : 'Unable to generate a refined description from the AI response.';

                return {
                        originalIdea: this._rawIdea,
                        refinedDescription,
                        requirements: [],
                        technicalApproach: '',
                        risks: ['Refinement was produced via heuristic fallback — the specification may be incomplete.'],
                        scope: { inScope: [], outOfScope: [] },
                        confidence: 0.2,
                };
        }

        // ── Private: Force Completion ──────────────────────────────────────────

        /**
         * Force the refinement to complete by asking the AI to produce the
         * final specification from the current conversation context.
         */
        private async forceCompletion(): Promise<{ type: 'complete'; refinedIdea: IRefinedIdea }> {
                this.logService.info('[IdeaRefinement] Forcing completion from existing conversation');

                const forceMessage: IChatMessage = {
                        role: 'user',
                        content: 'Please produce the final refined specification now as a JSON object. We have enough information.',
                };
                this._conversationMessages.push(forceMessage);

                const systemPrompt = await this.buildSystemPrompt(COMPLETION_SYSTEM_PROMPT, this._rawIdea);
                const rawResponse = await this.callAI(systemPrompt);
                const refinedIdea = this.parseRefinedIdeaResponse(rawResponse);

                this._onRefinementEvent.fire({ type: 'refinement_complete', refinedIdea });
                this.cleanup();
                return { type: 'complete', refinedIdea };
        }

        // ── Private: Cleanup ───────────────────────────────────────────────────

        /**
         * Reset all internal state and abort any in-flight AI request.
         */
        private cleanup(): void {
                if (this._abortController) {
                        this._abortController.abort();
                        this._abortController = null;
                }
                this._isRefining = false;
                this._rawIdea = '';
                this._conversationMessages = [];
                this._currentRound = 0;
        }

        // ── Lifecycle ──────────────────────────────────────────────────────────

        override dispose(): void {
                this.cleanup();
                super.dispose();
                this.logService.info('[IdeaRefinement] Service disposed');
        }
}
