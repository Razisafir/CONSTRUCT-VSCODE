// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 2, item 2.1 — Model routing by purpose.
 *
 *  Adds the concept of 'purpose' to AI service calls so that the service can
 *  route to different models based on what the call is for: autocomplete uses
 *  a small fast model (Haiku, gpt-4o-mini, llama3.2-1b), agent planning uses
 *  a large reasoning model (Sonnet, Opus, GPT-4o), etc.
 *
 *  Audit doc §4.5: 'When the user selects Claude Sonnet 4 as the active model,
 *  every operation uses that model: autocomplete, chat, agent planning, and
 *  agent execution. This is wasteful... Cursor does this routing automatically;
 *  KOVIX's single-active-model design means users either pay too much or get
 *  poor agent reasoning.'
 *
 *  This file defines the pure-logic types and the routing decision function.
 *  The actual integration with IConstructAIService is a separate concern that
 *  requires modifying the service interface — see the ModelRoutingConfig type
 *  below for the configuration shape.
 *
 *  Pure-logic helpers (no VS Code imports) so this file is unit-testable.
 *--------------------------------------------------------------------------------------------*/

/**
 * The purpose of an AI call. Used by the model routing system to select
 * the appropriate model for the task.
 *
 * - 'autocomplete': Tab-to-accept inline completions. Needs a small fast model.
 * - 'inline-edit': Cmd+K inline edits. Medium model with strong code understanding.
 * - 'agent-plan': Agent planning phase. Large reasoning model.
 * - 'agent-execute': Agent execution phase. Large model with tool use.
 * - 'chat': General chat. Default to user's preferred model.
 * - 'embedding': Vector embeddings for semantic search. Specialized embedding model.
 */
export type ModelPurpose =
	| 'autocomplete'
	| 'inline-edit'
	| 'agent-plan'
	| 'agent-execute'
	| 'chat'
	| 'embedding';

/**
 * All valid ModelPurpose values. Exported for validation.
 */
export const ALL_MODEL_PURPOSES: readonly ModelPurpose[] = [
	'autocomplete',
	'inline-edit',
	'agent-plan',
	'agent-execute',
	'chat',
	'embedding',
];

/**
 * User configuration for model routing.
 * Maps each purpose to a specific model ID + optional provider override.
 *
 * If a purpose is not in the map, the default active model is used.
 */
export interface IModelRoutingConfig {
	/** Per-purpose model overrides. Missing purposes fall back to activeModel. */
	routes?: Partial<Record<ModelPurpose, IModelRoute>>;
	/** Whether routing is enabled. If false, all calls use activeModel. */
	enabled?: boolean;
}

/**
 * A single route: which model (and optionally which provider) to use for a purpose.
 */
export interface IModelRoute {
	/** Model ID (e.g. 'claude-3-5-haiku-20241022', 'gpt-4o-mini', 'llama3.2:1b') */
	modelId: string;
	/** Optional provider override ('ollama' | 'xenova' | 'cloud'). If omitted, uses active provider. */
	provider?: 'ollama' | 'xenova' | 'cloud';
	/** Optional max tokens override for this purpose. */
	maxTokens?: number;
	/** Optional temperature override for this purpose. */
	temperature?: number;
}

/**
 * Sensible defaults for each purpose. Used when the user enables routing
 * but hasn't customized the routes.
 *
 * These defaults favor cost-efficiency: small models for high-frequency
 * low-stakes tasks (autocomplete), large models for low-frequency
 * high-stakes tasks (agent planning).
 */
export const DEFAULT_ROUTES: Readonly<Record<ModelPurpose, IModelRoute>> = {
	autocomplete: {
		// Small fast model — 200ms latency target, $0.25/M tokens
		modelId: 'claude-3-5-haiku-20241022',
		maxTokens: 64,
		temperature: 0.2,
	},
	'inline-edit': {
		// Medium model — strong code understanding, ~1s latency acceptable
		modelId: 'claude-sonnet-4-20250514',
		maxTokens: 1024,
		temperature: 0,
	},
	'agent-plan': {
		// Large reasoning model — quality over speed
		modelId: 'claude-sonnet-4-20250514',
		maxTokens: 4096,
		temperature: 0.2,
	},
	'agent-execute': {
		// Large model with strong tool use
		modelId: 'claude-sonnet-4-20250514',
		maxTokens: 8192,
		temperature: 0.3,
	},
	chat: {
		// User's preferred model — defaults to active model
		modelId: 'claude-sonnet-4-20250514',
		maxTokens: 4096,
		temperature: 0.7,
	},
	embedding: {
		// Specialized embedding model (local via Ollama)
		modelId: 'nomic-embed-text',
		provider: 'ollama',
	},
};

/**
 * Default configuration: routing disabled, no custom routes.
 * The user opts in via settings.
 */
export const DEFAULT_ROUTING_CONFIG: IModelRoutingConfig = {
	enabled: false,
	routes: {},
};

/**
 * Resolve which model + provider to use for a given purpose.
 *
 * Resolution order:
 * 1. If routing is disabled, return the fallback (active model).
 * 2. If the user has configured a route for this purpose, use it.
 * 3. Otherwise, fall back to the default route for this purpose.
 * 4. If no default route either, return the fallback.
 *
 * Exported for unit testing.
 */
export function resolveRoute(
	purpose: ModelPurpose,
	config: IModelRoutingConfig,
	fallback: { modelId: string; provider?: 'ollama' | 'xenova' | 'cloud' }
): IModelRoute {
	// If routing is disabled, always use the fallback
	if (config.enabled === false) {
		return {
			modelId: fallback.modelId,
			provider: fallback.provider,
		};
	}

	// User-configured route takes precedence
	const userRoute = config.routes?.[purpose];
	if (userRoute) {
		return userRoute;
	}

	// Default route for this purpose
	const defaultRoute = DEFAULT_ROUTES[purpose];
	if (defaultRoute) {
		return defaultRoute;
	}

	// Last resort: fallback
	return {
		modelId: fallback.modelId,
		provider: fallback.provider,
	};
}

/**
 * Validate that a ModelPurpose value is one of the known purposes.
 *
 * Exported for unit testing.
 */
export function isValidModelPurpose(value: string): value is ModelPurpose {
	return (ALL_MODEL_PURPOSES as readonly string[]).includes(value);
}

/**
 * Estimate the cost (in USD per million tokens) for a given model.
 * Used by the UI to show users the cost implications of their routing config.
 *
 * Returns null if the model is unknown (e.g. local Ollama models, which are free).
 *
 * Exported for unit testing.
 */
export function estimateModelCostUsdPerMTokens(modelId: string): number | null {
	// Anthropic pricing (as of 2026)
	const anthropicPricing: Record<string, { input: number; output: number }> = {
		'claude-sonnet-4-20250514': { input: 3, output: 15 },
		'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
		'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
		'claude-3-opus-20240229': { input: 15, output: 75 },
	};
	// OpenAI pricing
	const openaiPricing: Record<string, { input: number; output: number }> = {
		'gpt-4o': { input: 2.5, output: 10 },
		'gpt-4o-mini': { input: 0.15, output: 0.6 },
		'gpt-4-turbo': { input: 10, output: 30 },
	};
	// Return the average of input+output for a single "cost per M tokens" number
	const anthropic = anthropicPricing[modelId];
	if (anthropic) {
		return (anthropic.input + anthropic.output) / 2;
	}
	const openai = openaiPricing[modelId];
	if (openai) {
		return (openai.input + openai.output) / 2;
	}
	// Local models (llama3.2, nomic-embed-text, etc.) — free
	if (modelId.startsWith('llama') || modelId.startsWith('nomic') || modelId.startsWith('mistral')) {
		return 0;
	}
	return null;
}

/**
 * Compute the estimated cost savings of using routing vs. always using the
 * fallback model. Returns the difference in USD per million tokens.
 *
 * Positive = routing is cheaper. Negative = routing is more expensive.
 *
 * Exported for unit testing.
 */
export function computeRoutingSavings(
	purpose: ModelPurpose,
	config: IModelRoutingConfig,
	fallbackModelId: string
): number | null {
	const fallbackCost = estimateModelCostUsdPerMTokens(fallbackModelId);
	const route = resolveRoute(purpose, config, { modelId: fallbackModelId });
	const routeCost = estimateModelCostUsdPerMTokens(route.modelId);

	if (fallbackCost === null || routeCost === null) {
		return null;
	}

	return fallbackCost - routeCost;
}
