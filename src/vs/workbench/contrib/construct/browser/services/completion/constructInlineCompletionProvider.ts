// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IConstructInlineCompletionProvider } from '../../../../../../platform/construct/common/completion/constructInlineCompletion.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { Position } from '../../../../../../editor/common/core/position.js';
import { InlineCompletion, InlineCompletions } from '../../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';

/**
 * ConstructInlineCompletionProvider — AI-powered inline completion service.
 *
 * Implements the IConstructInlineCompletionProvider service interface to provide
 * debounced, context-aware inline code completions powered by the Construct AI.
 *
 * Features:
 * - Debounces requests (500ms minimum between calls) to avoid flooding the AI
 * - Gathers file context (50 lines before cursor, 10 after) for better suggestions
 * - Delegates to IConstructAIService.complete() for generation
 * - Returns InlineCompletion[] compatible with VS Code's inline completions API
 * - Respects the `construct.inlineCompletion.enabled` user setting
 */
export class ConstructInlineCompletionProvider extends Disposable implements IConstructInlineCompletionProvider {
	readonly _serviceBrand: undefined;

	/** Minimum interval between AI completion requests (ms) */
	private static readonly DEBOUNCE_MS = 500;

	/** Lines of context before the cursor */
	private static readonly CONTEXT_LINES_BEFORE = 50;

	/** Lines of context after the cursor */
	private static readonly CONTEXT_LINES_AFTER = 10;

	private _lastRequestTime: number = 0;
	private _pendingTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly _onDidChangeCompletions = this._register(new Emitter<void>());
	readonly onDidChangeCompletions: Event<void> = this._onDidChangeCompletions.event;

	constructor(
		@IConstructAIService private readonly aiService: IConstructAIService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	/**
	 * Provide inline completions for the given position in the model.
	 * Debounces requests so that at least DEBOUNCE_MS elapses between AI calls.
	 *
	 * @param model The text model.
	 * @param position The cursor position.
	 * @param token Cancellation token.
	 * @returns InlineCompletions or undefined.
	 */
	async provideInlineCompletions(
		model: ITextModel,
		position: Position,
		token: CancellationToken,
	): Promise<InlineCompletions | undefined> {
		// Check if inline completions are enabled via user setting
		const enabled = this.configService.getValue<boolean>('construct.inlineCompletion.enabled');
		if (!enabled) {
			return undefined;
		}

		if (token.isCancellationRequested) {
			return undefined;
		}

		// Debounce: enforce minimum interval between requests
		const now = Date.now();
		const elapsed = now - this._lastRequestTime;
		if (elapsed < ConstructInlineCompletionProvider.DEBOUNCE_MS) {
			const waitMs = ConstructInlineCompletionProvider.DEBOUNCE_MS - elapsed;
			await new Promise<void>(resolve => {
				this._pendingTimer = setTimeout(resolve, waitMs);
			});
			if (token.isCancellationRequested) {
				return undefined;
			}
		}

		this._lastRequestTime = Date.now();

		// Gather file context
		const { prefix, suffix } = this.getFileContext(model, position);

		// Skip if prefix is too short (user just started typing)
		if (prefix.trim().length < 10) {
			return undefined;
		}

		try {
			const result = await this.aiService.complete(prefix, suffix, {
				maxTokens: 200,
				temperature: 0.2,
			});

			if (token.isCancellationRequested || !result.text) {
				return undefined;
			}

			// Clean up the completion text
			const completionText = result.text.trim();
			if (!completionText) {
				return undefined;
			}

			// Build the inline completion item
			const replaceRange = new Range(
				position.lineNumber,
				position.column,
				position.lineNumber,
				position.column,
			);

			const items: InlineCompletion[] = [{
				insertText: completionText,
				range: replaceRange,
				completeBracketPairs: true,
			}];

			return {
				items,
				suppressSuggestions: true,
				enableForwardStability: true,
			};
		} catch (error) {
			this.logService.debug('[ConstructInlineCompletion] Completion failed:', error);
			return undefined;
		}
	}

	/**
	 * Extract file context around the cursor position.
	 * Returns prefix (50 lines before + current line up to cursor)
	 * and suffix (10 lines after cursor position).
	 */
	private getFileContext(model: ITextModel, position: Position): { prefix: string; suffix: string } {
		const lineNumber = position.lineNumber;
		const column = position.column;
		const lineCount = model.getLineCount();

		// Prefix: up to CONTEXT_LINES_BEFORE lines before, including current line up to cursor
		const prefixStartLine = Math.max(1, lineNumber - ConstructInlineCompletionProvider.CONTEXT_LINES_BEFORE);
		const prefixRange = new Range(prefixStartLine, 1, lineNumber, column);
		const prefix = model.getValueInRange(prefixRange);

		// Suffix: up to CONTEXT_LINES_AFTER lines after cursor
		const suffixEndLine = Math.min(lineCount, lineNumber + ConstructInlineCompletionProvider.CONTEXT_LINES_AFTER);
		const suffixRange = new Range(lineNumber, column, suffixEndLine, model.getLineMaxColumn(suffixEndLine));
		const suffix = model.getValueInRange(suffixRange);

		return { prefix, suffix };
	}

	override dispose(): void {
		if (this._pendingTimer) {
			clearTimeout(this._pendingTimer);
			this._pendingTimer = undefined;
		}
		super.dispose();
	}
}
