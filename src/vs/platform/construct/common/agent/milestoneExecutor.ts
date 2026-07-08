/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * milestoneExecutor -- Phase 5.5 (Fix 1) extracted helper.
 *
 * The milestone-iteration + pause/resume logic for runWithApprovedPlan(),
 * extracted as a pure-ish generator function that takes its collaborators
 * as parameters. This makes the core feature testable without instantiating
 * AgentLoopService (which has 22 injected dependencies).
 *
 * The helper takes:
 *   - approvedPlan: the user-approved plan with milestones, steps, pause mode
 *   - executeSubTask: a caller-provided async generator that runs ONE
 *     milestone's worth of LLM + tool work. In production this is
 *     AgentLoopService._executeRounds(); in tests it's a stub that yields
 *     controlled events.
 *   - runVerification: a caller-provided async generator that runs the
 *     harness verification check. In production this is
 *     AgentLoopService.runVerification(); in tests it's a stub.
 *   - awaitResume: a caller-provided async function that resolves when the
 *     user calls resumeFromMilestone() or skipCurrentMilestone(). In
 *     production this awaits the _milestoneResumeResolver promise; in tests
 *     it can be a controllable promise.
 *   - signal: optional AbortSignal.
 *
 * The helper yields the same AgentLoopEvent types that runWithApprovedPlan()
 * yields, including the four milestone events (milestone_reached, milestone_paused,
 * milestone_resumed, milestone_completed) that were previously declared but
 * never emitted.
 *
 * The helper does NOT do: snapshot creation, file watcher start, memory
 * storage, _isRunning toggling, or _executionState management beyond
 * PausedAtMilestone. Those remain the caller's responsibility.
 *
 * Pause rules:
 *   - "pause_at_every" mode: pause at every milestone (after verification)
 *   - "selective" mode: pause only at milestones in selectedMilestoneIds
 *   - "auto" / undefined: no user-selected pauses
 *   - Verification failure ALWAYS triggers a pause (regardless of mode) so
 *     the user can fix the issue and then resume to continue.
 */

import { IApprovedPlan, IMilestone } from './milestoneStateMachine.js';
import { AgentLoopEvent } from './agentLoop.js';

/**
 * Caller-provided function that runs ONE milestone's worth of work.
 * Must yield AgentLoopEvents for real-time UI updates.
 * Should return (stop yielding) when the sub-task is done or aborted.
 */
export type ExecuteSubTaskFn = (
	subTask: string,
	signal?: AbortSignal,
) => AsyncGenerator<AgentLoopEvent>;

/**
 * Caller-provided function that runs the harness verification check
 * for a completed milestone. Must yield verification_start +
 * verification_result events.
 */
export type RunVerificationFn = (
	signal?: AbortSignal,
) => AsyncGenerator<AgentLoopEvent>;

/**
 * Caller-provided function that resolves when the user calls
 * resumeFromMilestone() or skipCurrentMilestone(). In production this
 * awaits the _milestoneResumeResolver promise; in tests it can be a
 * controllable promise that the test resolves at the right moment.
 *
 * The function receives the milestone being paused at, in case the caller
 * needs it for logging or state tracking.
 *
 * Return value: 'resume' or 'skip'. The helper branches on this:
 *   - 'resume' -> emits milestone_resumed + milestone_completed (normal)
 *   - 'skip'   -> emits milestone_skipped, does NOT emit milestone_completed,
 *                 and continues to the next milestone. The skipped milestone
 *                 is NOT counted as completed.
 */
export type AwaitResumeFn = (milestone: IMilestone) => Promise<'resume' | 'skip'>;

/**
 * Options for executeMilestonesWithPauses.
 */
export interface IMilestoneExecutorOptions {
	approvedPlan: IApprovedPlan;
	executeSubTask: ExecuteSubTaskFn;
	runVerification: RunVerificationFn;
	awaitResume: AwaitResumeFn;
	signal?: AbortSignal;
	/**
	 * Optional logger. If provided, the helper logs milestone transitions
	 * for debugging. If not provided, logging is silent.
	 */
	log?: (message: string) => void;
}

/**
 * Phase 5.5 (Fix 1) -- iterate milestones with real pause/resume.
 *
 * Yields AgentLoopEvent including milestone_reached, milestone_paused,
 * milestone_resumed, milestone_skipped, milestone_completed, plus any
 * events yielded by executeSubTask and runVerification.
 *
 * Skip semantics (Fix: skip vs resume are now distinct):
 *   - resumeFromMilestone() -> awaitResume returns 'resume' ->
 *     milestone_resumed + milestone_completed fire normally.
 *   - skipCurrentMilestone() -> awaitResume returns 'skip' ->
 *     milestone_skipped fires, milestone_completed does NOT fire, and
 *     the skipped milestone is not counted as completed. The helper
 *     proceeds to the next milestone.
 *
 * Returns (stops yielding) when:
 *   - All milestones are completed (caller should yield 'complete' after)
 *   - signal is aborted
 *   - executeSubTask yields a fatal (recoverable=false) error
 *
 * The caller is responsible for:
 *   - Setting _executionState = Executing before calling
 *   - Setting _executionState = PausedAtMilestone when milestone_paused is yielded
 *   - Setting _executionState = Executing when milestone_resumed is yielded
 *   - Setting _executionState = Complete after the generator returns
 *   - Yielding 'complete' with the aggregated summary
 *   - Managing _isRunning, _activeSnapshotId, _currentMilestone, etc.
 */
export async function* executeMilestonesWithPauses(
	options: IMilestoneExecutorOptions,
): AsyncGenerator<AgentLoopEvent> {
	const { approvedPlan, executeSubTask, runVerification, awaitResume, signal, log } = options;

	// Determine which milestones to pause at.
	const pauseMode = approvedPlan.executionMode ?? 'auto';
	const pauseAtEvery = pauseMode === 'pause_at_every';
	const selectedPauseIds = new Set(approvedPlan.selectedMilestoneIds ?? []);

	const shouldPauseAt = (milestone: IMilestone): boolean => {
		if (pauseAtEvery) { return true; }
		if (pauseMode === 'selective' && selectedPauseIds.has(milestone.id)) { return true; }
		return false;
	};

	let aggregatedSummary = '';

	for (let mi = 0; mi < approvedPlan.milestones.length; mi++) {
		const milestone = approvedPlan.milestones[mi];

		// User-abort check between milestones
		if (signal?.aborted) {
			yield { type: 'error', text: '[STOP] Stopped by user', recoverable: false };
			return;
		}

		// 1. Fire milestone_reached
		log?.(`[MilestoneExecutor] Milestone ${mi + 1}/${approvedPlan.milestones.length} reached: ${milestone.name}`);
		yield { type: 'milestone_reached', milestone };

		// 2. Build sub-task string from this milestone's selected steps
		const milestoneStepIndices = new Set(milestone.stepIndices);
		const milestoneSteps = approvedPlan.steps
			.filter((s, idx) => s.selected && milestoneStepIndices.has(idx));

		if (milestoneSteps.length === 0) {
			// No selected steps in this milestone -- skip it but still fire events
			log?.(`[MilestoneExecutor] Milestone ${milestone.name} has no selected steps, skipping`);
			aggregatedSummary += `\n[Milestone ${milestone.name}: no selected steps]\n`;
		} else {
			const stepList = milestoneSteps.map(s => `${s.action}: ${s.target}`).join('\n');
			const subTask = `${approvedPlan.task}\n\nMilestone ${mi + 1}: ${milestone.name}\nExecute these specific steps:\n${stepList}`;

			// 3. Run the LLM + tool loop for this milestone's sub-task
			let milestoneSummary = '';
			for await (const event of executeSubTask(subTask, signal)) {
				yield event;
				if (event.type === 'token') {
					milestoneSummary += event.text;
				} else if (event.type === 'error' && !event.recoverable) {
					// Fatal error during the round -- abort the whole plan
					return;
				}
			}

			aggregatedSummary += `\n[Milestone ${milestone.name}]\n${milestoneSummary}`;

			// 4. Run verification for this milestone
			let verificationFailed = false;
			for await (const vEvent of runVerification(signal)) {
				yield vEvent;
				if (vEvent.type === 'verification_result' && !vEvent.passed) {
					verificationFailed = true;
					log?.(`[MilestoneExecutor] Milestone ${milestone.name} verification failed`);
					yield {
						type: 'error',
						text: `[Verification Failed] Milestone '${milestone.name}' declared complete, but the harness check returned non-zero.\n${vEvent.output.substring(0, 800)}`,
						recoverable: true,
					};
				}
			}

			// 5. Pause if verification failed OR user selected pause-here
			const mustPause = verificationFailed || shouldPauseAt(milestone);
			if (mustPause) {
				log?.(`[MilestoneExecutor] Paused at milestone: ${milestone.name} (verificationFailed=${verificationFailed})`);
				yield { type: 'milestone_paused', milestone };

				// Await the user's resume/skip action. The return value
				// distinguishes the two paths: 'resume' marks the milestone as
				// completed-and-verified; 'skip' marks it as skipped (NOT
				// completed) and proceeds to the next milestone.
				const resumeAction = await awaitResume(milestone);

				// Re-check abort after resume
				if (signal?.aborted) {
					yield { type: 'error', text: '[STOP] Stopped by user during milestone pause', recoverable: false };
					return;
				}

				if (resumeAction === 'skip') {
					// User chose to skip this milestone. Mark it as skipped
					// (NOT completed), log it clearly so downstream memory /
					// verification correctly reflects it wasn't actually done,
					// and proceed to the next milestone WITHOUT firing
					// milestone_completed.
					log?.(`[MilestoneExecutor] Milestone ${milestone.name} SKIPPED by user (not completed)`);
					aggregatedSummary += `\n[Milestone ${milestone.name}: SKIPPED by user -- not completed]\n`;
					yield { type: 'milestone_skipped', milestone };
					continue;
				}

				yield { type: 'milestone_resumed', milestone };
			}
		}

		// 6. Fire milestone_completed (only for the resume path; skip
		//    path continues past this via the `continue` above).
		yield { type: 'milestone_completed', milestone };
		log?.(`[MilestoneExecutor] Milestone ${milestone.name} completed`);
	}

	// Yield a final 'complete' event with the aggregated summary.
	// The caller may choose to suppress this and yield its own 'complete'
	// after doing memory storage / conversation history updates.
	yield { type: 'complete', summary: aggregatedSummary || 'Task completed.' };
}
