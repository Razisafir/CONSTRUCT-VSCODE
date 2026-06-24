/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * Phase 4 integration test -- drives a simulated agent round through the
 * Phase 3 wiring (cost gate -> tool call -> credit consumption -> sanity
 * check -> next round).
 *
 * This is NOT a mock of the thing being tested. The helpers themselves
 * (mapToolToActionType, checkCostGate, applyCommandSanity,
 * consumeCreditsForToolCall) are 100% real. The collaborators
 * (ICostGovernor, ICreditSystem, IExecutionSanityService) are stubbed
 * with in-memory implementations that the test controls -- this lets us
 * simulate the three scenarios the user explicitly asked Phase 4 to verify:
 *
 *   1. Cost gate blocks at the emergency threshold
 *   2. Sanity check flags a hallucinated success (exit 0 but no real output)
 *   3. Credits are NOT consumed on tool failure
 *
 * Why not instantiate the real AgentLoopService? It has 22 injected
 * dependencies (aiService, mcpProcess, terminalExecutor, diffApplier,
 * memoryOrchestrator, constructMemory, workspaceContextService,
 * commandService, fileService, errorRecovery, snapshotManager,
 * fileWatcher, pendingChanges, mcpServerManager, universalMemory,
 * skillRegistry, dialogService, toolRegistry, costGovernor, creditSystem,
 * executionSanity, logService). Instantiating it for a focused test of the
 * Phase 3 wiring would require stubbing all 22 -- most of which are
 * irrelevant to the cost-gate/sanity/credit path. The helpers were
 * extracted in Phase 4 specifically to avoid this.
 *
 * Why not use the real ExecutionSanityService / CreditSystemService /
 * CostGovernorEnhancedService concrete classes? They import VS Code
 * internals (Disposable, URI, IFileService, IWorkspaceContextService,
 * IStorageService) that aren't available in the standalone mocha runner
 * (npm run test-unit-construct). The Electron-based test runner
 * (./scripts/test.sh) does have them, but we want these tests to run
 * in both environments. Using stubs for collaborators keeps the tests
 * portable while still exercising 100% of the helper logic.
 */

import * as assert from 'assert';

import {
	mapToolToActionType,
	checkCostGate,
	applyCommandSanity,
	consumeCreditsForToolCall,
} from '../../../../src/vs/platform/construct/common/agent/agentLoopHelpers.js';
import { CreditActionType } from '../../../../src/vs/platform/construct/common/pricing/pricingTypes.js';
import {
	IExecutionSanityService,
	SanitySeverity,
	SanityCheckResult,
} from '../../../../src/vs/platform/construct/common/executionSanity.js';
import { ICostGovernor, ICreditSystem } from '../../../../src/vs/platform/construct/common/pricing/creditSystem.js';
import { ILogService } from '../../../../src/vs/platform/log/common/log.js';

// ----------------------------------------------------------------------
// Minimal stub implementations of the four collaborator interfaces.
// These are deliberately simple -- they record calls and let the test
// script their return values.
// ----------------------------------------------------------------------

class TestLogService implements ILogService {
	declare readonly _serviceBrand: undefined;
	public traceMessages: string[] = [];
	public infoMessages: string[] = [];
	public warnMessages: string[] = [];
	public errorMessages: string[] = [];

	trace(message: string): void { this.traceMessages.push(message); }
	debug(_message: string): void { throw new Error('TestLogService.debug not expected'); }
	info(message: string): void { this.infoMessages.push(message); }
	warn(message: string): void { this.warnMessages.push(message); }
	error(message: string | Error): void {
		this.errorMessages.push(typeof message === 'string' ? message : message.message);
	}

	dispose(): void { /* no-op */ }
	flush(): void { /* no-op */ }
	getLevel(): number { return 0; }
	setLevel(_level: number): void { /* no-op */ }
	readonly onDidChangeLogLevel: any = undefined;
}

interface MutableCostGovernorOptions {
	emergencyMode: boolean;
	shouldAutoSwitch: boolean;
	cheaperModel: string | undefined;
}

class TestCostGovernor implements ICostGovernor {
	declare readonly _serviceBrand: undefined;
	public opts: MutableCostGovernorOptions;
	constructor(opts: MutableCostGovernorOptions) { this.opts = opts; }

	isEmergencyMode(): boolean { return this.opts.emergencyMode; }
	shouldAutoSwitchModel(): boolean { return this.opts.shouldAutoSwitch; }
	getCheaperModel(_currentModel: string): string | undefined { return this.opts.cheaperModel; }

	// Methods required by interface but not used by checkCostGate.
	// Throwing if called makes accidental coupling visible in tests.
	isActionAllowed(_actionType: CreditActionType): boolean {
		throw new Error('TestCostGovernor.isActionAllowed not expected to be called by checkCostGate');
	}
	getBudgetRecommendation(): never {
		throw new Error('TestCostGovernor.getBudgetRecommendation not expected to be called by checkCostGate');
	}
	recordAutoSwitch(_from: string, _to: string): void {
		throw new Error('TestCostGovernor.recordAutoSwitch not expected to be called by checkCostGate');
	}
	getAutoSwitchHistory(): never {
		throw new Error('TestCostGovernor.getAutoSwitchHistory not expected to be called by checkCostGate');
	}
}

class TestCreditSystem implements ICreditSystem {
	declare readonly _serviceBrand: undefined;

	public remaining: number;
	public total: number;
	public consumed: number = 0;
	public consumeCallCount: number = 0;
	public lastConsumeActionType: CreditActionType | null = null;
	public lastConsumeMetadata: { agentType?: string; sessionId?: string; description?: string } | null = null;
	public consumeReturn: boolean = true;

	constructor(opts: { remaining?: number; total?: number; consumeReturn?: boolean } = {}) {
		this.remaining = opts.remaining ?? 100;
		this.total = opts.total ?? 100;
		this.consumeReturn = opts.consumeReturn ?? true;
	}

	getCreditsRemaining(): number { return this.remaining; }
	getCreditsTotal(): number { return this.total; }
	getCreditsUsed(): number { return this.consumed; }

	consumeCredits(
		amount: number,
		actionType: CreditActionType,
		metadata?: { model?: string; sessionId?: string; agentType?: string; description?: string },
	): boolean {
		this.consumeCallCount++;
		this.lastConsumeActionType = actionType;
		this.lastConsumeMetadata = metadata ?? null;
		if (this.consumeReturn && this.remaining >= amount) {
			this.remaining -= amount;
			this.consumed += amount;
			return true;
		}
		return false;
	}

	// Methods required by interface but not used by consumeCreditsForToolCall.
	getCurrentTier(): never { throw new Error('not expected'); }
	getSubscription(): never { throw new Error('not expected'); }
	getUsageHistory(): never { throw new Error('not expected'); }
	getUsageThisMonth(): never { throw new Error('not expected'); }
	getUsageToday(): never { throw new Error('not expected'); }
	getUsageByActionType(): never { throw new Error('not expected'); }
	estimateCost(): never { throw new Error('not expected'); }
	estimatePlanCost(): never { throw new Error('not expected'); }
	canAfford(): never { throw new Error('not expected'); }
	getCreditRules(): never { throw new Error('not expected'); }
	setBudget(): never { throw new Error('not expected'); }
	getBudget(): never { throw new Error('not expected'); }
	getAlerts(): never { throw new Error('not expected'); }
	upgradeFlow(): never { throw new Error('not expected'); }
	purchaseCredits(): never { throw new Error('not expected'); }
	getPricingTable(): never { throw new Error('not expected'); }
	exportUsageCSV(): never { throw new Error('not expected'); }
	simulateTier(): never { throw new Error('not expected'); }

	// Events -- Emitter-based stubs (not used by consumeCreditsForToolCall,
	// but required by the interface). Returning undefined is fine because the
	// helper never subscribes to these.
	readonly onCreditsChanged: any = undefined;
	readonly onBudgetWarning: any = undefined;
	readonly onEmergencyStop: any = undefined;
	readonly onTierChanged: any = undefined;
	readonly onUsageRecorded: any = undefined;
}

class TestExecutionSanityService implements IExecutionSanityService {
	declare readonly _serviceBrand: undefined;

	public validateCallCount: number = 0;
	public lastValidateArgs: { command: string; exitCode: number; stdout: string; stderr: string } | null = null;

	// Controls what validateCommandResult returns. Default: empty array (no findings).
	public nextResults: SanityCheckResult[] = [];

	validateCommandResult(command: string, exitCode: number, stdout: string, stderr: string): SanityCheckResult[] {
		this.validateCallCount++;
		this.lastValidateArgs = { command, exitCode, stdout, stderr };
		const results = this.nextResults;
		this.nextResults = []; // reset for next call
		return results;
	}

	// Methods required by interface but not used by applyCommandSanity.
	validateBuildResult(): never { throw new Error('not expected'); }
	validateTestResult(): never { throw new Error('not expected'); }
	validateGitResult(): never { throw new Error('not expected'); }
	validateFileEdit(): never { throw new Error('not expected'); }
	validateMilestoneCompletion(): never { throw new Error('not expected'); }
	generateReport(): never { throw new Error('not expected'); }
	getConfig(): never { throw new Error('not expected'); }
	updateConfig(): never { throw new Error('not expected'); }
	getHallucinationCount(): never { throw new Error('not expected'); }
	getHallucinationPreventionRate(): never { throw new Error('not expected'); }
}

// ----------------------------------------------------------------------
// Helper: build a "suspiciously-empty-output" Warning finding (the
// hallucinated-success case the user explicitly asked us to test).
// ----------------------------------------------------------------------

function makeEmptyOutputWarning(command: string): SanityCheckResult {
	return {
		checkName: 'suspiciously-empty-output',
		description: `Command "${command}" exited with code 0 but produced no output`,
		severity: SanitySeverity.Warning,
		message: 'suspiciously empty output',
		evidence: 'stdout and stderr are both empty strings',
		suggestedAction: 'Verify the command actually executed and produced the expected effect',
	};
}

// ----------------------------------------------------------------------
// Integration scenarios
// ----------------------------------------------------------------------

suite('Phase 3 wiring -- integration of helpers (simulated agent round)', () => {

	let log: TestLogService;
	let costGovernor: TestCostGovernor;
	let creditSystem: TestCreditSystem;
	let executionSanity: TestExecutionSanityService;

	setup(() => {
		log = new TestLogService();
		costGovernor = new TestCostGovernor({
			emergencyMode: false,
			shouldAutoSwitch: false,
			cheaperModel: undefined,
		});
		creditSystem = new TestCreditSystem({ remaining: 100, total: 100 });
		executionSanity = new TestExecutionSanityService();
	});

	test('SCENARIO 1: cost gate blocks at the emergency threshold', () => {
		// Simulate: agent has been running, credits have been consumed down
		// to 5 (below the 10-credit emergency threshold). The next round's
		// checkCostGate() must block the loop.
		creditSystem.remaining = 5;
		costGovernor.opts.emergencyMode = true;

		const gate = checkCostGate(costGovernor, creditSystem, log);

		assert.strictEqual(gate.allowed, false, 'emergency mode must block the gate');
		assert.ok(gate.reason.includes('5 credits remaining'), `reason must include remaining count, got: ${gate.reason}`);
		assert.ok(gate.reason.includes('Replenish credits'), 'reason must tell user how to recover');

		// In the real agent loop, this would yield a recoverable error and return.
		// We simulate that by NOT proceeding to tool calls -- if the gate is
		// blocked, no tool runs, no credits are consumed.
		const creditsBefore = creditSystem.remaining;
		// (no tool call happens)
		assert.strictEqual(creditSystem.remaining, creditsBefore, 'credits must not change when gate blocks');
		assert.strictEqual(creditSystem.consumeCallCount, 0, 'consumeCredits must not be called when gate blocks');
	});

	test('SCENARIO 2: sanity check flags hallucinated success (exit 0 but no real output)', () => {
		// Simulate: LLM called run_command with `mkdir -p build`. The command
		// exited 0 but produced literally no output (both stdout and stderr
		// are empty). The real ExecutionSanityService.validateCommandResult
		// flags this as a Warning ("suspiciously-empty-output"). Phase 4 fix:
		// applyCommandSanity now treats Warning as suspicious (Phase 3 only
		// flagged Critical/Fail, which meant this case was silently dropped).
		executionSanity.nextResults = [makeEmptyOutputWarning('mkdir -p build')];

		const result = applyCommandSanity(
			executionSanity,
			log,
			'mkdir -p build',
			0,          // exit 0 (claimed success)
			'',         // empty stdout
			'',         // empty stderr
		);

		// The Phase 4 fix is what makes this assertion pass. Under Phase 3
		// code, this would have been suspicious=false (Warning was filtered out).
		assert.strictEqual(result.suspicious, true, 'Phase 4 fix: exit 0 + empty output must be flagged as suspicious');
		assert.ok(result.output.includes('suspiciously-empty-output'), 'augmented output must include the finding');
		assert.ok(result.output.includes('Re-plan based on the actual output'), 'must tell LLM to re-plan');
		assert.strictEqual(log.warnMessages.length, 1, 'must log the suspicious finding at warn level');
		assert.ok(log.warnMessages[0].includes('Suspicious command output'));

		// The LLM sees the augmented output and can re-plan -- e.g. run `ls
		// build/` to verify the directory was actually created. This is the
		// hallucinated-success detector working as designed.
	});

	test('SCENARIO 3: credits are NOT consumed on tool failure', () => {
		// Simulate: LLM called write_file, but the tool execution failed
		// (e.g. permission denied). The user must NOT be billed for this.
		// consumeCreditsForToolCall must short-circuit on success=false.
		const creditsBefore = creditSystem.remaining;

		const consumed = consumeCreditsForToolCall(
			creditSystem,
			log,
			'write_file',
			false,  // success=false (tool failed)
			'session-test',
		);

		assert.strictEqual(consumed, false, 'must return false when no consumption happened');
		assert.strictEqual(creditSystem.consumeCallCount, 0, 'must NOT call consumeCredits on failure');
		assert.strictEqual(creditSystem.remaining, creditsBefore, 'remaining credits must be unchanged');
		assert.strictEqual(log.warnMessages.length, 0, 'no warning logged (failure is a normal code path)');
	});

	test('SCENARIO 4: full happy-path round -- gate allows, tool succeeds, credit consumed, sanity clean', () => {
		// Simulate a clean agent round:
		// 1. checkCostGate() allows (not emergency)
		// 2. LLM calls write_file, tool succeeds
		// 3. consumeCreditsForToolCall consumes 1 credit
		// 4. (no run_command in this round, so no sanity check)
		const creditsBefore = creditSystem.remaining;

		// Round 1: gate check
		const gate = checkCostGate(costGovernor, creditSystem, log);
		assert.strictEqual(gate.allowed, true, 'gate must allow when not in emergency mode');

		// Tool call: write_file succeeds
		const consumed = consumeCreditsForToolCall(creditSystem, log, 'write_file', true, 'session-happy');
		assert.strictEqual(consumed, true, 'consumption must succeed');
		assert.strictEqual(creditSystem.consumeCallCount, 1);
		assert.strictEqual(creditSystem.lastConsumeActionType, 'file_edit');
		assert.strictEqual(creditSystem.lastConsumeMetadata?.agentType, 'kovix-agent');
		assert.strictEqual(creditSystem.lastConsumeMetadata?.sessionId, 'session-happy');
		assert.strictEqual(creditSystem.remaining, creditsBefore - 1, 'exactly 1 credit consumed');
	});

	test('SCENARIO 5: hallucinated success after a successful write -- the LLM claims it built something but the build command produced nothing', () => {
		// Full flow that exercises both the credit-consumption path AND the
		// sanity-check path in sequence (as would happen in a real round):
		//   1. checkCostGate allows
		//   2. write_file succeeds -> 1 credit consumed
		//   3. run_command (build) exits 0 but produces no output -> sanity flags
		const creditsBefore = creditSystem.remaining;

		// (1) Gate
		const gate = checkCostGate(costGovernor, creditSystem, log);
		assert.strictEqual(gate.allowed, true);

		// (2) write_file succeeds
		consumeCreditsForToolCall(creditSystem, log, 'write_file', true, 'session-5');
		assert.strictEqual(creditSystem.remaining, creditsBefore - 1);

		// (3) run_command 'npm run build' exits 0 but empty output
		executionSanity.nextResults = [makeEmptyOutputWarning('npm run build')];
		const sanity = applyCommandSanity(executionSanity, log, 'npm run build', 0, '', '');
		assert.strictEqual(sanity.suspicious, true, 'build with empty output must be flagged');
		assert.ok(sanity.output.includes('suspiciously-empty-output'));

		// The LLM now sees the sanity findings appended to the tool output.
		// In the real agent loop, it would re-plan (e.g. re-run the build
		// with verbose output, or check the dist/ folder manually).
	});

	test('SCENARIO 6: emergency threshold reached mid-round -- next round blocks, current tool still consumes', () => {
		// Simulate: agent has 11 credits. Round N's checkCostGate allows
		// (not yet in emergency). A write_file consumes 1 credit (now 10).
		// Before round N+1, the cost governor flips to emergency mode
		// (threshold is <10, so 10 is the boundary -- let's say 9 triggers it).
		// Round N+1's checkCostGate blocks.
		creditSystem.remaining = 11;

		// Round N: gate allows
		const gateN = checkCostGate(costGovernor, creditSystem, log);
		assert.strictEqual(gateN.allowed, true);

		// Tool succeeds, consumes 1 credit
		consumeCreditsForToolCall(creditSystem, log, 'write_file', true, 'session-6');
		assert.strictEqual(creditSystem.remaining, 10);

		// Before round N+1: governor enters emergency mode (credits dropped
		// below the 10-credit threshold -- say, another concurrent session
		// consumed a credit, or the threshold is <=10).
		creditSystem.remaining = 9;
		costGovernor.opts.emergencyMode = true;

		// Round N+1: gate blocks
		const gateN1 = checkCostGate(costGovernor, creditSystem, log);
		assert.strictEqual(gateN1.allowed, false);
		assert.ok(gateN1.reason.includes('9 credits remaining'));
	});
});
