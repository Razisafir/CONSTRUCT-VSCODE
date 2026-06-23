/*---------------------------------------------------------------------------------------------
 *  Kovix - Tab Autocomplete Provider (Patch A)
 *  Provides ghost-text inline completions using the active IConstructAIService provider.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IRange } from '../../../common/core/range.js';
import { Position } from '../../../common/core/position.js';
import { ITextModel } from '../../../common/model.js';
import { InlineCompletion, InlineCompletionContext, InlineCompletions, InlineCompletionsProvider } from '../../../common/languages.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * KovixInlineCompletionProvider — Patch A
 *
 * Registers an InlineCompletionsProvider with the editor that calls the active
 * AI provider's complete() method (Ollama / Xenova / Cloud) and returns a single
 * suggestion rendered as ghost text. The user accepts with Tab.
 *
 * Behavior:
 * - Disabled unless kovix.autocomplete.enabled is true (default: true)
 * - Debounced by kovix.autocomplete.debounceMs (default: 200)
 * - Bounded by kovix.autocomplete.maxTokens (default: 32)
 * - Tunable via kovix.autocomplete.temperature (default: 0.2)
 * - Skipped for: empty lines, very short prefixes (< 3 chars), plaintext files
 *   (markdown, txt, plain) unless the user explicitly enables them
 * - Aborts the previous in-flight request when a new one starts
 */
export class KovixInlineCompletionProvider extends Disposable implements InlineCompletionsProvider<InlineCompletions> {

        static readonly ID = 'kovix.inlineCompletionProvider';

        private _lastRequestTime = 0;
        private _lastRequestAborter: AbortController | undefined;

        constructor(
                @IConstructAIService private readonly _aiService: IConstructAIService,
                @IConfigurationService private readonly _configService: IConfigurationService,
                @ILogService private readonly _logService: ILogService,
        ) {
                super();
        }

        /**
         * Whether autocomplete is enabled and a provider is available.
         */
        private isEnabled(): boolean {
                const enabled = this._configService.getValue<boolean>('kovix.autocomplete.enabled');
                if (!enabled) { return false; }
                // Need an active model to make suggestions
                if (!this._aiService.getActiveModel()) { return false; }
                return true;
        }

        /**
         * Returns true for languages we should NOT autocomplete (pure prose).
         */
        private isPlaintextLanguage(model: ITextModel): boolean {
                const langId = model.getLanguageId();
                const plaintext = ['plaintext', 'markdown', 'git-commit', 'git-rebase', 'log'];
                return plaintext.includes(langId);
        }

        /**
         * Build the prefix/suffix the AI provider expects.
         * We send a small window (last 800 / next 400 chars) for context.
         */
        private buildPrefixSuffix(model: ITextModel, position: Position): { prefix: string; suffix: string } {
                const lineCount = model.getLineCount();
                // Use 5 lines before + current line up to cursor as prefix
                const startLine = Math.max(1, position.lineNumber - 8);
                const prefix = model.getValueInRange({
                        startLineNumber: startLine,
                        startColumn: 1,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                });

                // Use rest of current line + next 4 lines as suffix
                const endLine = Math.min(lineCount, position.lineNumber + 4);
                const suffix = model.getValueInRange({
                        startLineNumber: position.lineNumber,
                        startColumn: position.column,
                        endLineNumber: endLine,
                        endColumn: model.getLineMaxColumn(endLine),
                });

                // Keep window bounded
                const trimmedPrefix = prefix.length > 1500 ? prefix.slice(-1500) : prefix;
                const trimmedSuffix = suffix.length > 800 ? suffix.slice(0, 800) : suffix;

                return { prefix: trimmedPrefix, suffix: trimmedSuffix };
        }

        async provideInlineCompletions(
                model: ITextModel,
                position: Position,
                context: InlineCompletionContext,
                token: CancellationToken,
        ): Promise<InlineCompletions | undefined> {

                // 1. Hard gates
                if (!this.isEnabled()) { return undefined; }
                if (token.isCancellationRequested) { return undefined; }
                if (this.isPlaintextLanguage(model)) { return undefined; }

                // 2. Don't fire on brand-new lines with no preceding context
                const lineContent = model.getLineContent(position.lineNumber);
                const textBeforeCursor = lineContent.substring(0, position.column - 1);
                if (textBeforeCursor.trim().length < 3) { return undefined; }
                // Skip if cursor is at the start of an empty line
                if (textBeforeCursor.length === 0 && lineContent.trim().length === 0) { return undefined; }

                // 3. Debounce: skip if fired too soon after the last request
                const debounceMs = this._configService.getValue<number>('kovix.autocomplete.debounceMs') ?? 200;
                const now = Date.now();
                if (now - this._lastRequestTime < debounceMs) {
                        return undefined;
                }
                this._lastRequestTime = now;

                // 4. Abort any previous in-flight request
                if (this._lastRequestAborter) {
                        this._lastRequestAborter.abort();
                }
                const aborter = new AbortController();
                this._lastRequestAborter = aborter;
                
                // Wire token cancellation to the aborter
                token.onCancellationRequested(() => aborter.abort());

                // 5. Build prefix/suffix
                const { prefix, suffix } = this.buildPrefixSuffix(model, position);

                // 6. Read configuration
                const maxTokens = this._configService.getValue<number>('kovix.autocomplete.maxTokens') ?? 32;
                const temperature = this._configService.getValue<number>('kovix.autocomplete.temperature') ?? 0.2;

                // 7. Call the AI provider
                try {
                        const result = await this._aiService.complete(prefix, suffix, {
                                signal: aborter.signal,
                                maxTokens,
                                temperature,
                                stop: ['\n\n', '```'],
                        });

                        if (aborter.signal.aborted) { return undefined; }
                        if (!result || !result.text || !result.text.trim()) { return undefined; }

                        // 8. Normalize: strip trailing newlines, leading whitespace that duplicates cursor column
                        let suggestion = result.text.replace(/\s+$/, '');
                        // If the suggestion starts with the same text already on the line, skip
                        if (suggestion.startsWith(textBeforeCursor)) {
                                suggestion = suggestion.slice(textBeforeCursor.length);
                        }
                        if (!suggestion) { return undefined; }

                        // 9. Build the InlineCompletion
                        const completion: InlineCompletion = {
                                insertText: suggestion,
                                range: {
                                        startLineNumber: position.lineNumber,
                                        startColumn: position.column,
                                        endLineNumber: position.lineNumber,
                                        endColumn: position.column,
                                } as IRange,
                                completeBracketPairs: true,
                        };

                        this._logService.trace(`[Kovix.Autocomplete] suggestion: ${JSON.stringify(suggestion).slice(0, 80)}`);

                        return {
                                items: [completion],
                        } as InlineCompletions;
                } catch (err) {
                        if (aborter.signal.aborted) { return undefined; }
                        this._logService.trace('[Kovix.Autocomplete] error:', err instanceof Error ? err.message : String(err));
                        return undefined;
                } finally {
                        if (this._lastRequestAborter === aborter) {
                                this._lastRequestAborter = undefined;
                        }
                }
        }

        handleItemDidShow?(
                completions: InlineCompletions,
                item: InlineCompletion,
                updatedInsertText: string,
        ): void {
                // No-op; could be used for telemetry
        }

        handlePartialAccept?(
                completions: InlineCompletions,
                item: InlineCompletion,
                acceptedCharacters: number,
        ): void {
                // No-op
        }

        handleRejection?(
                completions: InlineCompletions,
                item: InlineCompletion,
        ): void {
                // No-op
        }

        freeInlineCompletions(completions: InlineCompletions): void {
                // No-op; our completions hold no external resources
        }

        override dispose(): void {
                if (this._lastRequestAborter) {
                        this._lastRequestAborter.abort();
                }
                super.dispose();
        }
}

/**
 * Register the autocomplete provider with the editor's language features service.
 * Called from construct.contribution.ts on the browser layer.
 */
export function registerKovixAutocomplete(
        languageFeaturesService: ILanguageFeaturesService,
        aiService: IConstructAIService,
        configService: IConfigurationService,
        logService: ILogService,
): KovixInlineCompletionProvider {
        const provider = new KovixInlineCompletionProvider(aiService, configService, logService);

        // Register for all languages; the provider itself filters by language
        const disposable = languageFeaturesService.inlineCompletionsProvider.register(
                [{ scheme: 'file' }, { scheme: 'untitled' }],
                provider,
        );
        // Attach disposable to provider; _register is protected so we cast to access.
        (provider as unknown as { _register<T extends { dispose(): void }>(o: T): T })._register(disposable);

        logService.info('[Kovix.Autocomplete] Provider registered.');
        return provider;
}
