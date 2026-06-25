/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * Phase 5.5 (Fix 1) integration test -- milestone pause/resume.
 *
 * This is the most important test in the codebase. It proves that the
 * core product feature (pause at a milestone, resume on user action,
 * skip on user action) actually works -- not just that it compiles.
 *
 * The test drives the REAL executeMilestonesWithPauses() helper (the
 * same function AgentLoopService.runWithApprovedPlan() delegates to)
 * with stubbed collaborators:
 *
 *   - executeSubTask: a stub that yields a controlled sequence of
 *     AgentLoopEvents (tokens, tool calls, completion) for each milestone.
 *   - runVerification: a stub that yields verification_result with
 *     passed=true (or passed=false when we want to test the
 *     verification-failure pause path).
 *   - awaitResume: a controllable promise that the test resolves at
 *     the right moment to simulate the user clicking "Resume" or "Skip".
 *
 * The helper itself is 100% real. The stubs just provide inputs and
 * capture outputs for assertion.
 *
 * Test cases:
 *   1. Auto mode (no pauses): all 3 milestones execute straight through,
 *      no milestone_paused events, all milestone_completed events fire.
 *   2. Selective pause at milestone 2: execution pauses after milestone 2
 *      completes; test calls resume; execution continues to milestone 3.
 *   3. Pause-at-every mode: execution pauses after every milestone;
 *      test calls resume 3 times.
 *   4. Skip from a pause: execution pauses at milestone 1; test calls
 *      skip; milestone 2 starts immediately (milestone 1 is NOT re-run).
 *   5. Verification failure triggers pause: milestone 2's verification
 *      fails; execution pauses (regardless of pauseMode); test resumes;
 *      milestone 3 starts.
 *   6. Abort during pause: signal.aborted becomes true while paused;
 *      the helper returns without firing milestone_completed.
 *   7. Empty milestone (no selected steps): still fires milestone_reached
 *      + milestone_completed, no sub-task execution.
 */

import * as assert from 'assert';

import { executeMilestonesWithPauses } from '../../../../src/vs/platform/construct/common/agent/milestoneExecutor.js';
import { IApprovedPlan, IMilestone, ISelectablePlanStep } from '../../../../src/vs/platform/construct/common/agent/milestoneStateMachine.js';
import { AgentLoopEvent } from '../../../../src/vs/platform/construct/common/agent/agentLoop.js';

// ----------------------------------------------------------------------
// Helpers: build a controlled approved plan + milestones
// ----------------------------------------------------------------------

function makeMilestone(index: number, name: string, stepIndices: number[]): IMilestone {
	return {
		id: `milestone-${index}`,
		name,
		description: `Milestone ${index + 1}: ${name}`,
		index,
		isMajor: index === 0,
		stepIndices,
		completed: false,
	};
}

function makeStep(index: number, action: ISelectablePlanStep['action'], target: string, selected = true): ISelectablePlanStep {
	return { index, action, target, description: `${action} ${target}`, selected };
}

function makePlan(opts: {
	task?: string;
	steps: ISelectablePlanStep[];
	milestones: IMilestone[];
	executionMode?: string;
	selectedMilestoneIds?: string[];
}): IApprovedPlan {
	return {
		task: opts.task ?? 'Test task',
		steps: opts.steps,
		executionMode: opts.executionMode ?? 'auto',
		milestones: opts.milestones,
		selectedMilestoneIds: opts.selectedMilestoneIds,
		approved: true,
		approvedAt: Date.now(),
	};
}

// ----------------------------------------------------------------------
// Stub: executeSubTask -- yields controlled events for a sub-task
// ----------------------------------------------------------------------

/**
 * Builds a stub executeSubTask that yields a fixed sequence of events
 * for each call. Records the sub-tasks it was called with so the test
 * can assert ordering.
 */
function makeStubExecutor() {
	const calls: string[] = [];
	return {
		calls,
		fn: async function* (subTask: string): AsyncGenerator<AgentLoopEvent> {
			calls.push(subTask);
			// Yield a token event so the helper accumulates a summary.
			yield { type: 'token', text: `Working on: ${subTask.substring(0, 40)}...` };
			// Yield a tool_start/tool_end pair (simulated).
			yield { type: 'tool_start', toolId: 't1', toolName: 'write_file' };
			yield { type: 'tool_result', toolId: 't1', toolName: 'write_file', result: 'OK', success: true };
			// End of sub-task (no more tool calls -> helper detects end).
		},
	};
}

// ----------------------------------------------------------------------
// Stub: runVerification -- yields passed=true or passed=false
// ----------------------------------------------------------------------

/**
 * Builds a stub runVerification. By default yields passed=true. To make
 * a specific milestone's verification fail, push to the failQueue.
 */
function makeStubVerifier() {
	const failQueue: boolean[] = [];
	return {
		failQueue,
		fn: async function* (): AsyncGenerator<AgentLoopEvent> {
			const shouldFail = failQueue.shift() ?? false;
			yield {
				type: 'verification_result',
				passed: !shouldFail,
				output: shouldFail ? 'exit code 1\nstderr: tests failed' : 'exit code 0\nall tests passed',
			};
		},
	};
}

// ----------------------------------------------------------------------
// Stub: awaitResume -- controllable promise
// ----------------------------------------------------------------------

/**
 * Builds a stub awaitResume that returns a promise the test can resolve
 * manually to simulate the user clicking Resume or Skip.
 */
function makeResumeController() {
	const pendingResolvers: Array<() => void> = [];
	const state = {
		pauseCount: 0,
		lastPausedMilestone: null as IMilestone | null,
	};
	return {
		/**
		 * Number of times awaitResume was called (= number of pauses).
		 */
		get pauseCount() { return state.pauseCount; },
		/**
		 * The milestone passed to the most recent awaitResume call.
		 */
		get lastPausedMilestone() { return state.lastPausedMilestone; },
		fn: (milestone: IMilestone): Promise<void> => {
			state.pauseCount++;
			state.lastPausedMilestone = milestone;
			return new Promise<void>((resolve) => {
				pendingResolvers.push(resolve);
			});
		},
		/**
		 * Simulate the user clicking "Resume" -- resolves the pending pause.
		 */
		resume: () => {
			const r = pendingResolvers.shift();
			if (r) { r(); }
		},
	};
}

// ----------------------------------------------------------------------
// Helper: collect all events from the helper into an array
// ----------------------------------------------------------------------

async function collectEvents(
	stream: AsyncGenerator<AgentLoopEvent>,
): Promise<AgentLoopEvent[]> {
	const events: AgentLoopEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

// ----------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------

describe('Phase 5.5 (Fix 1) -- milestone pause/resume integration', () => {

	describe('auto mode (no user-selected pauses)', () => {

		it('executes all 3 milestones straight through without pausing', async () => {
			const plan = makePlan({
				steps: [
					makeStep(0, 'Read', 'a'),
					makeStep(1, 'Create', 'b'),
					makeStep(2, 'Edit', 'c'),
				],
				milestones: [
					makeMilestone(0, 'Setup', [0]),
					makeMilestone(1, 'Build', [1]),
					makeMilestone(2, 'Polish', [2]),
				],
				executionMode: 'auto',
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			const resume = makeResumeController();

			const events = await collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
			}));

			// Should have called executeSubTask 3 times (one per milestone)
			assert.strictEqual(executor.calls.length, 3, 'executeSubTask should be called 3 times');

			// Should NOT have paused
			assert.strictEqual(resume.pauseCount, 0, 'Should not pause in auto mode');

			// Should have fired milestone_reached + milestone_completed for each
			const reached = events.filter(e => e.type === 'milestone_reached');
			const completed = events.filter(e => e.type === 'milestone_completed');
			const paused = events.filter(e => e.type === 'milestone_paused');
			assert.strictEqual(reached.length, 3, 'Should fire 3 milestone_reached events');
			assert.strictEqual(completed.length, 3, 'Should fire 3 milestone_completed events');
			assert.strictEqual(paused.length, 0, 'Should fire 0 milestone_paused events');

			// Should fire a final complete event
			const complete = events.find(e => e.type === 'complete');
			assert.ok(complete, 'Should fire a complete event');
		});

		it('fires milestone events in the correct order', async () => {
			const plan = makePlan({
				steps: [makeStep(0, 'Read', 'a'), makeStep(1, 'Create', 'b')],
				milestones: [
					makeMilestone(0, 'M0', [0]),
					makeMilestone(1, 'M1', [1]),
				],
				executionMode: 'auto',
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			const resume = makeResumeController();

			const events = await collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
			}));

			// Extract just the milestone event types in order
			const milestoneEvents = events
				.filter(e => e.type.startsWith('milestone_'))
				.map(e => `${e.type}:${(e as any).milestone.id}`);

			// Expected: reached:m0, completed:m0, reached:m1, completed:m1
			assert.deepStrictEqual(milestoneEvents, [
				'milestone_reached:milestone-0',
				'milestone_completed:milestone-0',
				'milestone_reached:milestone-1',
				'milestone_completed:milestone-1',
			]);
		});
	});

	describe('selective pause mode', () => {

		it('pauses at the selected milestone and resumes when the user calls resume', async () => {
			const plan = makePlan({
				steps: [
					makeStep(0, 'Read', 'a'),
					makeStep(1, 'Create', 'b'),
					makeStep(2, 'Edit', 'c'),
				],
				milestones: [
					makeMilestone(0, 'M0', [0]),
					makeMilestone(1, 'M1', [1]),  // user wants to pause here
					makeMilestone(2, 'M2', [2]),
				],
				executionMode: 'selective',
				selectedMilestoneIds: ['milestone-1'],
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			const resume = makeResumeController();

			// Run the helper but don't await it yet -- we need to drive the
			// resume from outside while it's running.
			const promise = collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
			}));

			// Wait a tick for the helper to reach the pause point.
			// The helper will call awaitResume when it pauses at milestone-1.
			// We poll until resume.pauseCount > 0 or timeout.
			const start = Date.now();
			while (resume.pauseCount === 0 && Date.now() - start < 2000) {
				await new Promise(r => setTimeout(r, 10));
			}
			assert.strictEqual(resume.pauseCount, 1, 'Should have paused once (at milestone-1)');
			assert.strictEqual(resume.lastPausedMilestone?.id, 'milestone-1');

			// Resume -- this unblocks the helper
			resume.resume();

			const events = await promise;

			// Should have called executeSubTask 3 times (one per milestone)
			assert.strictEqual(executor.calls.length, 3, 'All 3 milestones should have executed');

			// Should have fired milestone_paused once + milestone_resumed once
			const paused = events.filter(e => e.type === 'milestone_paused');
			const resumed = events.filter(e => e.type === 'milestone_resumed');
			assert.strictEqual(paused.length, 1, 'Should fire 1 milestone_paused event');
			assert.strictEqual(resumed.length, 1, 'Should fire 1 milestone_resumed event');
			assert.strictEqual((paused[0] as any).milestone.id, 'milestone-1');
			assert.strictEqual((resumed[0] as any).milestone.id, 'milestone-1');

			// All 3 milestones should have completed
			const completed = events.filter(e => e.type === 'milestone_completed');
			assert.strictEqual(completed.length, 3, 'All 3 milestones should complete');
		});

		it('does NOT pause at milestones not in selectedMilestoneIds', async () => {
			const plan = makePlan({
				steps: [makeStep(0, 'Read', 'a'), makeStep(1, 'Create', 'b')],
				milestones: [
					makeMilestone(0, 'M0', [0]),
					makeMilestone(1, 'M1', [1]),
				],
				executionMode: 'selective',
				selectedMilestoneIds: [],  // pause at none
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			const resume = makeResumeController();

			const events = await collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
			}));

			assert.strictEqual(resume.pauseCount, 0, 'Should not pause when selectedMilestoneIds is empty');
			const paused = events.filter(e => e.type === 'milestone_paused');
			assert.strictEqual(paused.length, 0);
		});
	});

	describe('pause_at_every mode', () => {

		it('pauses after every milestone and requires 3 resumes for 3 milestones', async () => {
			const plan = makePlan({
				steps: [
					makeStep(0, 'Read', 'a'),
					makeStep(1, 'Create', 'b'),
					makeStep(2, 'Edit', 'c'),
				],
				milestones: [
					makeMilestone(0, 'M0', [0]),
					makeMilestone(1, 'M1', [1]),
					makeMilestone(2, 'M2', [2]),
				],
				executionMode: 'pause_at_every',
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			const resume = makeResumeController();

			const promise = collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
			}));

			// Drive 3 resume cycles
			for (let i = 0; i < 3; i++) {
				const start = Date.now();
				while (resume.pauseCount <= i && Date.now() - start < 2000) {
					await new Promise(r => setTimeout(r, 10));
				}
				assert.ok(resume.pauseCount > i, `Should have paused ${i + 1} times by now`);
				resume.resume();
			}

			const events = await promise;

			assert.strictEqual(resume.pauseCount, 3, 'Should pause 3 times');
			const paused = events.filter(e => e.type === 'milestone_paused');
			const resumed = events.filter(e => e.type === 'milestone_resumed');
			assert.strictEqual(paused.length, 3);
			assert.strictEqual(resumed.length, 3);

			// Verify the order: reached, paused, resumed, completed for each milestone
			const milestoneEvents = events
				.filter(e => e.type.startsWith('milestone_'))
				.map(e => `${e.type}:${(e as any).milestone.id}`);
			assert.deepStrictEqual(milestoneEvents, [
				'milestone_reached:milestone-0',
				'milestone_paused:milestone-0',
				'milestone_resumed:milestone-0',
				'milestone_completed:milestone-0',
				'milestone_reached:milestone-1',
				'milestone_paused:milestone-1',
				'milestone_resumed:milestone-1',
				'milestone_completed:milestone-1',
				'milestone_reached:milestone-2',
				'milestone_paused:milestone-2',
				'milestone_resumed:milestone-2',
				'milestone_completed:milestone-2',
			]);
		});
	});

	describe('skip from a pause', () => {

		it('skip resolves the pause and the next milestone starts (failed milestone is not re-run)', async () => {
			// "Skip" from the helper's perspective is the same as "resume" --
			// both just resolve the awaitResume promise. The AgentLoopService's
			// skipCurrentMilestone() method does the same thing as
			// resumeFromMilestone() at the helper level. The difference is in
			// state tracking (skip marks the milestone as completed-with-skipped,
			// resume marks it as completed-with-verification). But at the helper
			// level, both just unblock the pause.
			//
			// This test verifies that after a pause+resume (simulating skip),
			// the next milestone runs normally and the failed milestone is
			// NOT re-executed.
			const plan = makePlan({
				steps: [
					makeStep(0, 'Read', 'a'),
					makeStep(1, 'Create', 'b'),
				],
				milestones: [
					makeMilestone(0, 'M0', [0]),
					makeMilestone(1, 'M1', [1]),
				],
				executionMode: 'pause_at_every',
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			const resume = makeResumeController();

			const promise = collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
			}));

			// Wait for first pause + resume (skip)
			const start1 = Date.now();
			while (resume.pauseCount === 0 && Date.now() - start1 < 2000) {
				await new Promise(r => setTimeout(r, 10));
			}
			assert.strictEqual(executor.calls.length, 1, 'Only M0 should have executed so far');
			resume.resume();  // simulate skip

			// Wait for second pause + resume
			const start2 = Date.now();
			while (resume.pauseCount === 1 && Date.now() - start2 < 2000) {
				await new Promise(r => setTimeout(r, 10));
			}
			assert.strictEqual(executor.calls.length, 2, 'M1 should have executed after the first skip');
			resume.resume();

			const events = await promise;

			// Verify M0 was NOT re-executed (executor.calls has 2 entries, not 3)
			assert.strictEqual(executor.calls.length, 2, 'M0 should not be re-run after skip');
			// The sub-task strings should mention M0 then M1 (not M0 twice)
			assert.ok(executor.calls[0].includes('Milestone 1: M0'), `First call should be M0, got: ${executor.calls[0].substring(0, 100)}`);
			assert.ok(executor.calls[1].includes('Milestone 2: M1'), `Second call should be M1, got: ${executor.calls[1].substring(0, 100)}`);

			// All milestones completed
			const completed = events.filter(e => e.type === 'milestone_completed');
			assert.strictEqual(completed.length, 2);
		});
	});

	describe('verification failure triggers pause', () => {

		it('pauses when verification fails, even in auto mode', async () => {
			const plan = makePlan({
				steps: [
					makeStep(0, 'Read', 'a'),
					makeStep(1, 'Create', 'b'),
				],
				milestones: [
					makeMilestone(0, 'M0', [0]),
					makeMilestone(1, 'M1', [1]),
				],
				executionMode: 'auto',  // no user-selected pauses
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			// Make M0's verification fail
			verifier.failQueue.push(true);
			const resume = makeResumeController();

			const promise = collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
			}));

			// Wait for the verification-failure pause
			const start = Date.now();
			while (resume.pauseCount === 0 && Date.now() - start < 2000) {
				await new Promise(r => setTimeout(r, 10));
			}
			assert.strictEqual(resume.pauseCount, 1, 'Should pause after verification failure');

			// Verify an error event was fired with recoverable=true
			// (we can't easily check events mid-stream, so resume and check after)
			resume.resume();

			const events = await promise;

			// Should have an error event from the verification failure
			const errors = events.filter(e => e.type === 'error');
			assert.ok(errors.length > 0, 'Should fire an error event for verification failure');
			assert.ok(errors.some(e => e.text.includes('Verification Failed')), `Error should mention verification failure, got: ${errors.map(e => e.text).join('; ')}`);

			// Should still complete both milestones (after resume)
			const completed = events.filter(e => e.type === 'milestone_completed');
			assert.strictEqual(completed.length, 2, 'Both milestones should complete after resume');
		});
	});

	describe('abort during pause', () => {

		it('returns without firing milestone_completed when aborted during a pause', async () => {
			const plan = makePlan({
				steps: [makeStep(0, 'Read', 'a'), makeStep(1, 'Create', 'b')],
				milestones: [
					makeMilestone(0, 'M0', [0]),
					makeMilestone(1, 'M1', [1]),
				],
				executionMode: 'pause_at_every',
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			const resume = makeResumeController();

			const abortController = new AbortController();

			const promise = collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
				signal: abortController.signal,
			}));

			// Wait for first pause
			const start = Date.now();
			while (resume.pauseCount === 0 && Date.now() - start < 2000) {
				await new Promise(r => setTimeout(r, 10));
			}

			// Abort instead of resuming
			abortController.abort();
			resume.resume();  // unblock the promise so it can check signal.aborted

			const events = await promise;

			// M0 should have completed (it finished before the pause)
			// M1 should NOT have completed (aborted during M0's pause)
			const completed = events.filter(e => e.type === 'milestone_completed');
			assert.strictEqual(completed.length, 1, 'Only M0 should complete (aborted before M1)');
			assert.strictEqual((completed[0] as any).milestone.id, 'milestone-0');

			// Should have fired an abort error
			const abortError = events.find(e => e.type === 'error' && e.text.includes('STOP'));
			assert.ok(abortError, 'Should fire a STOP error');

			// Should NOT have fired a final 'complete' event
			const complete = events.find(e => e.type === 'complete');
			assert.ok(!complete, 'Should NOT fire complete after abort');
		});
	});

	describe('empty milestone (no selected steps)', () => {

		it('fires milestone_reached + milestone_completed without calling executeSubTask', async () => {
			const plan = makePlan({
				steps: [
					makeStep(0, 'Read', 'a', false),  // deselected
					makeStep(1, 'Create', 'b', true),
				],
				milestones: [
					makeMilestone(0, 'M0-empty', [0]),  // step 0 is deselected
					makeMilestone(1, 'M1', [1]),
				],
				executionMode: 'auto',
			});

			const executor = makeStubExecutor();
			const verifier = makeStubVerifier();
			const resume = makeResumeController();

			const events = await collectEvents(executeMilestonesWithPauses({
				approvedPlan: plan,
				executeSubTask: executor.fn,
				runVerification: verifier.fn,
				awaitResume: resume.fn,
			}));

			// executeSubTask should be called only for M1 (M0 had no selected steps)
			assert.strictEqual(executor.calls.length, 1, 'Only M1 should execute (M0 had no selected steps)');

			// Both milestones should fire reached + completed
			const reached = events.filter(e => e.type === 'milestone_reached');
			const completed = events.filter(e => e.type === 'milestone_completed');
			assert.strictEqual(reached.length, 2);
			assert.strictEqual(completed.length, 2);

			// M0 should still fire milestone_completed (it was "completed" by skipping)
			assert.ok(completed.some(e => (e as any).milestone.id === 'milestone-0'));
		});
	});
});
