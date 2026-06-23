/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Credit-Based Pricing Type Definitions
 *  Phase 27: Transparent credit system replacing opaque usage tracking
 *
 *  One credit = one agent message/action. Premium models consume 2-3 credits.
 *  No surprises, no overage charges, no hidden fees.
 *--------------------------------------------------------------------------------------------*/

/**
 * Subscription tiers with credit allocations.
 * Each tier provides a fixed number of credits per billing period.
 */
export enum SubscriptionTier {
	Free = 'free',
	Pro = 'pro',
	Team = 'team',
	Enterprise = 'enterprise',
	GodMode = 'godmode',
}

/**
 * Tier credit allocations and pricing.
 */
export const TIER_CONFIG: Record<SubscriptionTier, { credits: number; price: number; priceLabel: string; features: string[] }> = {
	[SubscriptionTier.Free]: {
		credits: 50,
		price: 0,
		priceLabel: 'Free',
		features: [
			'50 credits/month',
			'Standard models only',
			'Community support',
			'Anonymized data contribution',
		],
	},
	[SubscriptionTier.Pro]: {
		credits: 500,
		price: 25,
		priceLabel: '$25/month',
		features: [
			'500 credits/month',
			'All models including premium',
			'Priority support',
			'No data collection',
			'Custom budget caps',
		],
	},
	[SubscriptionTier.Team]: {
		credits: 1000,
		price: 40,
		priceLabel: '$40/user/month',
		features: [
			'1000 credits/user/month',
			'All models including premium',
			'Team collaboration',
			'Admin dashboard',
			'SSO integration',
			'Priority support',
		],
	},
	[SubscriptionTier.Enterprise]: {
		credits: Infinity,
		price: 75,
		priceLabel: '$75/user/month',
		features: [
			'Unlimited credits',
			'All models including premium',
			'Dedicated support',
			'SLA guarantees',
			'Custom integrations',
			'On-premise deployment',
			'Advanced analytics',
		],
	},
	[SubscriptionTier.GodMode]: {
		credits: Infinity,
		price: 200,
		priceLabel: '$200/month',
		features: [
			'Unlimited credits',
			'Priority infrastructure',
			'Dedicated GPU resources',
			'Custom model fine-tuning',
			'Direct engineering access',
			'Beta feature access',
		],
	},
};

/**
 * Types of actions that consume credits.
 * Each action type has a base credit cost.
 */
export type CreditActionType =
	| 'message_standard'
	| 'message_premium'
	| 'tool_call'
	| 'file_edit'
	| 'terminal_command'
	| 'browser_action'
	| 'render_3d'
	| 'god_mode_session'
	| 'skill_execution';

/**
 * Rule defining credit cost for an action type.
 */
export interface ICreditRule {
	readonly actionType: CreditActionType;
	readonly baseCredits: number;
	readonly modelMultiplier: number;
	readonly description: string;
}

/**
 * Default credit rules — configurable via IConfigurationService.
 */
export const DEFAULT_CREDIT_RULES: ICreditRule[] = [
	{ actionType: 'message_standard', baseCredits: 1, modelMultiplier: 1, description: 'Standard model message (gpt-4o, claude-sonnet, etc.)' },
	{ actionType: 'message_premium', baseCredits: 1, modelMultiplier: 3, description: 'Premium model message (gpt-4o-opus, claude-opus, o1, etc.)' },
	{ actionType: 'tool_call', baseCredits: 1, modelMultiplier: 1, description: 'MCP tool execution' },
	{ actionType: 'file_edit', baseCredits: 1, modelMultiplier: 1, description: 'Per file modified' },
	{ actionType: 'terminal_command', baseCredits: 1, modelMultiplier: 1, description: 'Per terminal command executed' },
	{ actionType: 'browser_action', baseCredits: 2, modelMultiplier: 1, description: 'Browser screenshot, navigate, click' },
	{ actionType: 'render_3d', baseCredits: 5, modelMultiplier: 1, description: 'Three.js scene render' },
	{ actionType: 'god_mode_session', baseCredits: 10, modelMultiplier: 1, description: 'GOD mode activation fee + per-action' },
	{ actionType: 'skill_execution', baseCredits: 1, modelMultiplier: 1, description: 'Per skill workflow step' },
];

/**
 * Record of a single credit consumption event.
 */
export interface ICreditUsage {
	readonly id: string;
	readonly actionType: CreditActionType;
	readonly model: string;
	readonly creditsConsumed: number;
	readonly timestamp: number;
	readonly sessionId: string;
	readonly agentType?: string;
	readonly description: string;
}

/**
 * User-configurable budget caps and warning thresholds.
 */
export interface ICreditBudget {
	dailyCap?: number;
	weeklyCap?: number;
	monthlyCap?: number;
	emergencyStopThreshold: number;
	warningThresholds: number[];
}

/**
 * Default budget configuration.
 */
export const DEFAULT_BUDGET: ICreditBudget = {
	emergencyStopThreshold: 10,
	warningThresholds: [0.5, 0.8],
};

/**
 * Subscription state for the current user.
 */
export interface ISubscription {
	tier: SubscriptionTier;
	creditsTotal: number;
	creditsRemaining: number;
	creditsUsed: number;
	periodStart: number;
	periodEnd: number;
	autoRenew: boolean;
	paymentStatus: 'active' | 'past_due' | 'canceled' | 'trialing';
	features: string[];
}

/**
 * Cost estimate returned before an action is executed.
 */
export interface IPriceEstimate {
	readonly prompt: string;
	readonly estimatedCredits: number;
	readonly estimatedCost: number;
	readonly breakdown: ReadonlyArray<{
		readonly actionType: CreditActionType;
		readonly credits: number;
		readonly model: string;
		readonly multiplier: number;
	}>;
	readonly confidence: number;
}

/**
 * Pricing alert triggered when usage crosses thresholds.
 */
export interface IPricingAlert {
	readonly type: 'warning' | 'emergency' | 'upgrade' | 'info';
	readonly message: string;
	readonly currentUsage: number;
	readonly threshold: number;
	readonly suggestedAction: string;
	readonly timestamp: number;
}

/**
 * Top-up credit package definition.
 */
export interface ICreditPackage {
	readonly price: number;
	readonly credits: number;
	readonly label: string;
	readonly neverExpires: true;
}

/**
 * Available top-up packages.
 */
export const CREDIT_PACKAGES: ICreditPackage[] = [
	{ price: 5, credits: 100, label: '$5 = 100 credits', neverExpires: true },
	{ price: 10, credits: 250, label: '$10 = 250 credits', neverExpires: true },
	{ price: 25, credits: 600, label: '$25 = 600 credits', neverExpires: true },
];

/**
 * Standard model identifiers — 1x multiplier.
 */
export const STANDARD_MODELS = [
	'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo',
	'claude-sonnet-3-5', 'claude-3-5-sonnet', 'claude-3-haiku',
	'gemini-pro', 'gemini-1.5-pro', 'gemini-2.0-flash',
	'llama3', 'mistral', 'codestral',
];

/**
 * Premium model identifiers — 3x multiplier.
 */
export const PREMIUM_MODELS = [
	'gpt-4o-opus', 'opus', 'claude-opus', 'claude-3-opus',
	'o1', 'o1-preview', 'o1-mini', 'o3',
	'gemini-ultra',
];

/**
 * Helper: determine if a model string is premium.
 */
export function isPremiumModel(model: string): boolean {
	const lower = model.toLowerCase();
	for (const premium of PREMIUM_MODELS) {
		if (lower.includes(premium.toLowerCase())) {
			return true;
		}
	}
	return false;
}

/**
 * Helper: get the action type for a message based on the model.
 */
export function getMessageActionType(model: string): CreditActionType {
	return isPremiumModel(model) ? 'message_premium' : 'message_standard';
}

/**
 * Helper: get the model multiplier for a given model string.
 */
export function getModelMultiplier(model: string): number {
	return isPremiumModel(model) ? 3 : 1;
}
