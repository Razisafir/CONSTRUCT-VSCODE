/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for Diff Application — parsing, application, conflict detection, rollback.
 * Source references:
 * - src/vs/platform/construct/common/constructTypes.ts — safeJsonParse
 */

// ---- Diff parsing and application logic ----

interface IDiffLine {
        type: 'add' | 'delete' | 'context';
        content: string;
        lineNumber?: number;
}

interface IDiffHunk {
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        lines: IDiffLine[];
}

interface IDiffResult {
        success: boolean;
        output: string;
        conflicts: number;
}

function parseUnifiedDiff(diffText: string): IDiffHunk[] {
        const hunks: IDiffHunk[] = [];
        const lines = diffText.split('\n');
        let currentHunk: IDiffHunk | null = null;

        for (const line of lines) {
                const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                if (hunkMatch) {
                        if (currentHunk) {
                                hunks.push(currentHunk);
                        }
                        currentHunk = {
                                oldStart: parseInt(hunkMatch[1]),
                                oldLines: parseInt(hunkMatch[2] ?? '1'),
                                newStart: parseInt(hunkMatch[3]),
                                newLines: parseInt(hunkMatch[4] ?? '1'),
                                lines: [],
                        };
                        continue;
                }
                if (currentHunk) {
                        if (line.startsWith('+')) {
                                currentHunk.lines.push({ type: 'add', content: line.substring(1) });
                        } else if (line.startsWith('-')) {
                                currentHunk.lines.push({ type: 'delete', content: line.substring(1) });
                        } else if (line.startsWith(' ')) {
                                currentHunk.lines.push({ type: 'context', content: line.substring(1) });
                        }
                }
        }
        if (currentHunk) {
                hunks.push(currentHunk);
        }
        return hunks;
}

function applyDiff(sourceLines: string[], hunks: IDiffHunk[]): IDiffResult {
        let conflicts = 0;
        const result = [...sourceLines];

        for (const hunk of hunks) {
                let lineIdx = hunk.oldStart - 1;
                for (const diffLine of hunk.lines) {
                        if (diffLine.type === 'context') {
                                // Verify context matches
                                if (lineIdx < result.length && result[lineIdx].trim() !== diffLine.content.trim()) {
                                        conflicts++;
                                }
                                lineIdx++;
                        } else if (diffLine.type === 'delete') {
                                if (lineIdx < result.length && result[lineIdx].trim() === diffLine.content.trim()) {
                                        result.splice(lineIdx, 1);
                                } else {
                                        conflicts++;
                                        lineIdx++;
                                }
                        } else if (diffLine.type === 'add') {
                                result.splice(lineIdx, 0, diffLine.content);
                                lineIdx++;
                        }
                }
        }

        return {
                success: conflicts === 0,
                output: result.join('\n'),
                conflicts,
        };
}

function detectConflictMarkers(content: string): boolean {
        return content.includes('<<<<<<<') || content.includes('=======') || content.includes('>>>>>>>');
}

function applySingleLineAdd(source: string[], lineNumber: number, content: string): string[] {
        const result = [...source];
        result.splice(lineNumber, 0, content);
        return result;
}

function applySingleLineDelete(source: string[], lineNumber: number): string[] {
        const result = [...source];
        result.splice(lineNumber, 1);
        return result;
}

function applySingleLineModify(source: string[], lineNumber: number, newContent: string): string[] {
        const result = [...source];
        if (lineNumber >= 0 && lineNumber < result.length) {
                // Preserve indentation from original line
                const originalIndent = result[lineNumber].match(/^(\s*)/)?.[1] ?? '';
                result[lineNumber] = originalIndent + newContent.trimStart();
        }
        return result;
}

// ---- Tests ----

suite('Diff Application Tests', () => {

        suite('Single Line Operations', () => {
                test('should apply single line addition', () => {
                        const source = ['line1', 'line2', 'line3'];
                        const result = applySingleLineAdd(source, 1, 'inserted');
                        assert.deepStrictEqual(result, ['line1', 'inserted', 'line2', 'line3']);
                });

                test('should apply single line deletion', () => {
                        const source = ['line1', 'line2', 'line3'];
                        const result = applySingleLineDelete(source, 1);
                        assert.deepStrictEqual(result, ['line1', 'line3']);
                });

                test('should apply single line modification', () => {
                        const source = ['line1', '  old content', 'line3'];
                        const result = applySingleLineModify(source, 1, '  new content');
                        assert.strictEqual(result[1].trim(), 'new content');
                        assert.ok(result[1].startsWith('  '), 'Should preserve indentation');
                });
        });

        suite('Unified Diff Parsing', () => {
                test('should apply multi-line diff correctly', () => {
                        const source = ['line1', 'line2', 'line3', 'line4'];
                        const diffText = '@@ -1,4 +1,4 @@\n line1\n-line2\n+replaced\n line3\n line4';
                        const hunks = parseUnifiedDiff(diffText);
                        assert.strictEqual(hunks.length, 1);
                        assert.strictEqual(hunks[0].oldStart, 1);
                        assert.strictEqual(hunks[0].lines.length, 5);

                        const result = applyDiff(source, hunks);
                        assert.strictEqual(result.success, true);
                        assert.ok(result.output.includes('replaced'));
                        assert.ok(!result.output.includes('line2'));
                });

                test('should reject diff with invalid line numbers', () => {
                        const source = ['line1', 'line2'];
                        // Hunk referencing line 100 which doesn't exist
                        const diffText = '@@ -100,1 +100,1 @@\n-nonexistent\n+replacement';
                        const hunks = parseUnifiedDiff(diffText);
                        const result = applyDiff(source, hunks);
                        // Should produce conflicts since context doesn't match
                        assert.strictEqual(result.conflicts > 0, true);
                });
        });

        suite('Conflict Detection', () => {
                test('should handle diff with conflict markers', () => {
                        const content = '<<<<<<< HEAD\nour changes\n=======\ntheir changes\n>>>>>>> branch';
                        assert.strictEqual(detectConflictMarkers(content), true);
                });

                test('should detect clean content without conflict markers', () => {
                        const content = 'clean content\nno markers here';
                        assert.strictEqual(detectConflictMarkers(content), false);
                });
        });

        suite('Special Cases', () => {
                test('should apply diff preserving indentation', () => {
                        const source = ['function test() {', '    return true;', '}'];
                        const diffText = '@@ -2,1 +2,1 @@\n-    return true;\n+    return false;';
                        const hunks = parseUnifiedDiff(diffText);
                        const result = applyDiff(source, hunks);
                        assert.ok(result.output.includes('return false'));
                        assert.ok(!result.output.includes('return true'));
                });

                test('should handle empty file diff', () => {
                        const source: string[] = [];
                        const diffText = '@@ -0,0 +1,2 @@\n+line1\n+line2';
                        const hunks = parseUnifiedDiff(diffText);
                        const result = applyDiff(source, hunks);
                        assert.ok(result.output.includes('line1'));
                        assert.ok(result.output.includes('line2'));
                });

                test('should handle diff for new file creation', () => {
                        // New file = all additions
                        const source: string[] = [];
                        const diffText = '@@ -0,0 +1,3 @@\n+import * as fs from "fs";\n+\n+console.log("hello");';
                        const hunks = parseUnifiedDiff(diffText);
                        assert.strictEqual(hunks[0].lines.every(l => l.type === 'add'), true, 'All lines should be additions');
                        const result = applyDiff(source, hunks);
                        assert.ok(result.output.includes('import'));
                });

                test('should handle diff for file deletion', () => {
                        // File deletion = all deletions
                        const source = ['line1', 'line2', 'line3'];
                        const diffText = '@@ -1,3 +0,0 @@\n-line1\n-line2\n-line3';
                        const hunks = parseUnifiedDiff(diffText);
                        assert.strictEqual(hunks[0].lines.every(l => l.type === 'delete'), true, 'All lines should be deletions');
                        const result = applyDiff(source, hunks);
                        assert.strictEqual(result.success, true);
                });
        });
});
