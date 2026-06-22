/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * Execution state for the milestone-based agent loop.
 */
export enum ExecutionState {
        Idle = 'idle',
        Planning = 'planning',
        AwaitingApproval = 'awaiting_approval',
        Executing = 'executing',
        /**
         * Verifying — the agent has declared the milestone complete, but the
         * harness is now running a real check (test script / build / typecheck)
         * to confirm. The loop MUST pass through this state before reaching
         * PausedAtMilestone or Complete. See agentLoop.ts runVerification().
         *
         * Unlike Executing, this state is harness-controlled, not LLM-controlled:
         * the agent cannot self-report its way out of it.
         */
        Verifying = 'verifying',
        PausedAtMilestone = 'paused_at_milestone',
        Complete = 'complete',
        /**
         * VerificationFailed — the harness's real check returned a non-zero
         * exit code. Routes into AgentErrorRecoveryService as a first-class
         * error type ('verification_failed'), not silently swallowed.
         */
        VerificationFailed = 'verification_failed',
        Error = 'error',
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
        /**
         * IDs of milestones the user selected to pause at (Selective mode only).
         * Fix for F-007 (#77): previously the picker discarded this selection.
         * Undefined means "use default pause behavior for the chosen mode".
         */
        readonly selectedMilestoneIds?: string[];
        /** Whether the plan was approved by the user. */
        readonly approved: boolean;
        /** Timestamp of approval. */
        readonly approvedAt: number;
}
