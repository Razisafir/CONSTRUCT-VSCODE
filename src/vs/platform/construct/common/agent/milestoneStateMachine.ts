// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Execution state for the milestone-based agent loop.
 */
export enum ExecutionState {
        Idle = 'idle',
        Planning = 'planning',
        Refining = 'refining',
        AwaitingApproval = 'awaiting_approval',
        Executing = 'executing',
        PausedAtMilestone = 'paused_at_milestone',
        Complete = 'complete',
        Error = 'error',
        Aborted = 'aborted',
}

/**
 * A milestone in the execution plan.
 * Milestones are natural stopping points where the agent can pause
 * for user review before continuing.
 */
export interface IMilestone {
        /** Unique identifier. */
        readonly id: string;
        /** Display name. */
        readonly name: string;
        /** Description of what this milestone accomplishes. */
        readonly description: string;
        /** Index in the plan (0-based). */
        readonly index: number;
        /** Whether this milestone is a major one (e.g., core feature complete). */
        readonly isMajor: boolean;
        /** Plan step indices included in this milestone. */
        readonly stepIndices: number[];
        /** Whether this milestone has been completed. */
        readonly completed: boolean;
}

/**
 * State machine for milestone tracking.
 */
export interface MilestoneState {
        /** Current execution state. */
        readonly state: ExecutionState;
        /** All milestones in the plan. */
        readonly milestones: IMilestone[];
        /** Index of the current milestone being executed. */
        readonly currentMilestoneIndex: number;
        /** IDs of completed milestones. */
        readonly completedMilestoneIds: string[];
}

/**
 * A selectable plan step (for task deselection).
 */
export interface ISelectablePlanStep {
        /** Step index. */
        readonly index: number;
        /** Step action. */
        readonly action: 'Read' | 'Create' | 'Edit' | 'Run';
        /** Step target. */
        readonly target: string;
        /** Step description. */
        readonly description: string;
        /** Whether this step is selected for execution. */
        selected: boolean;
}

/**
 * An approved plan with optional step deselection and execution mode.
 */
export interface IApprovedPlan {
        /** The task description. */
        readonly task: string;
        /** Steps with selection state. */
        readonly steps: ISelectablePlanStep[];
        /** Selected execution mode. */
        readonly executionMode: string;
        /** Milestones extracted from the plan. */
        readonly milestones: IMilestone[];
        /** Whether the plan was approved by the user. */
        readonly approved: boolean;
        /** Timestamp of approval. */
        readonly approvedAt: number;
}
