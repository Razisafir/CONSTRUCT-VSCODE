/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Credit System Service Implementation
 *  Phase 27: Transparent credit-based pricing
 *
 *  Replaces opaque usage tracking with transparent credit system.
 *  One credit = one action. Premium models consume 2-3 credits.
 *  No overage charges — actions are blocked when credits are exhausted.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';

import {
        ICreditSystem,
        ICostGovernor,
} from '../../../../../../platform/construct/common/pricing/creditSystem.js';
import {
        SubscriptionTier,
        CreditActionType,
        ICreditUsage,
        ICreditBudget,
        ISubscription,
        IPriceEstimate,
        IPricingAlert,
        ICreditRule,
        TIER_CONFIG,
        DEFAULT_CREDIT_RULES,
        DEFAULT_BUDGET,
        isPremiumModel,
        getMessageActionType,
        getModelMultiplier,
        CREDIT_PACKAGES,
} from '../../../../../../platform/construct/common/pricing/pricingTypes.js';

// ── Storage Keys ──────────────────────────────────────────────

const STORAGE_KEY_SUBSCRIPTION = 'construct.credits.subscription';
const STORAGE_KEY_USAGE = 'construct.credits.usage';
const STORAGE_KEY_BUDGET = 'construct.credits.budget';
const STORAGE_KEY_PURCHASED = 'construct.credits.purchased';
const STORAGE_KEY_ALERTS = 'construct.credits.alerts';

// ── Configuration Keys ────────────────────────────────────────

// Reserved for future use: construct.pricing.tier, construct.pricing.autoSwitchModel, construct.pricing.emergencyBlock

// ── Grace Period ──────────────────────────────────────────────

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Essential Actions (allowed even in emergency mode) ────────

const ESSENTIAL_ACTION_TYPES: CreditActionType[] = ['file_edit'];

// ══════════════════════════════════════════════════════════════
// CreditSystemService — Main ICreditSystem implementation
// ══════════════════════════════════════════════════════════════

export class CreditSystemService extends Disposable implements ICreditSystem {
        declare readonly _serviceBrand: undefined;

        // ── Internal State ──────────────────────────────────────

        private _subscription: ISubscription;
        private _usage: ICreditUsage[] = [];
        private _budget: ICreditBudget;
        private _purchasedCredits: number = 0;
        private _alerts: IPricingAlert[] = [];
        private _creditRules: ICreditRule[];
        private _gracePeriodStart: number | undefined;

        // ── Events ──────────────────────────────────────────────

        private readonly _onCreditsChanged = this._register(new Emitter<{ remaining: number; total: number; consumed: number }>());
        readonly onCreditsChanged = this._onCreditsChanged.event;

        private readonly _onBudgetWarning = this._register(new Emitter<IPricingAlert>());
        readonly onBudgetWarning = this._onBudgetWarning.event;

        private readonly _onEmergencyStop = this._register(new Emitter<{ creditsRemaining: number }>());
        readonly onEmergencyStop = this._onEmergencyStop.event;

        private readonly _onTierChanged = this._register(new Emitter<{ from: SubscriptionTier; to: SubscriptionTier }>());
        readonly onTierChanged = this._onTierChanged.event;

        private readonly _onUsageRecorded = this._register(new Emitter<ICreditUsage>());
        readonly onUsageRecorded = this._onUsageRecorded.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
                @IOpenerService private readonly openerService: IOpenerService,
                @ITelemetryService private readonly telemetryService: ITelemetryService,
        ) {
                super();

                // Load persisted state
                this._subscription = this._loadSubscription();
                this._usage = this._loadUsage();
                this._budget = this._loadBudget();
                this._purchasedCredits = this._loadPurchasedCredits();
                this._alerts = this._loadAlerts();
                this._creditRules = [...DEFAULT_CREDIT_RULES];

                // Check if billing period needs reset
                this._checkPeriodReset();

                // Phase 27: Telemetry tier sync — Free tier = telemetry active, paid = off
                this._syncTelemetryWithTier();

                // Register disposables
                this._register(this._onCreditsChanged);
                this._register(this._onBudgetWarning);
                this._register(this._onEmergencyStop);
                this._register(this._onTierChanged);
                this._register(this._onUsageRecorded);

                // Track telemetry service reference for tier-sync
                void this.telemetryService;

                this.logService.info(`[CreditSystem] Initialized: tier=${this._subscription.tier}, credits=${this._subscription.creditsRemaining}/${this._subscription.creditsTotal}`);
        }

        // ══════════════════════════════════════════════════════════
        // Subscription & Tier
        // ══════════════════════════════════════════════════════════

        getCurrentTier(): SubscriptionTier {
                return this._subscription.tier;
        }

        getSubscription(): ISubscription {
                return { ...this._subscription };
        }

        getCreditsRemaining(): number {
                return this._subscription.creditsRemaining + this._purchasedCredits;
        }

        getCreditsTotal(): number {
                const subTotal = this._subscription.creditsTotal;
                return (subTotal === Infinity ? Infinity : subTotal) + this._purchasedCredits;
        }

        getCreditsUsed(): number {
                return this._subscription.creditsUsed;
        }

        // ══════════════════════════════════════════════════════════
        // Usage Tracking
        // ══════════════════════════════════════════════════════════

        getUsageHistory(limit?: number, startDate?: number, endDate?: number): ICreditUsage[] {
                let results = [...this._usage];

                if (startDate) {
                        results = results.filter(u => u.timestamp >= startDate);
                }
                if (endDate) {
                        results = results.filter(u => u.timestamp <= endDate);
                }

                // Sort by timestamp descending (newest first)
                results.sort((a, b) => b.timestamp - a.timestamp);

                if (limit && limit > 0) {
                        results = results.slice(0, limit);
                }

                return results;
        }

        getUsageThisMonth(): number {
                const now = new Date();
                const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
                return this._usage
                        .filter(u => u.timestamp >= periodStart)
                        .reduce((sum, u) => sum + u.creditsConsumed, 0);
        }

        getUsageToday(): number {
                const now = new Date();
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                return this._usage
                        .filter(u => u.timestamp >= todayStart)
                        .reduce((sum, u) => sum + u.creditsConsumed, 0);
        }

        getUsageByActionType(): Map<CreditActionType, number> {
                const breakdown = new Map<CreditActionType, number>();
                for (const usage of this._usage) {
                        const current = breakdown.get(usage.actionType) ?? 0;
                        breakdown.set(usage.actionType, current + usage.creditsConsumed);
                }
                return breakdown;
        }

        // ══════════════════════════════════════════════════════════
        // Credit Consumption
        // ══════════════════════════════════════════════════════════

        consumeCredits(amount: number, actionType: CreditActionType, metadata?: {
                model?: string;
                sessionId?: string;
                agentType?: string;
                description?: string;
        }): boolean {
                const remaining = this.getCreditsRemaining();

                // Check if credits are sufficient
                if (remaining < amount) {
                        // Start grace period if not already active
                        if (!this._gracePeriodStart) {
                                this._gracePeriodStart = Date.now();
                        }

                        // Check if grace period has expired (24h)
                        if (Date.now() - this._gracePeriodStart > GRACE_PERIOD_MS) {
                                // Hard block after grace period
                                this.logService.warn(`[CreditSystem] Credit consumption blocked: insufficient credits (${remaining}/${amount}) and grace period expired`);
                                return false;
                        }

                        // During grace period, still allow but log warning
                        this.logService.warn(`[CreditSystem] Credit consumption during grace period: ${remaining}/${amount} credits remaining`);
                } else {
                        // Reset grace period when credits are sufficient
                        this._gracePeriodStart = undefined;
                }

                // Deduct from purchased credits first, then subscription credits
                let amountToDeduct = amount;
                if (this._purchasedCredits > 0) {
                        const fromPurchased = Math.min(this._purchasedCredits, amountToDeduct);
                        this._purchasedCredits -= fromPurchased;
                        amountToDeduct -= fromPurchased;
                }
                if (amountToDeduct > 0 && this._subscription.creditsRemaining !== Infinity) {
                        this._subscription.creditsRemaining = Math.max(0, this._subscription.creditsRemaining - amountToDeduct);
                }
                this._subscription.creditsUsed += amount;

                // Record usage
                const usageRecord: ICreditUsage = {
                        id: generateUuid(),
                        actionType,
                        model: metadata?.model ?? '',
                        creditsConsumed: amount,
                        timestamp: Date.now(),
                        sessionId: metadata?.sessionId ?? '',
                        agentType: metadata?.agentType,
                        description: metadata?.description ?? '',
                };
                this._usage.push(usageRecord);

                // Persist state
                this._persistState();

                // Fire events
                this._onCreditsChanged.fire({
                        remaining: this.getCreditsRemaining(),
                        total: this.getCreditsTotal(),
                        consumed: amount,
                });
                this._onUsageRecorded.fire(usageRecord);

                // Check budget thresholds
                this._checkBudgetThresholds();

                this.logService.trace(`[CreditSystem] Consumed ${amount} credits for ${actionType}. Remaining: ${this.getCreditsRemaining()}/${this.getCreditsTotal()}`);

                return true;
        }

        // ══════════════════════════════════════════════════════════
        // Cost Estimation
        // ══════════════════════════════════════════════════════════

        estimateCost(prompt: string, model: string): IPriceEstimate {
                const actionType = getMessageActionType(model);
                const multiplier = getModelMultiplier(model);
                const rule = this._creditRules.find(r => r.actionType === actionType);
                const baseCredits = rule?.baseCredits ?? 1;

                // Estimate number of messages based on prompt length and complexity
                const promptLength = prompt.length;
                let estimatedMessages = 1;
                if (promptLength > 500) { estimatedMessages = 2; }
                if (promptLength > 2000) { estimatedMessages = 3; }
                if (prompt.includes('tool') || prompt.includes('execute')) { estimatedMessages += 1; }
                if (prompt.includes('file') || prompt.includes('edit')) { estimatedMessages += 1; }

                const estimatedCredits = estimatedMessages * baseCredits * multiplier;

                // Estimate tool calls and file edits from prompt content
                const toolCallCount = (prompt.match(/tool|execute|run|call/gi) || []).length;
                const fileEditCount = (prompt.match(/file|edit|create|modify|update/gi) || []).length;
                const browserActions = (prompt.match(/browser|screenshot|navigate|click/gi) || []).length;

                const totalCredits = estimatedCredits
                        + toolCallCount * 1
                        + fileEditCount * 1
                        + browserActions * 2;

                // Confidence: higher for specific prompts, lower for vague ones
                let confidence = 0.7;
                if (promptLength < 100) { confidence = 0.5; }
                if (promptLength > 500) { confidence = 0.8; }
                if (prompt.includes('specific') || prompt.includes('exactly')) { confidence = 0.9; }

                const breakdown = [];
                if (estimatedMessages > 0) {
                        breakdown.push({ actionType, credits: estimatedCredits, model, multiplier });
                }
                if (toolCallCount > 0) {
                        breakdown.push({ actionType: 'tool_call' as CreditActionType, credits: toolCallCount, model, multiplier: 1 });
                }
                if (fileEditCount > 0) {
                        breakdown.push({ actionType: 'file_edit' as CreditActionType, credits: fileEditCount, model, multiplier: 1 });
                }
                if (browserActions > 0) {
                        breakdown.push({ actionType: 'browser_action' as CreditActionType, credits: browserActions * 2, model, multiplier: 1 });
                }

                return {
                        prompt: prompt.substring(0, 100),
                        estimatedCredits: totalCredits,
                        estimatedCost: totalCredits * 0.05, // Rough: $0.05 per credit
                        breakdown,
                        confidence,
                };
        }

        estimatePlanCost(plan: { agentCount: number; estimatedSteps: number; model: string }): number {
                const actionType = getMessageActionType(plan.model);
                const multiplier = getModelMultiplier(plan.model);
                const rule = this._creditRules.find(r => r.actionType === actionType);
                const baseCredits = rule?.baseCredits ?? 1;

                // Each agent step involves a message + potential tool call
                const perStepCredits = (baseCredits * multiplier) + 1; // message + tool_call
                return plan.agentCount * plan.estimatedSteps * perStepCredits;
        }

        canAfford(amount: number): boolean {
                return this.getCreditsRemaining() >= amount;
        }

        // ══════════════════════════════════════════════════════════
        // Rules & Budget
        // ══════════════════════════════════════════════════════════

        getCreditRules(): ICreditRule[] {
                return [...this._creditRules];
        }

        setBudget(budget: ICreditBudget): void {
                this._budget = { ...budget };
                this._persistState();
                this.logService.info(`[CreditSystem] Budget updated: dailyCap=${budget.dailyCap}, monthlyCap=${budget.monthlyCap}, emergencyStop=${budget.emergencyStopThreshold}`);
        }

        getBudget(): ICreditBudget {
                return { ...this._budget };
        }

        getAlerts(): IPricingAlert[] {
                return [...this._alerts];
        }

        // ══════════════════════════════════════════════════════════
        // Upgrade & Purchase
        // ══════════════════════════════════════════════════════════

        upgradeFlow(): void {
                // Open external payment page (placeholder URL)
                const url = 'https://construct-ide.dev/pricing';
                this.openerService.open(URI.parse(url), { openExternal: true });
                this.logService.info('[CreditSystem] Upgrade flow opened');
        }

        async purchaseCredits(amount: number): Promise<boolean> {
                // Find the matching package or calculate proportional credits
                const package_ = CREDIT_PACKAGES.find(p => p.credits === amount);
                if (!package_) {
                        // Allow arbitrary amounts at $0.05/credit
                        this.logService.info(`[CreditSystem] Custom purchase: ${amount} credits`);
                }

                // Simulate purchase (in production, this would go through Stripe)
                const isDevMode = this.configurationService.getValue<boolean>('construct.pricing.devMode') ?? false;
                if (isDevMode) {
                        this._purchasedCredits += amount;
                        this._persistState();
                        this._onCreditsChanged.fire({
                                remaining: this.getCreditsRemaining(),
                                total: this.getCreditsTotal(),
                                consumed: 0,
                        });
                        this.logService.info(`[CreditSystem] Purchased ${amount} credits (dev mode)`);
                        return true;
                }

                // In production, redirect to payment page
                this.upgradeFlow();
                return false;
        }

        getPricingTable(): Array<{ tier: SubscriptionTier; price: number; credits: number; features: string[] }> {
                return Object.entries(TIER_CONFIG).map(([tier, config]) => ({
                        tier: tier as SubscriptionTier,
                        price: config.price,
                        credits: config.credits,
                        features: config.features,
                }));
        }

        // ══════════════════════════════════════════════════════════
        // Export
        // ══════════════════════════════════════════════════════════

        exportUsageCSV(): string {
                const headers = ['id', 'actionType', 'model', 'creditsConsumed', 'timestamp', 'sessionId', 'agentType', 'description'];
                const rows = this._usage.map(u => [
                        u.id,
                        u.actionType,
                        u.model,
                        String(u.creditsConsumed),
                        new Date(u.timestamp).toISOString(),
                        u.sessionId,
                        u.agentType ?? '',
                        `"${(u.description ?? '').replace(/"/g, '""')}"`,
                ].join(','));

                return [headers.join(','), ...rows].join('\n');
        }

        // ══════════════════════════════════════════════════════════
        // Dev Mode
        // ══════════════════════════════════════════════════════════

        simulateTier(tier: SubscriptionTier): boolean {
                const isDevMode = this.configurationService.getValue<boolean>('construct.pricing.devMode') ?? false;
                if (!isDevMode) {
                        this.logService.warn('[CreditSystem] simulateTier only available in dev mode');
                        return false;
                }

                const oldTier = this._subscription.tier;
                if (oldTier === tier) {
                        return true;
                }

                const config = TIER_CONFIG[tier];
                this._subscription = {
                        ...this._subscription,
                        tier,
                        creditsTotal: config.credits,
                        creditsRemaining: config.credits === Infinity ? Infinity : config.credits - this._subscription.creditsUsed,
                        features: config.features,
                };

                this._persistState();
                this._onTierChanged.fire({ from: oldTier, to: tier });
                this._onCreditsChanged.fire({
                        remaining: this.getCreditsRemaining(),
                        total: this.getCreditsTotal(),
                        consumed: 0,
                });

                // Phase 27: Sync telemetry with new tier
                this._syncTelemetryWithTier();

                this.logService.info(`[CreditSystem] Simulated tier change: ${oldTier} -> ${tier}`);
                return true;
        }

        // ══════════════════════════════════════════════════════════
        // Private Helpers
        // ══════════════════════════════════════════════════════════

        /**
         * Phase 27: Sync telemetry with subscription tier.
         * Free tier = telemetry active (anonymized data contribution in exchange for free usage).
         * Paid tier = telemetry off (no data collection, privacy-first).
         */
        private _syncTelemetryWithTier(): void {
                const tier = this._subscription.tier;
                const isFree = tier === SubscriptionTier.Free;

                // Set telemetry opt-in based on tier
                try {
                        this.configurationService.updateValue('construct.telemetry.enabled', isFree);
                        this.configurationService.updateValue('construct.telemetry.mode', isFree ? 'anonymized' : 'disabled');
                } catch {
                        // Configuration update may fail in some contexts
                }

                this.logService.info(`[CreditSystem] Telemetry sync: tier=${tier}, telemetry=${isFree ? 'active (anonymized)' : 'disabled'}`);
        }

        private _checkPeriodReset(): void {
                const now = new Date();
                const periodEnd = new Date(this._subscription.periodEnd);

                if (now.getTime() > periodEnd.getTime()) {
                        // Reset credits for new billing period
                        const config = TIER_CONFIG[this._subscription.tier];
                        const newPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
                        const newPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

                        this._subscription = {
                                ...this._subscription,
                                creditsTotal: config.credits,
                                creditsRemaining: config.credits,
                                creditsUsed: 0,
                                periodStart: newPeriodStart.getTime(),
                                periodEnd: newPeriodEnd.getTime(),
                        };

                        // Clear old usage records (keep last 90 days for history)
                        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
                        this._usage = this._usage.filter(u => u.timestamp >= ninetyDaysAgo);

                        this._persistState();
                        this.logService.info(`[CreditSystem] Billing period reset: ${this._subscription.creditsRemaining} credits for ${this._subscription.tier}`);
                }
        }

        private _checkBudgetThresholds(): void {
                const remaining = this.getCreditsRemaining();
                const total = this.getCreditsTotal();

                // Skip checks for unlimited tiers
                if (total === Infinity) {
                        return;
                }

                const usageRatio = 1 - (remaining / total);

                // Check warning thresholds (50%, 80%)
                for (const threshold of this._budget.warningThresholds) {
                        if (usageRatio >= threshold) {
                                const existing = this._alerts.find(a =>
                                        a.type === 'warning' && a.threshold === threshold &&
                                        (Date.now() - a.timestamp) < 60 * 60 * 1000 // Don't repeat within 1 hour
                                );
                                if (!existing) {
                                        const alert: IPricingAlert = {
                                                type: 'warning',
                                                message: usageRatio >= 0.8
                                                        ? `80% credits used. Upgrade now to avoid interruption.`
                                                        : `Halfway through monthly credits. Consider upgrading.`,
                                                currentUsage: this.getCreditsUsed(),
                                                threshold,
                                                suggestedAction: 'Upgrade to Pro for 500 credits/month',
                                                timestamp: Date.now(),
                                        };
                                        this._alerts.push(alert);
                                        this._onBudgetWarning.fire(alert);
                                }
                        }
                }

                // Check emergency stop (< 10 credits or threshold)
                if (remaining < this._budget.emergencyStopThreshold) {
                        const existing = this._alerts.find(a =>
                                a.type === 'emergency' && (Date.now() - a.timestamp) < 30 * 60 * 1000
                        );
                        if (!existing) {
                                const alert: IPricingAlert = {
                                        type: 'emergency',
                                        message: `Critical: Only ${remaining} credits remaining. Essential actions only.`,
                                        currentUsage: this.getCreditsUsed(),
                                        threshold: this._budget.emergencyStopThreshold,
                                        suggestedAction: 'Purchase credits or upgrade your plan',
                                        timestamp: Date.now(),
                                };
                                this._alerts.push(alert);
                                this._onEmergencyStop.fire({ creditsRemaining: remaining });
                                this._onBudgetWarning.fire(alert);
                        }
                }

                // Check daily cap
                if (this._budget.dailyCap) {
                        const todayUsage = this.getUsageToday();
                        if (todayUsage >= this._budget.dailyCap) {
                                const alert: IPricingAlert = {
                                        type: 'warning',
                                        message: `Daily credit cap reached (${todayUsage}/${this._budget.dailyCap}). Actions paused until tomorrow.`,
                                        currentUsage: todayUsage,
                                        threshold: this._budget.dailyCap,
                                        suggestedAction: 'Increase daily cap in budget settings',
                                        timestamp: Date.now(),
                                };
                                this._alerts.push(alert);
                                this._onBudgetWarning.fire(alert);
                        }
                }

                // Keep only last 50 alerts
                if (this._alerts.length > 50) {
                        this._alerts = this._alerts.slice(-50);
                }
        }

        // ── Persistence ─────────────────────────────────────────

        private _loadSubscription(): ISubscription {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_SUBSCRIPTION, StorageScope.PROFILE, undefined);
                        if (saved) {
                                return JSON.parse(saved) as ISubscription;
                        }
                } catch (err) {
                        this.logService.error('[CreditSystem] Failed to load subscription:', err);
                }

                // Default: Free tier
                const now = new Date();
                const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

                return {
                        tier: SubscriptionTier.Free,
                        creditsTotal: TIER_CONFIG[SubscriptionTier.Free].credits,
                        creditsRemaining: TIER_CONFIG[SubscriptionTier.Free].credits,
                        creditsUsed: 0,
                        periodStart: periodStart.getTime(),
                        periodEnd: periodEnd.getTime(),
                        autoRenew: false,
                        paymentStatus: 'active',
                        features: TIER_CONFIG[SubscriptionTier.Free].features,
                };
        }

        private _loadUsage(): ICreditUsage[] {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_USAGE, StorageScope.PROFILE, undefined);
                        if (saved) {
                                return JSON.parse(saved) as ICreditUsage[];
                        }
                } catch (err) {
                        this.logService.error('[CreditSystem] Failed to load usage:', err);
                }
                return [];
        }

        private _loadBudget(): ICreditBudget {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_BUDGET, StorageScope.PROFILE, undefined);
                        if (saved) {
                                return JSON.parse(saved) as ICreditBudget;
                        }
                } catch (err) {
                        this.logService.error('[CreditSystem] Failed to load budget:', err);
                }
                return { ...DEFAULT_BUDGET };
        }

        private _loadPurchasedCredits(): number {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_PURCHASED, StorageScope.PROFILE, '0');
                        return parseInt(saved, 10) || 0;
                } catch {
                        return 0;
                }
        }

        private _loadAlerts(): IPricingAlert[] {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_ALERTS, StorageScope.PROFILE, undefined);
                        if (saved) {
                                return JSON.parse(saved) as IPricingAlert[];
                        }
                } catch {
                        // Ignore
                }
                return [];
        }

        private _persistState(): void {
                try {
                        this.storageService.store(STORAGE_KEY_SUBSCRIPTION, JSON.stringify(this._subscription), StorageScope.PROFILE, StorageTarget.MACHINE);
                        this.storageService.store(STORAGE_KEY_USAGE, JSON.stringify(this._usage), StorageScope.PROFILE, StorageTarget.MACHINE);
                        this.storageService.store(STORAGE_KEY_BUDGET, JSON.stringify(this._budget), StorageScope.PROFILE, StorageTarget.MACHINE);
                        this.storageService.store(STORAGE_KEY_PURCHASED, String(this._purchasedCredits), StorageScope.PROFILE, StorageTarget.MACHINE);
                        this.storageService.store(STORAGE_KEY_ALERTS, JSON.stringify(this._alerts), StorageScope.PROFILE, StorageTarget.MACHINE);
                } catch (err) {
                        this.logService.error('[CreditSystem] Failed to persist state:', err);
                }
        }

        override dispose(): void {
                this._persistState();
                super.dispose();
        }
}

// ══════════════════════════════════════════════════════════════
// CostGovernorEnhancedService — ICostGovernor implementation
// ══════════════════════════════════════════════════════════════

/**
 * Model mapping for auto-switch: premium → standard equivalent.
 */
const AUTO_SWITCH_MAP: Record<string, string> = {
        'gpt-4o-opus': 'gpt-4o',
        'claude-opus': 'claude-sonnet-3-5',
        'claude-3-opus': 'claude-3-5-sonnet',
        'o1': 'gpt-4o',
        'o1-preview': 'gpt-4o',
        'o3': 'gpt-4o',
        'gemini-ultra': 'gemini-pro',
};

export class CostGovernorEnhancedService extends Disposable implements ICostGovernor {
        declare readonly _serviceBrand: undefined;

        private _autoSwitchHistory: Array<{ from: string; to: string; timestamp: number }> = [];

        constructor(
                @ICreditSystem private readonly creditSystem: ICreditSystem,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[CostGovernor] Enhanced cost governor initialized');
        }

        isActionAllowed(actionType: CreditActionType): boolean {
                const remaining = this.creditSystem.getCreditsRemaining();
                const budget = this.creditSystem.getBudget();

                // Essential actions always allowed
                if (ESSENTIAL_ACTION_TYPES.includes(actionType)) {
                        return true;
                }

                // Emergency mode: block non-essential actions
                if (remaining < budget.emergencyStopThreshold) {
                        this.logService.warn(`[CostGovernor] Action blocked (emergency mode): ${actionType}, credits=${remaining}`);
                        return false;
                }

                // Check daily cap
                if (budget.dailyCap) {
                        const todayUsage = this.creditSystem.getUsageToday();
                        if (todayUsage >= budget.dailyCap) {
                                this.logService.warn(`[CostGovernor] Action blocked (daily cap): ${actionType}, todayUsage=${todayUsage}`);
                                return false;
                        }
                }

                return true;
        }

        shouldAutoSwitchModel(): boolean {
                const remaining = this.creditSystem.getCreditsRemaining();
                const total = this.creditSystem.getCreditsTotal();

                // Skip for unlimited tiers
                if (total === Infinity) {
                        return false;
                }

                // Auto-switch when credits < 20% of monthly allocation
                const ratio = remaining / total;
                return ratio < 0.2;
        }

        getCheaperModel(currentModel: string): string | undefined {
                const lower = currentModel.toLowerCase();

                for (const [premium, standard] of Object.entries(AUTO_SWITCH_MAP)) {
                        if (lower.includes(premium.toLowerCase())) {
                                return standard;
                        }
                }

                // Generic fallback: if it's a premium model, suggest the base version
                if (isPremiumModel(currentModel)) {
                        // Try to find a standard model from the same provider
                        if (lower.includes('gpt') || lower.includes('openai')) {
                                return 'gpt-4o';
                        }
                        if (lower.includes('claude') || lower.includes('anthropic')) {
                                return 'claude-sonnet-3-5';
                        }
                        if (lower.includes('gemini') || lower.includes('google')) {
                                return 'gemini-pro';
                        }
                }

                return undefined;
        }

        isEmergencyMode(): boolean {
                const remaining = this.creditSystem.getCreditsRemaining();
                const budget = this.creditSystem.getBudget();
                return remaining < budget.emergencyStopThreshold;
        }

        getBudgetRecommendation(): {
                usageBreakdown: Map<CreditActionType, number>;
                recommendedTier: SubscriptionTier;
                projectedMonthlyCost: number;
                savingsVsPayAsYouGo: number;
        } {
                const breakdown = this.creditSystem.getUsageByActionType();
                const usedThisMonth = this.creditSystem.getUsageThisMonth();

                // Project monthly usage based on days elapsed
                const now = new Date();
                const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                const daysElapsed = now.getDate();
                const projectedUsage = Math.round((usedThisMonth / daysElapsed) * daysInMonth);

                // Find recommended tier based on projected usage
                let recommendedTier = SubscriptionTier.Free;
                if (projectedUsage > 50) { recommendedTier = SubscriptionTier.Pro; }
                if (projectedUsage > 500) { recommendedTier = SubscriptionTier.Team; }
                if (projectedUsage > 1000) { recommendedTier = SubscriptionTier.Enterprise; }

                // Calculate savings vs pay-as-you-go ($0.05/credit)
                const payAsYouGoCost = projectedUsage * 0.05;
                const tierConfig = TIER_CONFIG[recommendedTier];
                const savings = payAsYouGoCost - tierConfig.price;

                return {
                        usageBreakdown: breakdown,
                        recommendedTier,
                        projectedMonthlyCost: projectedUsage * 0.05,
                        savingsVsPayAsYouGo: Math.max(0, savings),
                };
        }

        recordAutoSwitch(fromModel: string, toModel: string): void {
                this._autoSwitchHistory.push({
                        from: fromModel,
                        to: toModel,
                        timestamp: Date.now(),
                });

                // Keep only last 50 records
                if (this._autoSwitchHistory.length > 50) {
                        this._autoSwitchHistory = this._autoSwitchHistory.slice(-50);
                }

                this.logService.info(`[CostGovernor] Auto-switch: ${fromModel} -> ${toModel}`);
        }

        getAutoSwitchHistory(): Array<{ from: string; to: string; timestamp: number }> {
                return [...this._autoSwitchHistory];
        }

        override dispose(): void {
                this._autoSwitchHistory = [];
                super.dispose();
        }
}
