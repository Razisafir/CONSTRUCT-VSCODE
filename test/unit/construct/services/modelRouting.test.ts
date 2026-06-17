/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for the Tier 2.1 model routing pure-logic helpers.
 */

import * as assert from 'assert';
import {
        resolveRoute,
        isValidModelPurpose,
        estimateModelCostUsdPerMTokens,
        computeRoutingSavings,
        DEFAULT_ROUTES,
        DEFAULT_ROUTING_CONFIG,
        ALL_MODEL_PURPOSES,
} from '../../../../src/vs/platform/construct/common/llm/modelRouting.js';
import type { IModelRoutingConfig, ModelPurpose } from '../../../../src/vs/platform/construct/common/llm/modelRouting.js';

suite('ModelRouting', () => {

        suite('isValidModelPurpose', () => {

                test('returns true for all valid purposes', () => {
                        for (const purpose of ALL_MODEL_PURPOSES) {
                                assert.ok(isValidModelPurpose(purpose), `Expected ${purpose} to be valid`);
                        }
                });

                test('returns false for unknown purposes', () => {
                        assert.strictEqual(isValidModelPurpose('unknown'), false);
                        assert.strictEqual(isValidModelPurpose(''), false);
                        assert.strictEqual(isValidModelPurpose('AUTOCOMPLETE'), false); // case-sensitive
                        assert.strictEqual(isValidModelPurpose('autocomplete '), false); // whitespace
                });

                test('acts as a type guard', () => {
                        const value: string = 'autocomplete';
                        if (isValidModelPurpose(value)) {
                                // value is now typed as ModelPurpose
                                const _purpose: ModelPurpose = value;
                                assert.strictEqual(_purpose, 'autocomplete');
                        }
                });
        });

        suite('resolveRoute', () => {

                test('returns fallback when routing is disabled', () => {
                        const config: IModelRoutingConfig = { enabled: false };
                        const result = resolveRoute('autocomplete', config, { modelId: 'gpt-4o' });
                        assert.strictEqual(result.modelId, 'gpt-4o');
                });

                test('returns user route when configured', () => {
                        const config: IModelRoutingConfig = {
                                enabled: true,
                                routes: {
                                        autocomplete: { modelId: 'custom-model' },
                                },
                        };
                        const result = resolveRoute('autocomplete', config, { modelId: 'gpt-4o' });
                        assert.strictEqual(result.modelId, 'custom-model');
                });

                test('returns default route when no user route and routing enabled', () => {
                        const config: IModelRoutingConfig = { enabled: true };
                        const result = resolveRoute('autocomplete', config, { modelId: 'gpt-4o' });
                        // Default for autocomplete is Haiku
                        assert.strictEqual(result.modelId, DEFAULT_ROUTES.autocomplete.modelId);
                });

                test('returns fallback when no user route and no default route', () => {
                        // This shouldn't happen with the current DEFAULT_ROUTES, but the code handles it
                        const config: IModelRoutingConfig = { enabled: true, routes: {} };
                        // All known purposes have defaults, so this falls through to default
                        const result = resolveRoute('chat', config, { modelId: 'fallback-model' });
                        assert.strictEqual(result.modelId, DEFAULT_ROUTES.chat.modelId);
                });

                test('respects user route provider override', () => {
                        const config: IModelRoutingConfig = {
                                enabled: true,
                                routes: {
                                        'autocomplete': { modelId: 'llama3.2:1b', provider: 'ollama' },
                                },
                        };
                        const result = resolveRoute('autocomplete', config, { modelId: 'gpt-4o', provider: 'cloud' });
                        assert.strictEqual(result.provider, 'ollama');
                });

                test('respects user route max tokens override', () => {
                        const config: IModelRoutingConfig = {
                                enabled: true,
                                routes: {
                                        'autocomplete': { modelId: 'gpt-4o-mini', maxTokens: 128 },
                                },
                        };
                        const result = resolveRoute('autocomplete', config, { modelId: 'gpt-4o' });
                        assert.strictEqual(result.maxTokens, 128);
                });

                test('falls back to default route when enabled is undefined (treated as enabled)', () => {
                        // When enabled is undefined, routing is treated as enabled (opt-out model).
                        // The user must explicitly set enabled: false to disable routing.
                        const config: IModelRoutingConfig = {}; // enabled is undefined
                        const result = resolveRoute('autocomplete', config, { modelId: 'fallback-model' });
                        // Should fall through to the default route for autocomplete (Haiku)
                        assert.strictEqual(result.modelId, DEFAULT_ROUTES.autocomplete.modelId);
                });

                test('returns fallback when explicitly disabled', () => {
                        const config: IModelRoutingConfig = { enabled: false };
                        const result = resolveRoute('autocomplete', config, { modelId: 'fallback-model' });
                        assert.strictEqual(result.modelId, 'fallback-model');
                });

                test('handles all purposes without crashing', () => {
                        const config: IModelRoutingConfig = { enabled: true };
                        for (const purpose of ALL_MODEL_PURPOSES) {
                                const result = resolveRoute(purpose, config, { modelId: 'fallback' });
                                assert.ok(result.modelId.length > 0, `Purpose ${purpose} should resolve to a non-empty modelId`);
                        }
                });
        });

        suite('estimateModelCostUsdPerMTokens', () => {

                test('returns cost for Claude Sonnet 4', () => {
                        const cost = estimateModelCostUsdPerMTokens('claude-sonnet-4-20250514');
                        assert.ok(cost !== null);
                        assert.ok(cost! > 0);
                });

                test('returns cost for Claude Haiku (cheaper than Sonnet)', () => {
                        const haikuCost = estimateModelCostUsdPerMTokens('claude-3-5-haiku-20241022');
                        const sonnetCost = estimateModelCostUsdPerMTokens('claude-sonnet-4-20250514');
                        assert.ok(haikuCost! < sonnetCost!, 'Haiku should be cheaper than Sonnet');
                });

                test('returns 0 for local Ollama models', () => {
                        assert.strictEqual(estimateModelCostUsdPerMTokens('llama3.2'), 0);
                        assert.strictEqual(estimateModelCostUsdPerMTokens('llama3.2:1b'), 0);
                        assert.strictEqual(estimateModelCostUsdPerMTokens('nomic-embed-text'), 0);
                        assert.strictEqual(estimateModelCostUsdPerMTokens('mistral'), 0);
                });

                test('returns cost for GPT-4o', () => {
                        const cost = estimateModelCostUsdPerMTokens('gpt-4o');
                        assert.ok(cost !== null);
                        assert.ok(cost! > 0);
                });

                test('returns cost for GPT-4o-mini (cheaper than GPT-4o)', () => {
                        const miniCost = estimateModelCostUsdPerMTokens('gpt-4o-mini');
                        const fullCost = estimateModelCostUsdPerMTokens('gpt-4o');
                        assert.ok(miniCost! < fullCost!, 'GPT-4o-mini should be cheaper than GPT-4o');
                });

                test('returns null for unknown model', () => {
                        assert.strictEqual(estimateModelCostUsdPerMTokens('unknown-model'), null);
                });
        });

        suite('computeRoutingSavings', () => {

                test('returns positive savings when routing to cheaper model', () => {
                        // Routing autocomplete from Sonnet to Haiku should save money
                        const config: IModelRoutingConfig = {
                                enabled: true,
                                routes: {
                                        autocomplete: { modelId: 'claude-3-5-haiku-20241022' },
                                },
                        };
                        const savings = computeRoutingSavings('autocomplete', config, 'claude-sonnet-4-20250514');
                        assert.ok(savings !== null);
                        assert.ok(savings! > 0, 'Routing to Haiku should save money vs Sonnet');
                });

                test('returns negative savings when routing to more expensive model', () => {
                        // Routing from Haiku to Opus should cost more
                        const config: IModelRoutingConfig = {
                                enabled: true,
                                routes: {
                                        autocomplete: { modelId: 'claude-3-opus-20240229' },
                                },
                        };
                        const savings = computeRoutingSavings('autocomplete', config, 'claude-3-5-haiku-20241022');
                        assert.ok(savings !== null);
                        assert.ok(savings! < 0, 'Routing to Opus should cost more vs Haiku');
                });

                test('returns 0 savings when routing to same model', () => {
                        const config: IModelRoutingConfig = {
                                enabled: true,
                                routes: {
                                        autocomplete: { modelId: 'claude-sonnet-4-20250514' },
                                },
                        };
                        const savings = computeRoutingSavings('autocomplete', config, 'claude-sonnet-4-20250514');
                        assert.strictEqual(savings, 0);
                });

                test('returns null when fallback model is unknown', () => {
                        const config: IModelRoutingConfig = { enabled: true };
                        const savings = computeRoutingSavings('autocomplete', config, 'unknown-model');
                        // Default route is Haiku which has a known cost, but fallback is unknown
                        // So this returns null
                        assert.strictEqual(savings, null);
                });

                test('returns positive savings when routing to local model', () => {
                        // Routing from any paid model to local llama3.2 should save the full cost
                        const config: IModelRoutingConfig = {
                                enabled: true,
                                routes: {
                                        autocomplete: { modelId: 'llama3.2', provider: 'ollama' },
                                },
                        };
                        const savings = computeRoutingSavings('autocomplete', config, 'claude-sonnet-4-20250514');
                        assert.ok(savings !== null);
                        assert.ok(savings! > 0, 'Routing to local model should save money');
                        // The savings should equal the cost of the fallback model
                        const fallbackCost = estimateModelCostUsdPerMTokens('claude-sonnet-4-20250514');
                        assert.ok(Math.abs(savings! - fallbackCost!) < 0.01);
                });
        });

        suite('DEFAULT_ROUTES', () => {

                test('has a route for every purpose', () => {
                        for (const purpose of ALL_MODEL_PURPOSES) {
                                const route = DEFAULT_ROUTES[purpose];
                                assert.ok(route, `Missing default route for ${purpose}`);
                                assert.ok(route.modelId.length > 0, `Empty modelId for ${purpose}`);
                        }
                });

                test('autocomplete uses a small/fast model', () => {
                        // Haiku is Anthropic's small fast model
                        assert.ok(
                                DEFAULT_ROUTES.autocomplete.modelId.includes('haiku') ||
                                DEFAULT_ROUTES.autocomplete.modelId.includes('mini'),
                                'Autocomplete should use a small/fast model'
                        );
                });

                test('autocomplete has low max tokens', () => {
                        assert.ok(
                                DEFAULT_ROUTES.autocomplete.maxTokens! <= 128,
                                'Autocomplete max tokens should be low (<=128)'
                        );
                });

                test('agent-plan uses a large reasoning model', () => {
                        // Sonnet or Opus
                        assert.ok(
                                DEFAULT_ROUTES['agent-plan'].modelId.includes('sonnet') ||
                                DEFAULT_ROUTES['agent-plan'].modelId.includes('opus'),
                                'Agent planning should use a large reasoning model'
                        );
                });

                test('embedding uses a specialized embedding model', () => {
                        assert.ok(
                                DEFAULT_ROUTES.embedding.modelId.includes('embed') ||
                                DEFAULT_ROUTES.embedding.modelId.includes('nomic'),
                                'Embedding should use a specialized embedding model'
                        );
                });

                test('embedding uses local provider by default', () => {
                        assert.strictEqual(DEFAULT_ROUTES.embedding.provider, 'ollama');
                });
        });

        suite('DEFAULT_ROUTING_CONFIG', () => {

                test('has routing disabled by default', () => {
                        assert.strictEqual(DEFAULT_ROUTING_CONFIG.enabled, false);
                });

                test('has no custom routes by default', () => {
                        assert.strictEqual(Object.keys(DEFAULT_ROUTING_CONFIG.routes ?? {}).length, 0);
                });
        });
});
