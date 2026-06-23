/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * costGovernor.ts -- Phase 7 stub for Phase 1 dependency
 *
 * Minimal interface required by LLMProviderService to compile.
 * Full implementation will be provided in Phase 7 (Safety Rails).
 */

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const ICostGovernorService = createDecorator<ICostGovernorService>('costGovernorService');

/**
 * Cost record for a single API call.
 */
export interface CostRecord {
	readonly requestId: string;
	readonly providerId: string;
	readonly model: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly costUSD: number;
	readonly timestamp: number;
	readonly durationMs: number;
}

/**
 * Budget snapshot for cost governance.
 */
export interface BudgetSnapshot {
	tokensUsed: number;
	tokenCeiling: number;
	costUsed: number;
	costCeiling: number;
	emergencyStop: boolean;
}

/**
 * ICostGovernorService -- Token and cost budget management.
 *
 * Stub for Phase 1 compilation. Full implementation in Phase 7.
 * All methods return permissive defaults (no budget limits).
 */
export interface ICostGovernorService {
	readonly _serviceBrand: undefined;

	isCallAllowed(estimatedTokens: number): boolean;
	recordCost(record: CostRecord): void;
	getBudgetSnapshot(): BudgetSnapshot;
}
