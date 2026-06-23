/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * costGovernorService.ts -- Phase 7 stub for Phase 1 dependency
 *
 * Permissive no-op implementation that allows all calls.
 * Will be replaced by the real implementation in Phase 7 (Safety Rails).
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICostGovernorService, CostRecord, BudgetSnapshot } from '../../../../../platform/construct/common/costGovernor.js';

export class CostGovernorService extends Disposable implements ICostGovernorService {
	declare readonly _serviceBrand: undefined;

	private readonly _records: CostRecord[] = [];

	constructor(@ILogService private readonly logService: ILogService) {
		super();
		this.logService.info('[CostGovernor] Initialized (permissive stub — Phase 7 will provide full implementation)');
	}

	isCallAllowed(estimatedTokens: number): boolean {
		// Permissive: always allow calls until Phase 7 implements real budgets
		return true;
	}

	recordCost(record: CostRecord): void {
		this._records.push(record);
		this.logService.trace(`[CostGovernor] Recorded cost: $${record.costUSD.toFixed(6)} for ${record.providerId}/${record.model}`);
	}

	getBudgetSnapshot(): BudgetSnapshot {
		const totalCost = this._records.reduce((sum, r) => sum + r.costUSD, 0);
		const totalTokens = this._records.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
		return {
			tokensUsed: totalTokens,
			tokenCeiling: Infinity,
			costUsed: totalCost,
			costCeiling: Infinity,
			emergencyStop: false,
		};
	}
}
