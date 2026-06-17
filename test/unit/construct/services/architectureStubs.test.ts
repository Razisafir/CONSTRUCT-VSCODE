/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Architecture stub tests — verifies that the pure-logic helpers in the
 * Tier 2/3 architecture stubs work correctly. These tests don't exercise
 * the full feature (which requires UI integration) but they ensure the
 * foundational logic is sound.
 */

import * as assert from 'assert';

// Tier 2.4 — Onboarding provider test helpers
import {
	formatProviderTestResult,
	classifyProviderQuality,
	pickBestProvider,
	summarizeProviderTests,
} from '../../../../src/vs/platform/construct/common/onboarding/providerTestHelpers.js';
import type { IProviderTestResult } from '../../../../src/vs/platform/construct/common/onboarding/providerTestHelpers.js';

// Tier 2.2 — Background agent scheduler
import {
	detectFileConflicts,
	canStartImmediately,
	computeQueuePosition,
	generateTaskId,
	transitionState,
	formatTaskStatus,
	DEFAULT_BACKGROUND_AGENT_CONFIG,
} from '../../../../src/vs/platform/construct/common/backgroundAgents/backgroundAgentScheduler.js';
import type { IBackgroundAgentTask, IBackgroundAgentConfig } from '../../../../src/vs/platform/construct/common/backgroundAgents/backgroundAgentScheduler.js';

// Tier 2.3 — Composer review
import {
	computeChangeSetSummary,
	applyReviewDecision,
	applyBulkDecision,
	formatChangeSetSummary,
	sortChangesByPath,
	filterChangesByState,
} from '../../../../src/vs/platform/construct/common/composer/composerReview.js';
import type { IComposerChangeSet, IComposerFileChange } from '../../../../src/vs/platform/construct/common/composer/composerReview.js';

// Tier 2.5 — Ponytail review
import {
	parsePonytailTag,
	severityForTag,
	computeReviewSummary,
	formatFinding,
	formatReviewSummary,
	filterFindingsByTag,
	filterFindingsByFile,
} from '../../../../src/vs/platform/construct/common/ponytailReview/ponytailReviewHelpers.js';
import type { IPonytailFinding } from '../../../../src/vs/platform/construct/common/ponytailReview/ponytailReviewHelpers.js';

// Tier 2.7 — MCP Marketplace
import {
	generateMcpConfig,
	validateEnvVars,
	searchMarketplace,
	filterByCategory,
	sortMarketplaceEntries,
	DEFAULT_MARKETPLACE_CATALOG,
} from '../../../../src/vs/platform/construct/common/mcpMarketplace/mcpMarketplaceHelpers.js';

// Tier 3.6 — Air-gapped installer
import {
	generateInstallScript,
	computeInstallerSizeMb,
	generateManifest,
	DEFAULT_AIRGAP_CONFIG,
} from '../../../../src/vs/platform/construct/common/airgap/airgapInstaller.js';

// Tier 3.7 — Local RAG
import {
	detectDocType,
	shouldIndexFile,
	chunkText,
	computeContentHash,
	estimateTokenCount,
	formatSearchResult,
	sortSearchResults,
	deduplicateResults,
	DEFAULT_LOCAL_RAG_CONFIG,
} from '../../../../src/vs/platform/construct/common/localRag/localRagHelpers.js';
import type { ILocalRagSearchResult } from '../../../../src/vs/platform/construct/common/localRag/localRagHelpers.js';

suite('Architecture Stubs', () => {

	suite('Tier 2.4 — Provider test helpers', () => {

		test('formatProviderTestResult shows success correctly', () => {
			const result: IProviderTestResult = {
				provider: 'ollama', success: true, latencyMs: 150, modelCount: 3,
				timestamp: '2026-06-17T00:00:00.000Z',
			};
			const formatted = formatProviderTestResult(result);
			assert.ok(formatted.includes('ollama'));
			assert.ok(formatted.includes('150ms'));
			assert.ok(formatted.includes('3 models'));
		});

		test('formatProviderTestResult shows error correctly', () => {
			const result: IProviderTestResult = {
				provider: 'cloud', success: false, error: 'Invalid API key',
				timestamp: '2026-06-17T00:00:00.000Z',
			};
			const formatted = formatProviderTestResult(result);
			assert.ok(formatted.includes('cloud'));
			assert.ok(formatted.includes('Invalid API key'));
		});

		test('classifyProviderQuality returns recommended for fast provider', () => {
			const result: IProviderTestResult = {
				provider: 'ollama', success: true, latencyMs: 100,
				timestamp: '2026-06-17T00:00:00.000Z',
			};
			assert.strictEqual(classifyProviderQuality(result), 'recommended');
		});

		test('classifyProviderQuality returns unacceptable for failed provider', () => {
			const result: IProviderTestResult = {
				provider: 'cloud', success: false,
				timestamp: '2026-06-17T00:00:00.000Z',
			};
			assert.strictEqual(classifyProviderQuality(result), 'unacceptable');
		});

		test('pickBestProvider returns the fastest successful provider', () => {
			const results: IProviderTestResult[] = [
				{ provider: 'a', success: false, timestamp: '' },
				{ provider: 'b', success: true, latencyMs: 500, modelCount: 2, timestamp: '' },
				{ provider: 'c', success: true, latencyMs: 100, modelCount: 5, timestamp: '' },
			];
			const best = pickBestProvider(results);
			assert.strictEqual(best?.provider, 'c');
		});

		test('pickBestProvider returns null when all fail', () => {
			const results: IProviderTestResult[] = [
				{ provider: 'a', success: false, timestamp: '' },
				{ provider: 'b', success: false, timestamp: '' },
			];
			assert.strictEqual(pickBestProvider(results), null);
		});

		test('summarizeProviderTests computes correct counts', () => {
			const results: IProviderTestResult[] = [
				{ provider: 'a', success: true, latencyMs: 100, timestamp: '' },
				{ provider: 'b', success: true, latencyMs: 200, timestamp: '' },
				{ provider: 'c', success: false, timestamp: '' },
			];
			const summary = summarizeProviderTests(results);
			assert.strictEqual(summary.total, 3);
			assert.strictEqual(summary.successful, 2);
			assert.strictEqual(summary.failed, 1);
			assert.strictEqual(summary.recommendedCount, 2);
		});
	});

	suite('Tier 2.2 — Background agent scheduler', () => {

		test('detectFileConflicts finds overlapping files', () => {
			const running: IBackgroundAgentTask[] = [{
				id: '1', description: 'task1', state: 'running',
				createdAt: '', lockedFiles: ['src/a.ts', 'src/b.ts'],
				progress: 50, roundsCompleted: 5, maxRounds: 30,
			}];
			const conflicts = detectFileConflicts(['src/a.ts', 'src/c.ts'], running);
			assert.deepStrictEqual(conflicts, ['src/a.ts']);
		});

		test('detectFileConflicts returns empty when no overlap', () => {
			const running: IBackgroundAgentTask[] = [{
				id: '1', description: 'task1', state: 'running',
				createdAt: '', lockedFiles: ['src/a.ts'],
				progress: 50, roundsCompleted: 5, maxRounds: 30,
			}];
			const conflicts = detectFileConflicts(['src/b.ts'], running);
			assert.deepStrictEqual(conflicts, []);
		});

		test('canStartImmediately returns true when under limit', () => {
			const config: IBackgroundAgentConfig = { maxConcurrent: 3, acceptNewTasks: true, defaultMaxRounds: 30 };
			const running: IBackgroundAgentTask[] = [{
				id: '1', description: 't', state: 'running',
				createdAt: '', lockedFiles: [], progress: 50,
				roundsCompleted: 5, maxRounds: 30,
			}];
			assert.ok(canStartImmediately(config, running));
		});

		test('canStartImmediately returns false at limit', () => {
			const config: IBackgroundAgentConfig = { maxConcurrent: 2, acceptNewTasks: true, defaultMaxRounds: 30 };
			const running: IBackgroundAgentTask[] = [
				{ id: '1', description: 't', state: 'running', createdAt: '', lockedFiles: [], progress: 50, roundsCompleted: 5, maxRounds: 30 },
				{ id: '2', description: 't', state: 'running', createdAt: '', lockedFiles: [], progress: 50, roundsCompleted: 5, maxRounds: 30 },
			];
			assert.ok(!canStartImmediately(config, running));
		});

		test('computeQueuePosition counts queued tasks', () => {
			const queued: IBackgroundAgentTask[] = [
				{ id: '1', description: 't', state: 'queued', createdAt: '', lockedFiles: [], progress: 0, roundsCompleted: 0, maxRounds: 30 },
				{ id: '2', description: 't', state: 'queued', createdAt: '', lockedFiles: [], progress: 0, roundsCompleted: 0, maxRounds: 30 },
			];
			assert.strictEqual(computeQueuePosition(queued), 3);
		});

		test('generateTaskId produces unique IDs', () => {
			const ids = new Set<string>();
			for (let i = 0; i < 100; i++) {
				ids.add(generateTaskId());
			}
			assert.strictEqual(ids.size, 100);
		});

		test('transitionState allows valid transitions', () => {
			assert.strictEqual(transitionState('queued', 'running'), 'running');
			assert.strictEqual(transitionState('running', 'completed'), 'completed');
			assert.strictEqual(transitionState('running', 'paused'), 'paused');
		});

		test('transitionState rejects invalid transitions', () => {
			assert.strictEqual(transitionState('completed', 'running'), null);
			assert.strictEqual(transitionState('failed', 'running'), null);
			assert.strictEqual(transitionState('cancelled', 'running'), null);
		});

		test('formatTaskStatus shows progress for running task', () => {
			const task: IBackgroundAgentTask = {
				id: '1', description: 't', state: 'running', createdAt: '',
				lockedFiles: [], progress: 50, roundsCompleted: 10, maxRounds: 30,
				statusMessage: 'reading files',
			};
			const formatted = formatTaskStatus(task);
			assert.ok(formatted.includes('50%'));
			assert.ok(formatted.includes('10/30'));
			assert.ok(formatted.includes('reading files'));
		});

		test('DEFAULT_BACKGROUND_AGENT_CONFIG has sensible defaults', () => {
			assert.strictEqual(DEFAULT_BACKGROUND_AGENT_CONFIG.maxConcurrent, 3);
			assert.strictEqual(DEFAULT_BACKGROUND_AGENT_CONFIG.defaultMaxRounds, 30);
			assert.strictEqual(DEFAULT_BACKGROUND_AGENT_CONFIG.acceptNewTasks, true);
		});
	});

	suite('Tier 2.3 — Composer review', () => {

		function makeChange(filePath: string, state: 'pending' | 'accepted' | 'rejected' = 'pending'): IComposerFileChange {
			return {
				filePath, originalContent: '', proposedContent: 'new',
				isNewFile: false, isDeletion: false, linesAdded: 5, linesRemoved: 2,
				reviewState: state, proposedAt: '',
			};
		}

		test('computeChangeSetSummary counts states correctly', () => {
			const changeSet: IComposerChangeSet = {
				id: '1', description: 'test', createdAt: '',
				changes: [
					makeChange('a.ts', 'pending'),
					makeChange('b.ts', 'accepted'),
					makeChange('c.ts', 'rejected'),
				],
			};
			const summary = computeChangeSetSummary(changeSet);
			assert.strictEqual(summary.totalFiles, 3);
			assert.strictEqual(summary.pendingFiles, 1);
			assert.strictEqual(summary.acceptedFiles, 1);
			assert.strictEqual(summary.rejectedFiles, 1);
		});

		test('applyReviewDecision updates a single file', () => {
			const changeSet: IComposerChangeSet = {
				id: '1', description: 'test', createdAt: '',
				changes: [makeChange('a.ts', 'pending'), makeChange('b.ts', 'pending')],
			};
			const updated = applyReviewDecision(changeSet, 'a.ts', 'accepted');
			assert.strictEqual(updated.changes[0]!.reviewState, 'accepted');
			assert.strictEqual(updated.changes[1]!.reviewState, 'pending');
			// Original is unchanged (immutable)
			assert.strictEqual(changeSet.changes[0]!.reviewState, 'pending');
		});

		test('applyBulkDecision updates all pending files', () => {
			const changeSet: IComposerChangeSet = {
				id: '1', description: 'test', createdAt: '',
				changes: [makeChange('a.ts', 'pending'), makeChange('b.ts', 'accepted'), makeChange('c.ts', 'pending')],
			};
			const updated = applyBulkDecision(changeSet, 'rejected');
			assert.strictEqual(updated.changes[0]!.reviewState, 'rejected');
			assert.strictEqual(updated.changes[1]!.reviewState, 'accepted'); // already accepted
			assert.strictEqual(updated.changes[2]!.reviewState, 'rejected');
		});

		test('formatChangeSetSummary includes file count and line stats', () => {
			const summary = {
				totalFiles: 3, pendingFiles: 1, acceptedFiles: 1, rejectedFiles: 1,
				totalLinesAdded: 10, totalLinesRemoved: 4, newFiles: 1, deletions: 0,
			};
			const formatted = formatChangeSetSummary(summary);
			assert.ok(formatted.includes('3 files'));
			assert.ok(formatted.includes('+10/-4'));
		});

		test('sortChangesByPath sorts alphabetically', () => {
			const changes = [makeChange('z.ts'), makeChange('a.ts'), makeChange('m.ts')];
			const sorted = sortChangesByPath(changes);
			assert.strictEqual(sorted[0]!.filePath, 'a.ts');
			assert.strictEqual(sorted[1]!.filePath, 'm.ts');
			assert.strictEqual(sorted[2]!.filePath, 'z.ts');
		});

		test('filterChangesByState filters correctly', () => {
			const changes = [makeChange('a.ts', 'pending'), makeChange('b.ts', 'accepted')];
			assert.strictEqual(filterChangesByState(changes, 'pending').length, 1);
			assert.strictEqual(filterChangesByState(changes, 'accepted').length, 1);
			assert.strictEqual(filterChangesByState(changes, 'all').length, 2);
		});
	});

	suite('Tier 2.5 — Ponytail review', () => {

		test('parsePonytailTag parses // delete: comment', () => {
			const result = parsePonytailTag('// delete: this function is unused');
			assert.ok(result);
			assert.strictEqual(result!.tag, 'delete');
			assert.strictEqual(result!.message, 'this function is unused');
		});

		test('parsePonytailTag parses # yagni: comment (Python)', () => {
			const result = parsePonytailTag('# yagni: this abstraction is premature');
			assert.ok(result);
			assert.strictEqual(result!.tag, 'yagni');
		});

		test('parsePonytailTag returns null for non-ponytail comments', () => {
			assert.strictEqual(parsePonytailTag('// just a regular comment'), null);
			assert.strictEqual(parsePonytailTag('//TODO: fix this'), null);
		});

		test('severityForTag returns error for delete in all modes', () => {
			assert.strictEqual(severityForTag('delete', 'lite'), 'error');
			assert.strictEqual(severityForTag('delete', 'full'), 'error');
			assert.strictEqual(severityForTag('delete', 'ultra'), 'error');
		});

		test('severityForTag escalates yagni in full mode', () => {
			assert.strictEqual(severityForTag('yagni', 'lite'), 'info');
			assert.strictEqual(severityForTag('yagni', 'full'), 'warning');
			assert.strictEqual(severityForTag('yagni', 'ultra'), 'warning');
		});

		test('computeReviewSummary aggregates correctly', () => {
			const findings: IPonytailFinding[] = [
				{ tag: 'delete', severity: 'error', filePath: 'a.ts', lineNumber: 1, codeSnippet: '', message: '' },
				{ tag: 'yagni', severity: 'warning', filePath: 'b.ts', lineNumber: 2, codeSnippet: '', message: '' },
				{ tag: 'yagni', severity: 'warning', filePath: 'a.ts', lineNumber: 3, codeSnippet: '', message: '' },
			];
			const summary = computeReviewSummary(findings, ['a.ts', 'b.ts'], 100, 'full');
			assert.strictEqual(summary.totalFindings, 3);
			assert.strictEqual(summary.byTag.delete, 1);
			assert.strictEqual(summary.byTag.yagni, 2);
			assert.strictEqual(summary.bySeverity.error, 1);
			assert.strictEqual(summary.bySeverity.warning, 2);
			assert.strictEqual(summary.filesWithFindings, 2);
		});

		test('formatFinding includes tag, location, and message', () => {
			const finding: IPonytailFinding = {
				tag: 'delete', severity: 'error', filePath: 'src/foo.ts', lineNumber: 42,
				codeSnippet: '', message: 'unused function',
			};
			const formatted = formatFinding(finding);
			assert.ok(formatted.includes('[delete]'));
			assert.ok(formatted.includes('src/foo.ts:42'));
			assert.ok(formatted.includes('unused function'));
		});

		test('filterFindingsByTag filters by tag', () => {
			const findings: IPonytailFinding[] = [
				{ tag: 'delete', severity: 'error', filePath: '', lineNumber: 1, codeSnippet: '', message: '' },
				{ tag: 'yagni', severity: 'warning', filePath: '', lineNumber: 2, codeSnippet: '', message: '' },
			];
			assert.strictEqual(filterFindingsByTag(findings, 'delete').length, 1);
			assert.strictEqual(filterFindingsByTag(findings, 'all').length, 2);
		});
	});

	suite('Tier 2.7 — MCP Marketplace', () => {

		test('generateMcpConfig produces correct structure', () => {
			const [agentReach] = DEFAULT_MARKETPLACE_CATALOG;
			assert.ok(agentReach);
			const config = generateMcpConfig(agentReach!);
			assert.strictEqual(config.name, 'agent-reach');
			assert.strictEqual(config.command, 'npx');
			assert.deepStrictEqual(config.args, ['-y', '@agent-reach/mcp-server']);
		});

		test('generateMcpConfig populates required env vars', () => {
			const entry = {
				id: 'test', name: 'Test', description: '', author: '',
				installMethod: 'npx' as const, command: 'npx', args: [],
				envSchema: {
					API_KEY: { description: 'Required API key', required: true },
					OPTIONAL: { description: 'Optional', required: false, default: 'default-val' },
				},
				tools: [], categories: [], official: false, verified: false,
			};
			const config = generateMcpConfig(entry);
			assert.ok(config.env);
			assert.strictEqual(config.env!['API_KEY'], '<API_KEY_REQUIRED>');
			assert.strictEqual(config.env!['OPTIONAL'], 'default-val');
		});

		test('validateEnvVars detects missing required vars', () => {
			const entry = {
				id: 'test', name: 'Test', description: '', author: '',
				installMethod: 'npx' as const, command: 'npx', args: [],
				envSchema: {
					REQUIRED_VAR: { description: 'required', required: true },
				},
				tools: [], categories: [], official: false, verified: false,
			};
			const result = validateEnvVars(entry, {});
			assert.strictEqual(result.valid, false);
			assert.deepStrictEqual(result.missing, ['REQUIRED_VAR']);
		});

		test('searchMarketplace matches by name', () => {
			const results = searchMarketplace([...DEFAULT_MARKETPLACE_CATALOG], 'agent');
			assert.ok(results.some(e => e.id === 'agent-reach'));
		});

		test('searchMarketplace matches by tool name', () => {
			const results = searchMarketplace([...DEFAULT_MARKETPLACE_CATALOG], 'review_code');
			assert.ok(results.some(e => e.id === 'ponytail'));
		});

		test('searchMarketplace returns all entries for empty query', () => {
			const results = searchMarketplace([...DEFAULT_MARKETPLACE_CATALOG], '');
			assert.strictEqual(results.length, DEFAULT_MARKETPLACE_CATALOG.length);
		});

		test('filterByCategory filters by category', () => {
			const all = [...DEFAULT_MARKETPLACE_CATALOG];
			const research = filterByCategory(all, 'research');
			assert.ok(research.every(e => e.categories.includes('research')));
		});

		test('sortMarketplaceEntries puts official first', () => {
			const entries = [
				{ id: 'unofficial', name: 'Unofficial', description: '', author: '', installMethod: 'manual' as const, command: '', args: [], tools: [], categories: [], official: false, verified: false },
				...DEFAULT_MARKETPLACE_CATALOG.map(e => ({ ...e })),
			];
			const sorted = sortMarketplaceEntries(entries, 'official');
			// Official entries should come first
			assert.ok(sorted[0]!.official);
		});

		test('DEFAULT_MARKETPLACE_CATALOG has the 3 bundled servers', () => {
			assert.strictEqual(DEFAULT_MARKETPLACE_CATALOG.length, 3);
			assert.ok(DEFAULT_MARKETPLACE_CATALOG.some(e => e.id === 'agent-reach'));
			assert.ok(DEFAULT_MARKETPLACE_CATALOG.some(e => e.id === 'ui-ux-pro-max'));
			assert.ok(DEFAULT_MARKETPLACE_CATALOG.some(e => e.id === 'ponytail'));
		});
	});

	suite('Tier 3.6 — Air-gapped installer', () => {

		test('computeInstallerSizeMb includes Ollama binary and models', () => {
			const size = computeInstallerSizeMb(DEFAULT_AIRGAP_CONFIG);
			// Ollama binary (150) + llama3.2:1b (1300) + nomic-embed-text (270)
			assert.ok(size >= 150 + 1300 + 270);
		});

		test('generateInstallScript produces Windows script for win32', () => {
			const script = generateInstallScript(DEFAULT_AIRGAP_CONFIG, 'win32-x64');
			assert.ok(script.includes('@echo off'));
			assert.ok(script.includes('ollama-setup.exe'));
		});

		test('generateInstallScript produces bash script for linux', () => {
			const script = generateInstallScript(DEFAULT_AIRGAP_CONFIG, 'linux-x64');
			assert.ok(script.includes('#!/bin/bash'));
			assert.ok(script.includes('ollama.deb'));
		});

		test('generateManifest includes all bundled artifacts', () => {
			const manifest = generateManifest(DEFAULT_AIRGAP_CONFIG);
			assert.ok(manifest['artifacts']);
			assert.strictEqual((manifest['artifacts'] as unknown[]).length, 1 + DEFAULT_AIRGAP_CONFIG.bundledModels.length);
		});
	});

	suite('Tier 3.7 — Local RAG', () => {

		test('detectDocType identifies PDF', () => {
			assert.strictEqual(detectDocType('foo.pdf'), 'pdf');
		});

		test('detectDocType identifies HTML', () => {
			assert.strictEqual(detectDocType('foo.html'), 'html');
			assert.strictEqual(detectDocType('foo.htm'), 'html');
		});

		test('detectDocType identifies Markdown', () => {
			assert.strictEqual(detectDocType('foo.md'), 'markdown');
			assert.strictEqual(detectDocType('foo.markdown'), 'markdown');
		});

		test('detectDocType returns unknown for unrecognized', () => {
			assert.strictEqual(detectDocType('foo.unknown'), 'unknown');
		});

		test('shouldIndexFile returns true for indexed extension', () => {
			assert.ok(shouldIndexFile('docs.md', 1, DEFAULT_LOCAL_RAG_CONFIG));
		});

		test('shouldIndexFile returns false for non-indexed extension', () => {
			assert.ok(!shouldIndexFile('image.png', 1, DEFAULT_LOCAL_RAG_CONFIG));
		});

		test('shouldIndexFile returns false for oversized files', () => {
			assert.ok(!shouldIndexFile('huge.pdf', 100, DEFAULT_LOCAL_RAG_CONFIG));
		});

		test('chunkText produces multiple chunks for long text', () => {
			const longText = 'word '.repeat(1000);
			const chunks = chunkText(longText, 256, 32);
			assert.ok(chunks.length > 1);
		});

		test('chunkText respects chunk size', () => {
			const text = 'word '.repeat(500);
			const chunks = chunkText(text, 100, 0);
			// Each chunk should have roughly 100 tokens worth of words (~133 words)
			for (const chunk of chunks) {
				const wordCount = chunk.split(' ').filter(w => w.length > 0).length;
				assert.ok(wordCount <= 150, `Chunk too long: ${wordCount} words`);
			}
		});

		test('computeContentHash is deterministic', () => {
			const text = 'hello world';
			assert.strictEqual(computeContentHash(text), computeContentHash(text));
		});

		test('computeContentHash differs for different content', () => {
			assert.notStrictEqual(computeContentHash('hello'), computeContentHash('world'));
		});

		test('estimateTokenCount is roughly 1/4 of character count', () => {
			const text = 'a'.repeat(100);
			const tokens = estimateTokenCount(text);
			assert.ok(tokens >= 20 && tokens <= 30);
		});

		test('formatSearchResult includes title, path, and score', () => {
			const result: ILocalRagSearchResult = {
				docId: '1', title: 'Test Doc', sourcePath: '/docs/test.md',
				content: 'some content', score: 0.85,
			};
			const formatted = formatSearchResult(result);
			assert.ok(formatted.includes('Test Doc'));
			assert.ok(formatted.includes('/docs/test.md'));
			assert.ok(formatted.includes('85.0%'));
		});

		test('sortSearchResults sorts by score descending', () => {
			const results: ILocalRagSearchResult[] = [
				{ docId: '1', title: 'a', sourcePath: '', content: 'a', score: 0.5 },
				{ docId: '2', title: 'b', sourcePath: '', content: 'b', score: 0.9 },
				{ docId: '3', title: 'c', sourcePath: '', content: 'c', score: 0.7 },
			];
			const sorted = sortSearchResults(results);
			assert.strictEqual(sorted[0]!.score, 0.9);
			assert.strictEqual(sorted[1]!.score, 0.7);
			assert.strictEqual(sorted[2]!.score, 0.5);
		});

		test('deduplicateResults removes content duplicates', () => {
			const results: ILocalRagSearchResult[] = [
				{ docId: '1', title: 'a', sourcePath: '', content: 'duplicate', score: 0.9 },
				{ docId: '2', title: 'b', sourcePath: '', content: 'duplicate', score: 0.7 },
				{ docId: '3', title: 'c', sourcePath: '', content: 'unique', score: 0.5 },
			];
			const deduped = deduplicateResults(results);
			assert.strictEqual(deduped.length, 2);
		});
	});
});
