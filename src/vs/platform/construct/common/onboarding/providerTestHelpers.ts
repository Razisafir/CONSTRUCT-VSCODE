// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 2, item 2.4 — Onboarding wizard provider test helpers.
 *
 *  Pure-logic helpers for testing provider connectivity during onboarding.
 *  Used by the onboarding wizard to verify each provider is reachable before
 *  the user commits to it.
 *
 *  Audit doc §7.2: 'Wizard tests each provider with a real API call; shows
 *  latency and model count before confirming.'
 *--------------------------------------------------------------------------------------------*/

/**
 * Result of testing a provider connection.
 */
export interface IProviderTestResult {
	provider: string;
	success: boolean;
	latencyMs?: number;
	modelCount?: number;
	error?: string;
	timestamp: string;
}

/**
 * Format a provider test result for display in the onboarding wizard.
 */
export function formatProviderTestResult(result: IProviderTestResult): string {
	if (!result.success) {
		return `X ${result.provider}: ${result.error ?? 'unreachable'}`;
	}
	const latency = result.latencyMs !== undefined ? `${result.latencyMs}ms` : '?ms';
	const models = result.modelCount !== undefined ? `${result.modelCount} models` : '? models';
	return `OK ${result.provider}: ${latency}, ${models}`;
}

/**
 * Classify a provider test result as 'recommended', 'acceptable', or 'unacceptable'
 * based on latency thresholds.
 */
export function classifyProviderQuality(result: IProviderTestResult): 'recommended' | 'acceptable' | 'unacceptable' {
	if (!result.success) {
		return 'unacceptable';
	}
	if (result.latencyMs === undefined) {
		return 'acceptable';
	}
	if (result.latencyMs < 500) {
		return 'recommended';
	}
	if (result.latencyMs < 3000) {
		return 'acceptable';
	}
	return 'unacceptable';
}

/**
 * Pick the best provider from a list of test results.
 * Prefers: success > low latency > high model count.
 */
export function pickBestProvider(results: IProviderTestResult[]): IProviderTestResult | null {
	const successful = results.filter(r => r.success);
	if (successful.length === 0) {
		return null;
	}
	successful.sort((a, b) => {
		const aLat = a.latencyMs ?? Number.MAX_SAFE_INTEGER;
		const bLat = b.latencyMs ?? Number.MAX_SAFE_INTEGER;
		if (aLat !== bLat) {
			return aLat - bLat;
		}
		const aModels = a.modelCount ?? 0;
		const bModels = b.modelCount ?? 0;
		return bModels - aModels;
	});
	return successful[0]!;
}

/**
 * Build a summary line for displaying multiple provider test results.
 */
export function summarizeProviderTests(results: IProviderTestResult[]): {
	total: number;
	successful: number;
	failed: number;
	recommendedCount: number;
	summary: string;
} {
	const successful = results.filter(r => r.success).length;
	const failed = results.length - successful;
	const recommended = results.filter(r => classifyProviderQuality(r) === 'recommended').length;
	const summary = `${successful}/${results.length} providers available, ${recommended} recommended`;
	return {
		total: results.length,
		successful,
		failed,
		recommendedCount: recommended,
		summary,
	};
}
