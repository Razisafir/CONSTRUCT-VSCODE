// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Patch A — Tab Autocomplete via InlineCompletionItemProvider
 *
 *  Wires KOVIX's existing IConstructAIService.complete() method to VS Code's
 *  InlineCompletionItemProvider API, enabling Tab-to-accept autocomplete
 *  suggestions in the editor.
 *
 *  Tier 1, item 1.1 of the KOVIX Technical Audit roadmap.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { Position } from '../../../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import {
        InlineCompletionItemProvider,
        InlineCompletionItem,
        InlineCompletionContext,
        InlineCompletionTriggerKind
} from '../../../../../../editor/common/languages.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { redactSecrets } from '../../../../../../platform/construct/common/security/secretRedactor.js';
// Pure-logic helpers (zero VS Code deps — unit tested in isolation)
import {
        buildCacheKey,
        boundContext,
        normalizeSuggestion,
        isSuggestionUseful,
        SuggestionCache,
        DEFAULT_DEBOUNCE_MS,
} from '../../../../../../platform/construct/common/editor/kovixInlineCompletionHelpers.js';

// Re-export the pure helpers for backward compatibility / external consumers
export {
        buildCacheKey,
        boundContext,
        normalizeSuggestion,
        isSuggestionUseful,
        SuggestionCache,
        extractAddedLinesFromDiff,
        detectErrorSentinel,
} from '../../../../../../platform/construct/common/editor/kovixInlineCompletionHelpers.js';

// Tunable defaults — also configurable via settings
const CACHE_SIZE_LOCAL = 16; // matches SuggestionCache.CACHE_SIZE
const CACHE_TTL_MS_LOCAL = 60_000; // matches SuggestionCache.CACHE_TTL_MS

interface ICompletionCacheEntry {
        suggestion: string;
        timestamp: number;
}

/**
 * KovixInlineCompletionProvider — Tab autocomplete provider backed by IConstructAIService.
 *
 * Design:
 * 1. Debounced: 200ms idle window must pass after the last keystroke.
 * 2. Cancellable: each request is tied to an AbortController.
 * 3. FIM-aware: prompt uses <PRE>/<SUF>/<MID> format.
 * 4. Cached: last 16 (prefix, suffix) → suggestion pairs cached for cursor jitter.
 * 5. Graceful degradation: if AI service unavailable, returns undefined (no suggestion).
 */
export class KovixInlineCompletionProvider extends Disposable implements InlineCompletionItemProvider {
        readonly _serviceBrand: undefined;

        private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
        private _activeRequest: AbortController | null = null;
        private readonly _cache = new SuggestionCache();

        constructor(
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IConfigurationService private readonly configService: IConfigurationService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[KovixInlineCompletionProvider] Registered');
        }

        async provideInlineCompletions(
                model: ITextModel,
                position: Position,
                context: InlineCompletionContext,
                token: CancellationToken
        ): Promise<InlineCompletionItem[] | undefined> {
                // Respect user's enable/disable setting
                if (!this.configService.getValue<boolean>('construct.autocomplete.enabled', true)) {
                        return undefined;
                }

                // Debounce automatic triggers only (explicit Ctrl+Space fires immediately)
                if (context.triggerKind === InlineCompletionTriggerKind.Automatic) {
                        const debounceMs = this.configService.getValue<number>(
                                'construct.autocomplete.debounceMs', DEFAULT_DEBOUNCE_MS
                        );
                        await this._debounce(debounceMs, token);
                        if (token.isCancellationRequested) {
                                return undefined;
                        }
                }

                // Build FIM context
                const offset = model.getOffsetAt(position);
                const fullText = model.getValue();
                const { prefixStart, suffixEnd } = boundContext(offset, fullText.length);
                const prefix = fullText.substring(prefixStart, offset);
                const suffix = fullText.substring(offset, suffixEnd);

                // Cache lookup — avoids re-requesting on cursor jitter
                const cacheKey = buildCacheKey(prefix, suffix);
                const cached = this._cache.get(cacheKey);
                if (cached) {
                        this.logService.trace('[KovixInlineCompletionProvider] Cache hit');
                        return this._toInlineCompletion(cached, position, model);
                }

                // Abort any in-flight request before starting a new one
                if (this._activeRequest) {
                        this._activeRequest.abort();
                        this._activeRequest = null;
                }

                const requestController = new AbortController();
                this._activeRequest = requestController;
                token.onCancellationRequested(() => requestController.abort());

                try {
                        const result = await this.aiService.complete(prefix, suffix, {
                                signal: requestController.signal,
                                maxTokens: 64,
                                temperature: 0.2,
                                stop: ['\n\n', '\nclass ', '\nfunction ', '\ndef ', '\nimport '],
                        });

                        if (!result?.text || result.text.length === 0) {
                                return undefined;
                        }

                        const suggestion = normalizeSuggestion(result.text);
                        if (suggestion.length === 0) {
                                return undefined;
                        }

                        // Don't suggest if it would be redundant with existing text
                        const currentLine = model.getLineContent(position.lineNumber);
                        const textAfterCursor = currentLine.substring(position.column - 1);
                        if (!isSuggestionUseful(suggestion, textAfterCursor)) {
                                return undefined;
                        }

                        this._cache.set(cacheKey, suggestion);
                        return this._toInlineCompletion(suggestion, position, model);
                } catch (err) {
                        if ((err as Error)?.name !== 'AbortError') {
                                this.logService.trace(redactSecrets(
                                        '[KovixInlineCompletionProvider] Error: ' + (err as Error)?.message
                                ));
                        }
                        return undefined;
                } finally {
                        if (this._activeRequest === requestController) {
                                this._activeRequest = null;
                        }
                }
        }

        private _toInlineCompletion(
                suggestion: string,
                position: Position,
                _model: ITextModel
        ): InlineCompletionItem[] {
                const range = new Range(
                        position.lineNumber, position.column,
                        position.lineNumber, position.column
                );
                return [{
                        insertText: suggestion,
                        range,
                } as InlineCompletionItem];
        }

        private _debounce(ms: number, token: CancellationToken): Promise<void> {
                if (this._debounceTimer) {
                        clearTimeout(this._debounceTimer);
                        this._debounceTimer = null;
                }
                return new Promise<void>((resolve) => {
                        this._debounceTimer = setTimeout(() => {
                                this._debounceTimer = null;
                                resolve();
                        }, ms);
                        token.onCancellationRequested(() => {
                                if (this._debounceTimer) {
                                        clearTimeout(this._debounceTimer);
                                        this._debounceTimer = null;
                                }
                                resolve();
                        });
                });
        }

        // Optional VS Code inline completion provider hooks
        handleItemDidShow?(
                _completions: readonly InlineCompletionItem[],
                _item: InlineCompletionItem,
                _updatedInsertText: string
        ): void {
                // Reserved for telemetry (Tier 1 item 1.7 — local usage log)
        }

        handlePartialAccept?(
                _completions: readonly InlineCompletionItem[],
                _item: InlineCompletionItem,
                _acceptedLength: number
        ): void {
                // Reserved for telemetry
        }

        override dispose(): void {
                if (this._debounceTimer) {
                        clearTimeout(this._debounceTimer);
                }
                if (this._activeRequest) {
                        this._activeRequest.abort();
                }
                this._cache.clear();
                super.dispose();
        }
}
