// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 2, item 2.3 — Composer multi-file review panel (architecture stub).
 *
 *  Cursor's Composer is a multi-file editing surface where the agent can
 *  propose changes across many files simultaneously, with a unified review
 *  and accept-all/reject-all flow. KOVIX has the underlying primitives
 *  (PendingChangesService stages proposed edits, DiffApplierService applies
 *  them) but no UI surface.
 *
 *  This file defines the pure-logic types and helpers for the Composer
 *  review panel. The actual UI integration is left as future work.
 *
 *  Audit doc §7.2: 'Pending changes across files shown in unified review
 *  panel; accept-all/reject-all per file or globally.'
 *
 *  STATUS: Architecture stub.
 *  Estimated effort to complete: 6-8 days (audit doc §7.2)
 *--------------------------------------------------------------------------------------------*/

/**
 * A single file change pending review in the Composer.
 */
export interface IComposerFileChange {
	/** Workspace-relative file path */
	filePath: string;
	/** Original file content (before the proposed change) */
	originalContent: string;
	/** Proposed new content */
	proposedContent: string;
	/** Whether this is a new file creation (originalContent is empty) */
	isNewFile: boolean;
	/** Whether this is a file deletion (proposedContent is empty) */
	isDeletion: boolean;
	/** Number of lines added */
	linesAdded: number;
	/** Number of lines removed */
	linesRemoved: number;
	/** Review state */
	reviewState: 'pending' | 'accepted' | 'rejected';
	/** ISO 8601 timestamp when the change was proposed */
	proposedAt: string;
}

/**
 * A group of file changes from a single agent task.
 */
export interface IComposerChangeSet {
	/** Unique change set ID */
	id: string;
	/** Agent task description that produced these changes */
	description: string;
	/** All file changes in the set */
	changes: IComposerFileChange[];
	/** ISO 8601 timestamp */
	createdAt: string;
}

/**
 * Summary statistics for a change set.
 */
export interface IComposerChangeSetSummary {
	totalFiles: number;
	pendingFiles: number;
	acceptedFiles: number;
	rejectedFiles: number;
	totalLinesAdded: number;
	totalLinesRemoved: number;
	newFiles: number;
	deletions: number;
}

/**
 * Compute summary statistics for a change set.
 *
 * Exported for unit testing.
 */
export function computeChangeSetSummary(changeSet: IComposerChangeSet): IComposerChangeSetSummary {
	let pending = 0, accepted = 0, rejected = 0;
	let linesAdded = 0, linesRemoved = 0;
	let newFiles = 0, deletions = 0;
	for (const change of changeSet.changes) {
		switch (change.reviewState) {
			case 'pending': pending++; break;
			case 'accepted': accepted++; break;
			case 'rejected': rejected++; break;
		}
		linesAdded += change.linesAdded;
		linesRemoved += change.linesRemoved;
		if (change.isNewFile) { newFiles++; }
		if (change.isDeletion) { deletions++; }
	}
	return {
		totalFiles: changeSet.changes.length,
		pendingFiles: pending,
		acceptedFiles: accepted,
		rejectedFiles: rejected,
		totalLinesAdded: linesAdded,
		totalLinesRemoved: linesRemoved,
		newFiles,
		deletions,
	};
}

/**
 * Apply a review decision to a single file in the change set.
 * Returns a new change set with the updated state (immutable).
 *
 * Exported for unit testing.
 */
export function applyReviewDecision(
	changeSet: IComposerChangeSet,
	filePath: string,
	decision: 'accepted' | 'rejected'
): IComposerChangeSet {
	return {
		...changeSet,
		changes: changeSet.changes.map(c =>
			c.filePath === filePath ? { ...c, reviewState: decision } : c
		),
	};
}

/**
 * Apply a review decision to all pending files in the change set.
 *
 * Exported for unit testing.
 */
export function applyBulkDecision(
	changeSet: IComposerChangeSet,
	decision: 'accepted' | 'rejected'
): IComposerChangeSet {
	return {
		...changeSet,
		changes: changeSet.changes.map(c =>
			c.reviewState === 'pending' ? { ...c, reviewState: decision } : c
		),
	};
}

/**
 * Format a change set summary for display in the UI.
 *
 * Exported for unit testing.
 */
export function formatChangeSetSummary(summary: IComposerChangeSetSummary): string {
	const parts: string[] = [`${summary.totalFiles} files`];
	if (summary.pendingFiles > 0) { parts.push(`${summary.pendingFiles} pending`); }
	if (summary.acceptedFiles > 0) { parts.push(`${summary.acceptedFiles} accepted`); }
	if (summary.rejectedFiles > 0) { parts.push(`${summary.rejectedFiles} rejected`); }
	if (summary.newFiles > 0) { parts.push(`${summary.newFiles} new`); }
	if (summary.deletions > 0) { parts.push(`${summary.deletions} deletions`); }
	parts.push(`+${summary.totalLinesAdded}/-${summary.totalLinesRemoved} lines`);
	return parts.join(', ');
}

/**
 * Sort changes by file path for stable display.
 *
 * Exported for unit testing.
 */
export function sortChangesByPath(changes: IComposerFileChange[]): IComposerFileChange[] {
	return [...changes].sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/**
 * Filter changes by review state.
 *
 * Exported for unit testing.
 */
export function filterChangesByState(
	changes: IComposerFileChange[],
	state: 'pending' | 'accepted' | 'rejected' | 'all'
): IComposerFileChange[] {
	if (state === 'all') { return changes; }
	return changes.filter(c => c.reviewState === state);
}
