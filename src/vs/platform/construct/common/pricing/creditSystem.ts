/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Credit System Service Interface
 *  Phase 27: Transparent credit-based pricing
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import {
        SubscriptionTier,
        CreditActionType,
        ICreditUsage,
        ICreditBudget,
        ISubscription,
        IPriceEstimate,
        IPricingAlert,
        ICreditRule,
} from './pricingTypes.js';

export const ICreditSystem = createDecorator<ICreditSystem>('creditSystemService');

/**
 * ICreditSystem — Transparent credit-based pricing system.
 *
 * One credit = one action. Premium models consume more credits via multiplier.
 * Users see exact cost before execution. No overage charges — actions are blocked
 * when credits are exhausted, never charged beyond allocation.
 */
export interface ICreditSystem {
        readonly _serviceBrand: undefined;

        // ── Subscription & Tier ──────────────────────────────────

        /** Get the current subscription tier. */
        getCurrentTier(): SubscriptionTier;

        /** Get full subscription details. */
        getSubscription(): ISubscription;

        /** Get remaining credits for the current billing period. */
        getCreditsRemaining(): number;

        /** Get total credits for the current billing period (subscription + purchased). */
        getCreditsTotal(): number;

        /** Get credits used in the current billing period. */
        getCreditsUsed(): number;

        // ── Usage Tracking ──────────────────────────────────────

        /** Get usage history, optionally filtered by date range and limited to N entries. */
        getUsageHistory(limit?: number, startDate?: number, endDate?: number): ICreditUsage[];

        /** Get total credits consumed this month. */
        getUsageThisMonth(): number;

        /** Get total credits consumed today. */
        getUsageToday(): number;

        /** Get breakdown of usage by action type. */
        getUsageByActionType(): Map<CreditActionType, number>;

        // ── Credit Consumption ──────────────────────────────────

        /**
         * Consume credits for an action.
         * Returns false if insufficient credits (action should be blocked).
         * Records the usage event for history and budget enforcement.
         */
        consumeCredits(amount: number, actionType: CreditActionType, metadata?: {
                model?: string;
                sessionId?: string;
                agentType?: string;
                description?: string;
        }): boolean;

        // ── Cost Estimation ─────────────────────────────────────

        /**
         * Estimate the cost of a prompt before execution.
         * Returns breakdown with confidence score.
         */
        estimateCost(prompt: string, model: string): IPriceEstimate;

        /**
         * Estimate total credits for an agent execution plan.
         * Integrates with Phase 20 Multi-Agent system.
         */
        estimatePlanCost(plan: { agentCount: number; estimatedSteps: number; model: string }): number;

        /** Check if the user can afford a given number of credits. */
        canAfford(amount: number): boolean;

        // ── Rules & Budget ──────────────────────────────────────

        /** Get all active credit rules. */
        getCreditRules(): ICreditRule[];

        /** Set budget caps and warning thresholds. */
        setBudget(budget: ICreditBudget): void;

        /** Get current budget configuration. */
        getBudget(): ICreditBudget;

        /** Get active pricing alerts. */
        getAlerts(): IPricingAlert[];

        // ── Upgrade & Purchase ──────────────────────────────────

        /** Open the upgrade/payment flow (external URL). */
        upgradeFlow(): void;

        /** Purchase one-time top-up credits. Never expires. */
        purchaseCredits(amount: number): Promise<boolean>;

        /** Get the pricing table for all tiers. */
        getPricingTable(): Array<{ tier: SubscriptionTier; price: number; credits: number; features: string[] }>;

        // ── Export ──────────────────────────────────────────────

        /** Export usage history as CSV string. */
        exportUsageCSV(): string;

        // ── Dev Mode ────────────────────────────────────────────

        /** Simulate a tier change (dev mode only). */
        simulateTier(tier: SubscriptionTier): void;

        // ── Events ──────────────────────────────────────────────

        /** Fired when credits are consumed or replenished. */
        readonly onCreditsChanged: Event<{ remaining: number; total: number; consumed: number }>;

        /** Fired when a budget warning threshold is crossed. */
        readonly onBudgetWarning: Event<IPricingAlert>;

        /** Fired when emergency stop is triggered (< 10 credits). */
        readonly onEmergencyStop: Event<{ creditsRemaining: number }>;

        /** Fired when subscription tier changes. */
        readonly onTierChanged: Event<{ from: SubscriptionTier; to: SubscriptionTier }>;

        /** Fired when a usage record is created. */
        readonly onUsageRecorded: Event<ICreditUsage>;
}

export const ICostGovernor = createDecorator<ICostGovernor>('costGovernorEnhancedService');

/**
 * ICostGovernor — Enhanced cost governor extending Phase 7's ICostGovernorService.
 *
 * Integrates with ICreditSystem for credit-aware cost management.
 * Provides auto-switch to cheaper models, budget recommendations,
 * and emergency mode blocking.
 */
export interface ICostGovernor {
        readonly _serviceBrand: undefined;

        /**
         * Check if an action is allowed based on credit balance and emergency state.
         * Returns true if the action can proceed, false if it should be blocked.
         * Essential actions (file save, git commit, settings) are always allowed.
         */
        isActionAllowed(actionType: CreditActionType): boolean;

        /**
         * Check if we should auto-switch to a cheaper model.
         * Returns true when credits < 20% of monthly allocation.
         */
        shouldAutoSwitchModel(): boolean;

        /**
         * Get the recommended cheaper model for a given current model.
         * Returns the model string to switch to, or undefined if no switch needed.
         */
        getCheaperModel(currentModel: string): string | undefined;

        /**
         * Check if emergency mode is active (< 10 credits).
         */
        isEmergencyMode(): boolean;

        /**
         * Analyze usage patterns and return recommendations.
         */
        getBudgetRecommendation(): {
                usageBreakdown: Map<CreditActionType, number>;
                recommendedTier: SubscriptionTier;
                projectedMonthlyCost: number;
                savingsVsPayAsYouGo: number;
        };

        /**
         * Record that an auto-switch occurred (for notification purposes).
         */
        recordAutoSwitch(fromModel: string, toModel: string): void;

        /**
         * Get the list of recent auto-switch events.
         */
        getAutoSwitchHistory(): Array<{ from: string; to: string; timestamp: number }>;
}
