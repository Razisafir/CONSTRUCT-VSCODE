// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 2, item 2.2 — Background agent scheduler (architecture stub).
 *
 *  This file defines the interfaces and pure-logic helpers for a background
 *  agent scheduler that allows users to spawn up to N parallel agents that
 *  run asynchronously while the user continues editing in the foreground.
 *
 *  Audit doc §7.2: 'User can spawn up to 3 parallel agents; each runs in
 *  background; UI shows status; file conflicts block with prompt.'
 *
 *  STATUS: Architecture stub. The scheduler interface, conflict detection,
 *  and state machine are defined here. The concrete scheduler implementation
 *  that wires into AgentLoopService is left as future work because it
 *  requires deep changes to the agent loop (which currently runs
 *  synchronously in the foreground).
 *
 *  Estimated effort to complete: 10-15 days (audit doc §7.2)
 *--------------------------------------------------------------------------------------------*/

/**
 * States a background agent can be in.
 */
export type BackgroundAgentState =
	| 'queued'        // Waiting for a free slot
	| 'running'       // Actively executing
	| 'paused'        // User paused (e.g. file conflict)
	| 'completed'     // Finished successfully
	| 'failed'        // Finished with error
	| 'cancelled';    // User cancelled

/**
 * A background agent task.
 */
export interface IBackgroundAgentTask {
	/** Unique task ID */
	id: string;
	/** User-provided description of what the agent should do */
	description: string;
	/** Current state */
	state: BackgroundAgentState;
	/** ISO 8601 timestamp when the task was created */
	createdAt: string;
	/** ISO 8601 timestamp when the task started running (if it has) */
	startedAt?: string;
	/** ISO 8601 timestamp when the task reached a terminal state */
	completedAt?: string;
	/** Files the task is currently modifying (for conflict detection) */
	lockedFiles: string[];
	/** Progress percentage (0-100) */
	progress: number;
	/** Last status message from the agent */
	statusMessage?: string;
	/** Error message if state is 'failed' */
	error?: string;
	/** Number of agent rounds completed so far */
	roundsCompleted: number;
	/** Maximum rounds allowed */
	maxRounds: number;
}

/**
 * Configuration for the background agent scheduler.
 */
export interface IBackgroundAgentConfig {
	/** Maximum number of agents that can run concurrently. Default: 3. */
	maxConcurrent: number;
	/** Whether new tasks are allowed. Set to false during shutdown. */
	acceptNewTasks: boolean;
	/** Default max rounds for background tasks (lower than foreground to bound cost). */
	defaultMaxRounds: number;
}

export const DEFAULT_BACKGROUND_AGENT_CONFIG: IBackgroundAgentConfig = {
	maxConcurrent: 3,
	acceptNewTasks: true,
	defaultMaxRounds: 30,
};

/**
 * Result of attempting to schedule a new background task.
 */
export interface IScheduleResult {
	/** Whether the task was successfully scheduled */
	success: boolean;
	/** The task ID if successful */
	taskId?: string;
	/** Error message if unsuccessful */
	error?: string;
	/** Queue position if queued (1 = next) */
	queuePosition?: number;
}

/**
 * Detect file conflicts between a new task's intended files and currently
 * running tasks' locked files.
 *
 * Exported for unit testing.
 */
export function detectFileConflicts(
	newTaskFiles: string[],
	runningTasks: IBackgroundAgentTask[]
): string[] {
	const conflicts: string[] = [];
	const lockedByRunning = new Set<string>();
	for (const task of runningTasks) {
		if (task.state === 'running' || task.state === 'paused') {
			for (const f of task.lockedFiles) {
				lockedByRunning.add(f);
			}
		}
	}
	for (const f of newTaskFiles) {
		if (lockedByRunning.has(f)) {
			conflicts.push(f);
		}
	}
	return conflicts;
}

/**
 * Decide whether a new task can be started immediately or must be queued.
 *
 * Exported for unit testing.
 */
export function canStartImmediately(
	config: IBackgroundAgentConfig,
	runningTasks: IBackgroundAgentTask[]
): boolean {
	const runningCount = runningTasks.filter(
		t => t.state === 'running' || t.state === 'paused'
	).length;
	return runningCount < config.maxConcurrent;
}

/**
 * Compute the queue position for a new task (1 = next to run).
 *
 * Exported for unit testing.
 */
export function computeQueuePosition(
	queuedTasks: IBackgroundAgentTask[]
): number {
	return queuedTasks.filter(t => t.state === 'queued').length + 1;
}

/**
 * Generate a unique task ID.
 *
 * Exported for unit testing.
 */
export function generateTaskId(): string {
	return `bg-task-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Transition a task to a new state, validating the transition is allowed.
 *
 * Exported for unit testing.
 *
 * @returns The new state, or null if the transition is invalid.
 */
export function transitionState(
	currentState: BackgroundAgentState,
	targetState: BackgroundAgentState
): BackgroundAgentState | null {
	const validTransitions: Record<BackgroundAgentState, BackgroundAgentState[]> = {
		queued: ['running', 'cancelled'],
		running: ['paused', 'completed', 'failed', 'cancelled'],
		paused: ['running', 'cancelled'],
		completed: [], // terminal
		failed: [],    // terminal
		cancelled: [], // terminal
	};
	const allowed = validTransitions[currentState];
	if (allowed && allowed.includes(targetState)) {
		return targetState;
	}
	return null;
}

/**
 * Format a task's status for display in the UI.
 *
 * Exported for unit testing.
 */
export function formatTaskStatus(task: IBackgroundAgentTask): string {
	const progress = `${task.progress}%`;
	const rounds = `${task.roundsCompleted}/${task.maxRounds}`;
	switch (task.state) {
		case 'queued':
			return `Queued`;
		case 'running':
			return `Running (${progress}, round ${rounds})${task.statusMessage ? ': ' + task.statusMessage : ''}`;
		case 'paused':
			return `Paused: ${task.statusMessage ?? 'awaiting user input'}`;
		case 'completed':
			return `Completed in ${task.roundsCompleted} rounds`;
		case 'failed':
			return `Failed: ${task.error ?? 'unknown error'}`;
		case 'cancelled':
			return `Cancelled`;
	}
}
