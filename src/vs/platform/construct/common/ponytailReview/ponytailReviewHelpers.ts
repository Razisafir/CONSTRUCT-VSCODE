// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 2, item 2.5 — Ponytail dedicated review panel helpers.
 *
 *  Pure-logic helpers for the Ponytail code review panel. Ponytail tags code
 *  with `delete:`, `stdlib:`, `native:`, `yagni:`, `shrink:` markers.
 *
 *  STATUS: Architecture stub.
 *  Estimated effort to complete: 3-5 days
 *--------------------------------------------------------------------------------------------*/

export type PonytailTag = 'delete' | 'stdlib' | 'native' | 'yagni' | 'shrink';

export const ALL_PONYTAIL_TAGS: readonly PonytailTag[] = ['delete', 'stdlib', 'native', 'yagni', 'shrink'];

export type PonytailSeverity = 'info' | 'warning' | 'error';

export interface IPonytailFinding {
	tag: PonytailTag;
	severity: PonytailSeverity;
	filePath: string;
	lineNumber: number;
	column?: number;
	endLine?: number;
	codeSnippet: string;
	message: string;
	suggestion?: string;
}

export interface IPonytailReview {
	filePaths: string[];
	findings: IPonytailFinding[];
	mode: 'lite' | 'full' | 'ultra' | 'off';
	reviewedAt: string;
	summary: IPonytailReviewSummary;
}

export interface IPonytailReviewSummary {
	totalFindings: number;
	byTag: Record<PonytailTag, number>;
	bySeverity: Record<PonytailSeverity, number>;
	filesWithFindings: number;
	linesAnalyzed: number;
}

export function parsePonytailTag(comment: string): { tag: PonytailTag; message: string } | null {
	const match = comment.match(/^\s*(?:\/\/|#|\/\*)\s*(delete|stdlib|native|yagni|shrink)\s*:\s*(.+?)\s*(?:\*\/)?$/i);
	if (!match) { return null; }
	return { tag: match[1]!.toLowerCase() as PonytailTag, message: match[2]! };
}

export function severityForTag(tag: PonytailTag, mode: 'lite' | 'full' | 'ultra'): PonytailSeverity {
	if (mode === 'lite') { return tag === 'delete' ? 'error' : 'info'; }
	if (mode === 'full') {
		if (tag === 'delete') { return 'error'; }
		if (tag === 'yagni') { return 'warning'; }
		return 'info';
	}
	if (tag === 'delete') { return 'error'; }
	if (tag === 'yagni' || tag === 'shrink') { return 'warning'; }
	return 'info';
}

export function computeReviewSummary(
	findings: IPonytailFinding[],
	filePaths: string[],
	linesAnalyzed: number,
	mode: 'lite' | 'full' | 'ultra' | 'off'
): IPonytailReviewSummary {
	const byTag: Record<PonytailTag, number> = { delete: 0, stdlib: 0, native: 0, yagni: 0, shrink: 0 };
	const bySeverity: Record<PonytailSeverity, number> = { info: 0, warning: 0, error: 0 };
	const filesWithFindingsSet = new Set<string>();
	for (const finding of findings) {
		byTag[finding.tag]++;
		bySeverity[finding.severity]++;
		filesWithFindingsSet.add(finding.filePath);
	}
	return {
		totalFindings: findings.length,
		byTag,
		bySeverity,
		filesWithFindings: filesWithFindingsSet.size,
		linesAnalyzed,
	};
}

export function formatFinding(finding: IPonytailFinding): string {
	const location = `${finding.filePath}:${finding.lineNumber}`;
	const suggestion = finding.suggestion ? ` -> ${finding.suggestion}` : '';
	return `[${finding.tag}] ${location} - ${finding.message}${suggestion}`;
}

export function formatReviewSummary(summary: IPonytailReviewSummary): string {
	const parts: string[] = [`${summary.totalFindings} findings`];
	if (summary.byTag.delete > 0) { parts.push(`${summary.byTag.delete} delete`); }
	if (summary.byTag.yagni > 0) { parts.push(`${summary.byTag.yagni} yagni`); }
	if (summary.byTag.shrink > 0) { parts.push(`${summary.byTag.shrink} shrink`); }
	if (summary.byTag.stdlib > 0) { parts.push(`${summary.byTag.stdlib} stdlib`); }
	if (summary.byTag.native > 0) { parts.push(`${summary.byTag.native} native`); }
	parts.push(`across ${summary.filesWithFindings} files`);
	parts.push(`(${summary.linesAnalyzed} lines analyzed)`);
	return parts.join(', ');
}

export function filterFindingsByTag(findings: IPonytailFinding[], tag: PonytailTag | 'all'): IPonytailFinding[] {
	if (tag === 'all') { return findings; }
	return findings.filter(f => f.tag === tag);
}

export function filterFindingsByFile(findings: IPonytailFinding[], filePath: string): IPonytailFinding[] {
	return findings.filter(f => f.filePath === filePath);
}
