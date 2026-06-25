/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * Phase 4 unit tests for the extracted agentLoopHelpers.
 *
 * These tests exercise the REAL logic of:
 *   - mapToolToActionType
 *   - checkCostGate
 *   - applyCommandSanity (including the Phase 4 fix: Warning now triggers suspicious=true)
 *   - consumeCreditsForToolCall (including: no consumption on failure, fire-and-forget on throw)
 *
 * The collaborators (ICostGovernor, ICreditSystem, IExecutionSanityService, ILogService)
 * are stubbed with in-memory implementations that record calls and return controlled
 * values. This is NOT "mocking away the thing being tested" -- the helpers themselves
 * are 100% real. The stubs just provide inputs and capture outputs for assertion.
 */

import * as assert from 'assert';

import {
	mapToolToActionType,
	checkCostGate,
	applyCommandSanity,
	consumeCreditsForToolCall,
} from '../../../../src/vs/platform/construct/common/agent/agentLoopHelpers.js';
import { CreditActionType } from '../../../../src/vs/platform/construct/common/pricing/pricingTypes.js';
import { SanitySeverity, SanityCheckResult } from '../../../../src/vs/platform/construct/common/executionSanity.js';
import { ICostGovernor, ICreditSystem } from '../../../../src/vs/platform/construct/common/pricing/creditSystem.js';
import { IExecutionSanityService } from '../../../../src/vs/platform/construct/common/executionSanity.js';
import { ILogService } from '../../../../src/vs/platform/log/common/log.js';

// ----------------------------------------------------------------------
// Test stubs -- minimal implementations of the collaborator interfaces.
// Methods that the helpers don't call throw 'not expected' so accidental
// coupling is visible. The helpers ARE the thing being tested; these
// stubs are just their collaborators.
// ----------------------------------------------------------------------

interface LogCall {
	level: 'trace' | 'info' | 'warn' | 'error';
	message: string;
}

class StubLogService implements ILogService {
	declare readonly _serviceBrand: undefined;
	public calls: LogCall[] = [];

	trace(message: string): void { this.calls.push({ level: 'trace', message }); }
	debug(_message: string): void { throw new Error('StubLogService.debug not expected'); }
	info(message: string): void { this.calls.push({ level: 'info', message }); }
	warn(message: string): void { this.calls.push({ level: 'warn', message }); }
	error(message: string | Error): void {
		this.calls.push({ level: 'error', message: typeof message === 'string' ? message : message.message });
	}

	dispose(): void { /* no-op */ }
	flush(): void { /* no-op */ }
	getLevel(): number { return 0; }
	setLevel(_level: number): void { /* no-op */ }
	readonly onDidChangeLogLevel: any = undefined;
}

class StubCostGovernor implements ICostGovernor {
	declare readonly _serviceBrand: undefined;
	constructor(
		private opts: {
			emergencyMode?: boolean;
			shouldAutoSwitch?: boolean;
			cheaperModel?: string | undefined;
		} = {},
	) { }

	isEmergencyMode(): boolean { return this.opts.emergencyMode ?? false; }
	shouldAutoSwitchModel(): boolean { return this.opts.shouldAutoSwitch ?? false; }
	getCheaperModel(_currentModel: string): string | undefined { return this.opts.cheaperModel; }

	// Methods required by interface but not called by checkCostGate.
	isActionAllowed(_actionType: CreditActionType): boolean {
		throw new Error('StubCostGovernor.isActionAllowed not expected');
	}
	getBudgetRecommendation(): never {
		throw new Error('StubCostGovernor.getBudgetRecommendation not expected');
	}
	recordAutoSwitch(_fromModel: string, _toModel: string): void {
		throw new Error('StubCostGovernor.recordAutoSwitch not expected');
	}
	getAutoSwitchHistory(): never {
		throw new Error('StubCostGovernor.getAutoSwitchHistory not expected');
	}
}

class StubCreditSystem implements ICreditSystem {
	declare readonly _serviceBrand: undefined;
	public consumeCalls: Array<{
		amount: number;
		actionType: CreditActionType;
		metadata?: { model?: string; sessionId?: string; agentType?: string; description?: string };
	}> = [];
	public consumeReturn: boolean = true;
	public throwOnConsume: Error | null = null;
	public remaining: number = 100;

	constructor(opts: { remaining?: number; consumeReturn?: boolean; throwOnConsume?: Error | null } = {}) {
		this.remaining = opts.remaining ?? 100;
		this.consumeReturn = opts.consumeReturn ?? true;
		this.throwOnConsume = opts.throwOnConsume ?? null;
	}

	getCreditsRemaining(): number { return this.remaining; }
	consumeCredits(
		amount: number,
		actionType: CreditActionType,
		metadata?: { model?: string; sessionId?: string; agentType?: string; description?: string },
	): boolean {
		if (this.throwOnConsume) { throw this.throwOnConsume; }
		this.consumeCalls.push({ amount, actionType, metadata });
		return this.consumeReturn;
	}

	// Methods required by interface but not called by consumeCreditsForToolCall.
	getCurrentTier(): never { throw new Error('not expected'); }
	getSubscription(): never { throw new Error('not expected'); }
	getCreditsTotal(): never { throw new Error('not expected'); }
	getCreditsUsed(): never { throw new Error('not expected'); }
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

	readonly onCreditsChanged: any = undefined;
	readonly onBudgetWarning: any = undefined;
	readonly onEmergencyStop: any = undefined;
	readonly onTierChanged: any = undefined;
	readonly onUsageRecorded: any = undefined;
}

class StubExecutionSanity implements IExecutionSanityService {
	declare readonly _serviceBrand: undefined;
	public validateCalls: Array<{
		command: string;
		exitCode: number;
		stdout: string;
		stderr: string;
	}> = [];
	public returnResults: SanityCheckResult[] = [];
	public throwOnValidate: Error | null = null;

	constructor(opts: { returnResults?: SanityCheckResult[]; throwOnValidate?: Error | null } = {}) {
		this.returnResults = opts.returnResults ?? [];
		this.throwOnValidate = opts.throwOnValidate ?? null;
	}

	validateCommandResult(command: string, exitCode: number, stdout: string, stderr: string): SanityCheckResult[] {
		if (this.throwOnValidate) { throw this.throwOnValidate; }
		this.validateCalls.push({ command, exitCode, stdout, stderr });
		return this.returnResults;
	}

	// Methods required by interface but not called by applyCommandSanity.
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
// mapToolToActionType
// ----------------------------------------------------------------------

suite('agentLoopHelpers -- mapToolToActionType', () => {
	test('write_file maps to file_edit', () => {
		assert.strictEqual(mapToolToActionType('write_file'), 'file_edit');
	});

	test('edit_file maps to file_edit', () => {
		assert.strictEqual(mapToolToActionType('edit_file'), 'file_edit');
	});

	test('run_command maps to terminal_command', () => {
		assert.strictEqual(mapToolToActionType('run_command'), 'terminal_command');
	});

	test('web_search maps to browser_action', () => {
		assert.strictEqual(mapToolToActionType('web_search'), 'browser_action');
	});

	test('search_codebase maps to tool_call (reads are billed as generic tool calls)', () => {
		assert.strictEqual(mapToolToActionType('search_codebase'), 'tool_call');
	});

	test('unknown tool maps to tool_call (default)', () => {
		assert.strictEqual(mapToolToActionType('some_unknown_tool'), 'tool_call');
	});

	test('MCP tool name (serverName__toolName) maps to tool_call', () => {
		assert.strictEqual(mapToolToActionType('filesystem__read_file'), 'tool_call');
	});

	test('empty string maps to tool_call (default)', () => {
		assert.strictEqual(mapToolToActionType(''), 'tool_call');
	});
});

// ----------------------------------------------------------------------
// checkCostGate
// ----------------------------------------------------------------------

suite('agentLoopHelpers -- checkCostGate', () => {
	test('allows when not in emergency mode and no auto-switch recommended', () => {
		const governor = new StubCostGovernor({ emergencyMode: false, shouldAutoSwitch: false });
		const credits = new StubCreditSystem({ remaining: 100 });
		const log = new StubLogService();

		const result = checkCostGate(governor, credits, log);

		assert.strictEqual(result.allowed, true);
		assert.strictEqual(result.reason, '');
		assert.strictEqual(log.calls.length, 0, 'no log calls expected');
	});

	test('blocks when emergency mode is active', () => {
		const governor = new StubCostGovernor({ emergencyMode: true });
		const credits = new StubCreditSystem({ remaining: 5 });
		const log = new StubLogService();

		const result = checkCostGate(governor, credits, log);

		assert.strictEqual(result.allowed, false);
		assert.ok(result.reason.includes('emergency stop'), `reason should mention emergency stop, got: ${result.reason}`);
		assert.ok(result.reason.includes('5'), `reason should include remaining credits, got: ${result.reason}`);
		assert.ok(result.reason.includes('Replenish'), `reason should tell user how to recover, got: ${result.reason}`);
		assert.strictEqual(log.calls.length, 0, 'no log calls expected when blocked (logging happens upstream)');
	});

	test('logs info when auto-switch is recommended and a cheaper model exists', () => {
		const governor = new StubCostGovernor({
			emergencyMode: false,
			shouldAutoSwitch: true,
			cheaperModel: 'gpt-4o-mini',
		});
		const credits = new StubCreditSystem({ remaining: 15 });
		const log = new StubLogService();

		const result = checkCostGate(governor, credits, log);

		assert.strictEqual(result.allowed, true, 'auto-switch does not block, just recommends');
		assert.strictEqual(result.reason, '');
		assert.strictEqual(log.calls.length, 1);
		assert.strictEqual(log.calls[0].level, 'info');
		assert.ok(log.calls[0].message.includes('gpt-4o-mini'), `log should mention cheaper model, got: ${log.calls[0].message}`);
		assert.ok(log.calls[0].message.includes('Credits low'), `log should explain why, got: ${log.calls[0].message}`);
	});

	test('does not log when auto-switch recommended but no cheaper model available', () => {
		const governor = new StubCostGovernor({
			emergencyMode: false,
			shouldAutoSwitch: true,
			cheaperModel: undefined,
		});
		const credits = new StubCreditSystem({ remaining: 15 });
		const log = new StubLogService();

		const result = checkCostGate(governor, credits, log);

		assert.strictEqual(result.allowed, true);
		assert.strictEqual(log.calls.length, 0, 'no log when no cheaper model to recommend');
	});

	test('emergency mode takes precedence over auto-switch recommendation', () => {
		// If both emergency mode AND auto-switch are true, emergency mode wins
		// (the loop must stop, not just recommend a cheaper model).
		const governor = new StubCostGovernor({
			emergencyMode: true,
			shouldAutoSwitch: true,
			cheaperModel: 'gpt-4o-mini',
		});
		const credits = new StubCreditSystem({ remaining: 3 });
		const log = new StubLogService();

		const result = checkCostGate(governor, credits, log);

		assert.strictEqual(result.allowed, false, 'emergency mode must block');
		assert.strictEqual(log.calls.length, 0, 'no auto-switch log when blocked');
	});
});

// ----------------------------------------------------------------------
// applyCommandSanity
// ----------------------------------------------------------------------

suite('agentLoopHelpers -- applyCommandSanity', () => {
	test('returns plain output when no findings (Pass only)', () => {
		const sanity = new StubExecutionSanity({ returnResults: [] });
		const log = new StubLogService();

		const result = applyCommandSanity(sanity, log, 'ls -la', 0, 'file1.txt\nfile2.txt', '');

		assert.strictEqual(result.suspicious, false);
		assert.strictEqual(result.output, 'file1.txt\nfile2.txt');
		assert.strictEqual(log.calls.length, 0);
		assert.strictEqual(sanity.validateCalls.length, 1);
		assert.strictEqual(sanity.validateCalls[0].command, 'ls -la');
	});

	test('Phase 4 fix: flags as suspicious when Warning finding present (exit 0 + empty output)', () => {
		// This is the case the user explicitly asked Phase 4 to test:
		// "sanity check flags a hallucinated success (exit 0 but no real output)".
		// ExecutionSanityService.validateCommandResult returns Warning for
		// "suspiciously-empty-output" (exit 0 + both stdout and stderr empty).
		// Phase 3 code only flagged Critical/Fail, so this Warning was silently
		// dropped. Phase 4 fix: Warning now also triggers suspicious=true.
		const warningResult: SanityCheckResult = {
			checkName: 'suspiciously-empty-output',
			description: 'Command "true" exited with code 0 but produced no output',
			severity: SanitySeverity.Warning,
			message: 'suspiciously empty output',
			evidence: 'stdout and stderr are both empty strings',
			suggestedAction: 'Verify the command actually executed and produced the expected effect',
		};
		const sanity = new StubExecutionSanity({ returnResults: [warningResult] });
		const log = new StubLogService();

		const result = applyCommandSanity(sanity, log, 'true', 0, '', '');

		assert.strictEqual(result.suspicious, true, 'Phase 4 fix: Warning must trigger suspicious=true');
		assert.ok(result.output.includes('--- Execution Sanity Findings ---'), 'output should include findings header');
		assert.ok(result.output.includes('[Sanity warning] suspiciously-empty-output'), 'output should include the finding');
		assert.ok(result.output.includes('Re-plan based on the actual output'), 'output should tell LLM to re-plan');
		assert.strictEqual(log.calls.length, 1);
		assert.strictEqual(log.calls[0].level, 'warn');
		assert.ok(log.calls[0].message.includes('Suspicious command output'));
	});

	test('flags as suspicious when Fail finding present (timeout marker)', () => {
		const failResult: SanityCheckResult = {
			checkName: 'timeout-marker-detected',
			description: 'Command "sleep 100" output contains timeout markers',
			severity: SanitySeverity.Fail,
			message: 'Output contains timeout markers -- execution may not have completed normally',
			evidence: 'Found timeout marker: "timed out"',
			suggestedAction: 'Re-run the command with a longer timeout',
		};
		const sanity = new StubExecutionSanity({ returnResults: [failResult] });
		const log = new StubLogService();

		const result = applyCommandSanity(sanity, log, 'sleep 100', 0, 'Operation timed out', '');

		assert.strictEqual(result.suspicious, true);
		assert.ok(result.output.includes('[Sanity fail] timeout-marker-detected'));
		assert.strictEqual(log.calls.length, 1);
		assert.strictEqual(log.calls[0].level, 'warn');
	});

	test('flags as suspicious when Critical finding present (non-zero exit but claimed success)', () => {
		const criticalResult: SanityCheckResult = {
			checkName: 'non-zero-exit-but-claimed-success',
			description: 'Command "npm test" exited with code 1 but output claims success',
			severity: SanitySeverity.Critical,
			message: 'Non-zero exit code but claimed success in output',
			evidence: 'exitCode=1, found success marker: "all tests passed"',
			suggestedAction: 'Do not trust the success claim; investigate the non-zero exit code',
		};
		const sanity = new StubExecutionSanity({ returnResults: [criticalResult] });
		const log = new StubLogService();

		const result = applyCommandSanity(sanity, log, 'npm test', 1, 'all tests passed', '');

		assert.strictEqual(result.suspicious, true);
		assert.ok(result.output.includes('[Sanity critical] non-zero-exit-but-claimed-success'));
		assert.ok(result.output.includes('Exit code: 1'), 'output should include exit code when non-zero');
	});

	test('appends ALL findings to output, not just suspicious ones', () => {
		// When multiple findings exist, all should be appended to the output
		// so the LLM sees the full picture.
		const warningResult: SanityCheckResult = {
			checkName: 'error-in-stderr',
			description: 'Command "ls" exited with code 0 but stderr contains error text',
			severity: SanitySeverity.Warning,
			message: 'Exit code indicates success but stderr contains "error"',
			evidence: 'stderr snippet: permission error',
			suggestedAction: 'Inspect stderr output for actual errors',
		};
		const criticalResult: SanityCheckResult = {
			checkName: 'non-zero-exit-but-claimed-success',
			description: 'Command exited non-zero but claimed success',
			severity: SanitySeverity.Critical,
			message: 'Non-zero exit code but claimed success',
			evidence: 'exitCode=1',
			suggestedAction: 'Investigate',
		};
		const sanity = new StubExecutionSanity({ returnResults: [warningResult, criticalResult] });
		const log = new StubLogService();

		const result = applyCommandSanity(sanity, log, 'ls', 1, 'done', 'permission error');

		assert.strictEqual(result.suspicious, true);
		assert.ok(result.output.includes('error-in-stderr'), 'output should include Warning finding');
		assert.ok(result.output.includes('non-zero-exit-but-claimed-success'), 'output should include Critical finding');
	});

	test('does not crash when validateCommandResult throws (fire-and-forget)', () => {
		// Sanity checks must never break tool execution.
		const sanity = new StubExecutionSanity({
			throwOnValidate: new Error('sanity service internal error'),
		});
		const log = new StubLogService();

		const result = applyCommandSanity(sanity, log, 'ls', 0, 'file.txt', '');

		assert.strictEqual(result.suspicious, false, 'must not flag as suspicious when validation itself failed');
		assert.strictEqual(result.output, 'file.txt', 'must return the raw output as fallback');
		assert.strictEqual(log.calls.length, 1);
		assert.strictEqual(log.calls[0].level, 'warn');
		assert.ok(log.calls[0].message.includes('validateCommandResult threw'));
		assert.ok(log.calls[0].message.includes('sanity service internal error'));
	});

	test('includes stderr in output when present', () => {
		const sanity = new StubExecutionSanity({ returnResults: [] });
		const log = new StubLogService();

		const result = applyCommandSanity(sanity, log, 'ls', 0, 'stdout-line', 'stderr-line');

		assert.strictEqual(result.suspicious, false);
		assert.strictEqual(result.output, 'stdout-line\nstderr-line');
	});
});

// ----------------------------------------------------------------------
// consumeCreditsForToolCall
// ----------------------------------------------------------------------

suite('agentLoopHelpers -- consumeCreditsForToolCall', () => {
	test('does NOT consume credits when success is false (failed tool call)', () => {
		// The user explicitly asked Phase 4 to verify this: "credits are NOT
		// consumed on tool failure". Failed tool calls must not bill the user.
		const credits = new StubCreditSystem({ remaining: 100, consumeReturn: true });
		const log = new StubLogService();

		const consumed = consumeCreditsForToolCall(credits, log, 'write_file', false, 'session-123');

		assert.strictEqual(consumed, false, 'should return false when no consumption happened');
		assert.strictEqual(credits.consumeCalls.length, 0, 'must NOT call consumeCredits on failure');
		assert.strictEqual(log.calls.length, 0, 'no log calls on failure');
	});

	test('consumes 1 credit on success with correct action type and metadata', () => {
		const credits = new StubCreditSystem({ remaining: 100, consumeReturn: true });
		const log = new StubLogService();

		const consumed = consumeCreditsForToolCall(credits, log, 'write_file', true, 'session-456');

		assert.strictEqual(consumed, true);
		assert.strictEqual(credits.consumeCalls.length, 1);
		assert.strictEqual(credits.consumeCalls[0].amount, 1);
		assert.strictEqual(credits.consumeCalls[0].actionType, 'file_edit');
		assert.strictEqual(credits.consumeCalls[0].metadata?.agentType, 'kovix-agent');
		assert.strictEqual(credits.consumeCalls[0].metadata?.sessionId, 'session-456');
		assert.strictEqual(credits.consumeCalls[0].metadata?.description, 'Agent tool: write_file');
	});

	test('maps run_command to terminal_command action type', () => {
		const credits = new StubCreditSystem({ consumeReturn: true });
		const log = new StubLogService();

		consumeCreditsForToolCall(credits, log, 'run_command', true, undefined);

		assert.strictEqual(credits.consumeCalls[0].actionType, 'terminal_command');
		assert.strictEqual(credits.consumeCalls[0].metadata?.sessionId, undefined, 'undefined sessionId should pass through');
	});

	test('logs warning when consumeCredits returns false (insufficient credits)', () => {
		// consumeCredits returns false when there are not enough credits.
		// The helper should log a warning but NOT throw -- the next round's
		// checkCostGate() will catch it and stop the loop with a recoverable error.
		const credits = new StubCreditSystem({ remaining: 0, consumeReturn: false });
		const log = new StubLogService();

		const consumed = consumeCreditsForToolCall(credits, log, 'edit_file', true, 'session-789');

		assert.strictEqual(consumed, false, 'should return false when consumeCredits returned false');
		assert.strictEqual(credits.consumeCalls.length, 1, 'consumeCredits was still called (it decided to refuse)');
		assert.strictEqual(log.calls.length, 1);
		assert.strictEqual(log.calls[0].level, 'warn');
		assert.ok(log.calls[0].message.includes('consumeCredits returned false'));
		assert.ok(log.calls[0].message.includes('edit_file'));
		assert.ok(log.calls[0].message.includes('checkCostGate'), 'warning should mention that the gate will catch it next round');
	});

	test('does NOT crash when consumeCredits throws (fire-and-forget)', () => {
		// Credit accounting must never block the agent loop. If consumeCredits
		// throws, the helper logs and returns false; the loop continues.
		const credits = new StubCreditSystem({
			throwOnConsume: new Error('credit system internal error'),
		});
		const log = new StubLogService();

		const consumed = consumeCreditsForToolCall(credits, log, 'write_file', true, 'session-abc');

		assert.strictEqual(consumed, false, 'should return false on throw (no consumption happened)');
		assert.strictEqual(log.calls.length, 1);
		assert.strictEqual(log.calls[0].level, 'warn');
		assert.ok(log.calls[0].message.includes('consumeCredits threw'));
		assert.ok(log.calls[0].message.includes('write_file'));
		assert.ok(log.calls[0].message.includes('credit system internal error'));
		assert.ok(log.calls[0].message.includes('continuing'), 'should explicitly note the loop continues');
	});

	test('works with sessionId undefined (no active snapshot)', () => {
		const credits = new StubCreditSystem({ consumeReturn: true });
		const log = new StubLogService();

		consumeCreditsForToolCall(credits, log, 'web_search', true, undefined);

		assert.strictEqual(credits.consumeCalls[0].metadata?.sessionId, undefined);
		assert.strictEqual(credits.consumeCalls[0].actionType, 'browser_action');
	});
});
