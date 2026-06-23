/*---------------------------------------------------------------------------------------------
 *  AI Execution Kernel -- Phase 29: Execution Sanity Validation
 *  Construct IDE -- AI-Native IDE
 *
 *  ExecutionSanityService -- Concrete implementation of IExecutionSanityService.
 *  Detects and prevents hallucinated success by validating execution outputs
 *  against reality. The system distrusts ambiguous success and requires evidence.
 *
 *  Every validation method returns structured SanityCheckResult entries so that
 *  callers can aggregate, report, and decide how to act on suspicious outcomes.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import {
	IExecutionSanityService,
	SanitySeverity,
	SanityCheckResult,
	SanityReport,
	SanityConfig,
} from '../../../../../platform/construct/common/executionSanity.js';

// -- Default configuration --

const DEFAULT_CONFIG: SanityConfig = {
	checkEmptyBuildOutput: true,
	checkZeroTestsRun: true,
	checkGitCommitHash: true,
	checkFileChecksums: true,
	checkErrorInStderr: true,
	checkMilestoneCompletionProof: true,
	checkMissingArtifacts: true,
	knownArtifactPaths: ['dist/', 'build/', 'out/'],
};

// -- Helpers --

/**
 * Compute a SHA-256 hex digest of the given string content.
 */
async function computeHash(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Determine the worst severity among a set of results.
 * Priority: Critical > Fail > Warning > Pass
 */
function worstSeverity(results: SanityCheckResult[]): SanitySeverity {
	let worst = SanitySeverity.Pass;
	const order: SanitySeverity[] = [SanitySeverity.Pass, SanitySeverity.Warning, SanitySeverity.Fail, SanitySeverity.Critical];
	for (const r of results) {
		if (order.indexOf(r.severity) > order.indexOf(worst)) {
			worst = r.severity;
		}
	}
	return worst;
}

// -- Service implementation --

export class ExecutionSanityService extends Disposable implements IExecutionSanityService {

	declare readonly _serviceBrand: undefined;

	// -- Private state --

	private config: SanityConfig = { ...DEFAULT_CONFIG };
	private hallucinationCount: number = 0;
	private totalChecks: number = 0;
	private hallucinationPreventedCount: number = 0;

	// -- Constructor --

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this.logService.trace('[Construct ExecutionSanityService] Initialized');
	}

	// -- validateCommandResult --

	validateCommandResult(command: string, exitCode: number, stdout: string, stderr: string): SanityCheckResult[] {
		const results: SanityCheckResult[] = [];

		// (1) exitCode=0 but stderr contains "error" or "Error"
		if (this.config.checkErrorInStderr && exitCode === 0 && stderr.length > 0) {
			const lower = stderr.toLowerCase();
			if (lower.includes('error')) {
				results.push({
					checkName: 'error-in-stderr',
					description: `Command "${command}" exited with code 0 but stderr contains error text`,
					severity: SanitySeverity.Warning,
					message: 'Exit code indicates success but stderr contains "error"',
					evidence: `stderr snippet: ${stderr.substring(0, 200)}`,
					suggestedAction: 'Inspect stderr output for actual errors; the exit code may be misleading',
				});
			}
		}

		// (2) exitCode=0 but both stdout and stderr are empty
		if (exitCode === 0 && stdout.length === 0 && stderr.length === 0) {
			results.push({
				checkName: 'suspiciously-empty-output',
				description: `Command "${command}" exited with code 0 but produced no output`,
				severity: SanitySeverity.Warning,
				message: 'suspiciously empty output',
				evidence: 'stdout and stderr are both empty strings',
				suggestedAction: 'Verify the command actually executed and produced the expected effect',
			});
		}

		// (3) exitCode=0 but stdout contains "FAIL" or "failed"
		if (exitCode === 0 && stdout.length > 0) {
			const lower = stdout.toLowerCase();
			if (lower.includes('fail') || lower.includes('failed')) {
				results.push({
					checkName: 'failure-keyword-in-stdout',
					description: `Command "${command}" exited with code 0 but stdout contains failure indicators`,
					severity: SanitySeverity.Warning,
					message: 'Exit code indicates success but output mentions "FAIL" or "failed"',
					evidence: `stdout snippet: ${stdout.substring(0, 200)}`,
					suggestedAction: 'Check whether failures were suppressed or exit code is incorrect',
				});
			}
		}

		// (4) output contains timeout markers
		const combinedOutput = stdout + stderr;
		if (combinedOutput.length > 0) {
			const timeoutMarkers = ['timed out', 'timeout', 'ETIMEDOUT', 'deadline exceeded'];
			const lowerCombined = combinedOutput.toLowerCase();
			const foundMarker = timeoutMarkers.find(m => lowerCombined.includes(m.toLowerCase()));
			if (foundMarker) {
				results.push({
					checkName: 'timeout-marker-detected',
					description: `Command "${command}" output contains timeout markers`,
					severity: SanitySeverity.Fail,
					message: 'Output contains timeout markers -- execution may not have completed normally',
					evidence: `Found timeout marker: "${foundMarker}"`,
					suggestedAction: 'Re-run the command with a longer timeout or investigate the cause of the timeout',
				});
			}
		}

		// (5) exitCode is non-zero but claimed success (we infer "claimed success" from
		//     output containing success keywords while exit code is non-zero)
		if (exitCode !== 0) {
			const lowerCombined = combinedOutput.toLowerCase();
			const successMarkers = ['success', 'succeeded', 'completed successfully', 'all tests passed', 'build succeeded'];
			const foundSuccess = successMarkers.find(m => lowerCombined.includes(m));
			if (foundSuccess) {
				results.push({
					checkName: 'non-zero-exit-but-claimed-success',
					description: `Command "${command}" exited with code ${exitCode} but output claims success`,
					severity: SanitySeverity.Critical,
					message: 'Non-zero exit code but claimed success in output',
					evidence: `exitCode=${exitCode}, found success marker: "${foundSuccess}"`,
					suggestedAction: 'Do not trust the success claim; investigate the non-zero exit code',
				});
			}
		}

		this.recordCheckResults(results);
		return results;
	}

	// -- validateBuildResult --

	validateBuildResult(exitCode: number, output: string, expectedArtifacts?: string[]): SanityCheckResult[] {
		const results: SanityCheckResult[] = [];

		// (1) exitCode=0 but output is empty or <20 chars
		if (this.config.checkEmptyBuildOutput && exitCode === 0) {
			if (output.length === 0 || output.length < 20) {
				results.push({
					checkName: 'empty-or-trivial-build-output',
					description: 'Build exited with code 0 but output is suspiciously short',
					severity: SanitySeverity.Warning,
					message: output.length === 0 ? 'Build output is empty despite success exit code' : 'Build output is fewer than 20 characters despite success exit code',
					evidence: `output length: ${output.length} chars`,
					suggestedAction: 'Verify the build actually ran; empty output is unusual for a successful build',
				});
			}
		}

		// (2) exitCode=0 but no build artifacts found at expected paths
		if (this.config.checkMissingArtifacts && exitCode === 0) {
			const artifactPaths = expectedArtifacts ?? this.config.knownArtifactPaths;
			if (artifactPaths.length > 0) {
				const workspace = this.workspaceContextService.getWorkspace();
				const missingPaths: string[] = [];

				for (const artifactPath of artifactPaths) {
					const folder = workspace.folders[0];
					if (folder) {
						const artifactUri = URI.joinPath(folder.uri, artifactPath);
						if (!this.fileService.exists(artifactUri)) {
							missingPaths.push(artifactPath);
						}
					}
				}

				if (missingPaths.length === artifactPaths.length) {
					// None of the expected artifact paths were found
					results.push({
						checkName: 'missing-build-artifacts',
						description: 'Build exited with code 0 but no expected artifacts were found',
						severity: SanitySeverity.Fail,
						message: 'Build claims success but no artifacts found at expected paths',
						evidence: `Missing artifact paths: ${missingPaths.join(', ')}`,
						suggestedAction: 'Verify the build output location or check if the build actually produced output',
					});
				}
			}
		}

		// (3) output contains "error" despite exit code 0
		if (exitCode === 0 && output.length > 0) {
			const lower = output.toLowerCase();
			if (lower.includes('error')) {
				results.push({
					checkName: 'error-in-build-output',
					description: 'Build exited with code 0 but output contains error text',
					severity: SanitySeverity.Warning,
					message: 'Build claims success but output mentions "error"',
					evidence: `output snippet: ${output.substring(0, 200)}`,
					suggestedAction: 'Inspect build output for suppressed or non-fatal errors',
				});
			}
		}

		// (4) duration <100ms for what should be a long build
		// We infer suspicious speed from the output containing timing information
		if (exitCode === 0 && output.length > 0) {
			const durationMatch = output.match(/(?:completed? in|duration|took|time)[:\s]*(\d+)\s*ms/i);
			if (durationMatch) {
				const durationMs = parseInt(durationMatch[1], 10);
				if (durationMs < 100) {
					results.push({
						checkName: 'suspiciously-fast-build',
						description: 'Build completed in under 100ms',
						severity: SanitySeverity.Warning,
						message: 'suspiciously fast',
						evidence: `Reported build duration: ${durationMs}ms`,
						suggestedAction: 'Verify the build actually compiled and linked; sub-100ms builds are rare',
					});
				}
			}
		}

		this.recordCheckResults(results);
		return results;
	}

	// -- validateTestResult --

	validateTestResult(exitCode: number, output: string): SanityCheckResult[] {
		const results: SanityCheckResult[] = [];

		// (4) output is empty -- fail immediately
		if (output.length === 0) {
			results.push({
				checkName: 'no-test-output',
				description: 'Test run produced no output at all',
				severity: SanitySeverity.Fail,
				message: 'no test output at all',
				evidence: 'output is an empty string',
				suggestedAction: 'Verify the test runner actually executed; no output is a strong sign of a problem',
			});
			this.recordCheckResults(results);
			return results;
		}

		const lower = output.toLowerCase();

		// (1) output contains "0 tests", "no tests found", or "tests: 0"
		if (this.config.checkZeroTestsRun) {
			const zeroTestPatterns = ['0 tests', 'no tests found', 'tests: 0', '0 test', 'test suites: 0'];
			const foundZero = zeroTestPatterns.find(p => lower.includes(p));
			if (foundZero) {
				results.push({
					checkName: 'zero-tests-run',
					description: 'Test runner reports zero tests executed',
					severity: SanitySeverity.Fail,
					message: 'No tests were actually run despite the test runner completing',
					evidence: `Found pattern: "${foundZero}"`,
					suggestedAction: 'Check test discovery configuration; zero tests is likely a misconfiguration or hallucinated success',
				});
			}
		}

		// (2) all tests skipped (output contains "0 passed" + "skipped")
		if (lower.includes('0 passed') && lower.includes('skipped')) {
			results.push({
				checkName: 'all-tests-skipped',
				description: 'Test runner reports 0 passed and some skipped',
				severity: SanitySeverity.Warning,
				message: 'All tests were skipped; none actually passed',
				evidence: 'Output contains "0 passed" and "skipped"',
				suggestedAction: 'Investigate why all tests were skipped; this may indicate a configuration issue',
			});
		}

		// (3) exit code 0 but output contains "FAIL"
		if (exitCode === 0 && (lower.includes('fail') || output.includes('FAIL'))) {
			results.push({
				checkName: 'fail-in-test-output',
				description: 'Test exited with code 0 but output mentions FAIL',
				severity: SanitySeverity.Warning,
				message: 'Exit code indicates success but test output mentions "FAIL"',
				evidence: `output snippet: ${output.substring(0, 200)}`,
				suggestedAction: 'Check if test failures were suppressed or the exit code is incorrect',
			});
		}

		this.recordCheckResults(results);
		return results;
	}

	// -- validateGitResult --

	validateGitResult(exitCode: number, output: string, expectedHash?: string): SanityCheckResult[] {
		const results: SanityCheckResult[] = [];

		// (1) exitCode=0 but no commit hash in output
		if (this.config.checkGitCommitHash && exitCode === 0) {
			const hashPattern = /[0-9a-f]{7,40}/i;
			if (!hashPattern.test(output)) {
				results.push({
					checkName: 'missing-commit-hash',
					description: 'Git command succeeded but no commit hash found in output',
					severity: SanitySeverity.Fail,
					message: 'No commit hash found in git output despite reported success',
					evidence: `output: ${output.substring(0, 200)}`,
					suggestedAction: 'Verify the git operation actually created a commit',
				});
			}
		}

		// (2) expected hash provided but not found in output
		if (expectedHash && exitCode === 0) {
			if (!output.includes(expectedHash)) {
				results.push({
					checkName: 'expected-hash-not-found',
					description: `Expected commit hash ${expectedHash} not found in git output`,
					severity: SanitySeverity.Fail,
					message: `Expected commit hash "${expectedHash}" was not present in output`,
					evidence: `expected: ${expectedHash}, output: ${output.substring(0, 200)}`,
					suggestedAction: 'Verify the correct commit was created; the hash may differ from expectation',
				});
			}
		}

		// (3) "nothing to commit" but claimed success
		if (exitCode === 0 && output.toLowerCase().includes('nothing to commit')) {
			results.push({
				checkName: 'nothing-to-commit-claimed-success',
				description: 'Git says "nothing to commit" but exit code indicates success',
				severity: SanitySeverity.Warning,
				message: '"nothing to commit" but claimed success',
				evidence: `output contains "nothing to commit"`,
				suggestedAction: 'A commit was likely not created; check if there were actual changes to commit',
			});
		}

		this.recordCheckResults(results);
		return results;
	}

	// -- validateFileEdit --

	async validateFileEdit(filePath: string, originalHash: string, claimedNewHash: string): Promise<SanityCheckResult[]> {
		const results: SanityCheckResult[] = [];

		if (!this.config.checkFileChecksums) {
			return results;
		}

		const fileUri = URI.file(filePath);

		// Check if file exists
		const exists = await this.fileService.exists(fileUri);
		if (!exists) {
			results.push({
				checkName: 'file-missing-after-edit',
				description: `File "${filePath}" does not exist after claimed edit`,
				severity: SanitySeverity.Critical,
				message: `File "${filePath}" is missing after a claimed edit`,
				evidence: `File does not exist at path: ${filePath}`,
				suggestedAction: 'The file may have been deleted or the path is incorrect; verify the file location',
			});
			this.recordCheckResults(results);
			return results;
		}

		// Read file content and compute hash
		const content = await this.fileService.readFile(fileUri);
		const contentString = content.value.toString();
		const actualHash = await computeHash(contentString);

		// Compare with original hash
		if (actualHash === originalHash) {
			results.push({
				checkName: 'file-content-unchanged',
				description: `File "${filePath}" content is unchanged despite claimed edit`,
				severity: SanitySeverity.Fail,
				message: 'file content unchanged despite claimed edit',
				evidence: `actual hash matches original hash: ${originalHash.substring(0, 16)}...`,
				suggestedAction: 'The edit was likely not applied; re-attempt the file modification',
			});
			this.recordCheckResults(results);
			return results;
		}

		// Compare with claimed new hash
		if (actualHash === claimedNewHash) {
			results.push({
				checkName: 'file-hash-verified',
				description: `File "${filePath}" hash matches claimed new hash`,
				severity: SanitySeverity.Pass,
				message: 'File content checksum verified successfully',
				evidence: `actual hash matches claimed hash: ${claimedNewHash.substring(0, 16)}...`,
				suggestedAction: null,
			});
		} else {
			// Hash changed but not to the claimed value
			results.push({
				checkName: 'file-hash-mismatch',
				description: `File "${filePath}" hash does not match the claimed new hash`,
				severity: SanitySeverity.Warning,
				message: 'File was modified but the resulting hash differs from what was claimed',
				evidence: `claimed: ${claimedNewHash.substring(0, 16)}..., actual: ${actualHash.substring(0, 16)}...`,
				suggestedAction: 'The file was edited but possibly with different content than expected; verify the file contents',
			});
		}

		this.recordCheckResults(results);
		return results;
	}

	// -- validateMilestoneCompletion --

	validateMilestoneCompletion(milestoneId: string, steps: { status: string; action: string }[], verificationRan: boolean): SanityCheckResult[] {
		const results: SanityCheckResult[] = [];

		// (1) no steps with status='completed'
		if (this.config.checkMilestoneCompletionProof) {
			const completedSteps = steps.filter(s => s.status === 'completed');
			if (steps.length > 0 && completedSteps.length === 0) {
				results.push({
					checkName: 'no-completed-steps',
					description: `Milestone "${milestoneId}" has no completed steps`,
					severity: SanitySeverity.Critical,
					message: 'No steps with status "completed" found for this milestone',
					evidence: `Total steps: ${steps.length}, completed: 0`,
					suggestedAction: 'The milestone cannot be considered complete without at least one completed step',
				});
			}
		}

		// (2) any steps still 'running'
		const runningSteps = steps.filter(s => s.status === 'running');
		if (runningSteps.length > 0) {
			results.push({
				checkName: 'steps-still-running',
				description: `Milestone "${milestoneId}" has steps still in running state`,
				severity: SanitySeverity.Fail,
				message: `${runningSteps.length} step(s) are still in "running" state`,
				evidence: `Running steps: ${runningSteps.map(s => `"${s.action}"`).join(', ')}`,
				suggestedAction: 'Wait for all steps to complete or fail before declaring milestone completion',
			});
		}

		// (3) verification step not ran
		if (!verificationRan) {
			results.push({
				checkName: 'verification-not-ran',
				description: `Milestone "${milestoneId}" verification step was not executed`,
				severity: SanitySeverity.Warning,
				message: 'Verification step was not ran for this milestone',
				evidence: 'verificationRan = false',
				suggestedAction: 'Run the verification step before considering this milestone complete',
			});
		}

		// (4) all steps skipped
		const skippedSteps = steps.filter(s => s.status === 'skipped');
		if (steps.length > 0 && skippedSteps.length === steps.length) {
			results.push({
				checkName: 'all-steps-skipped',
				description: `Milestone "${milestoneId}" has all steps in skipped state`,
				severity: SanitySeverity.Warning,
				message: 'All steps were skipped; no actual work was performed',
				evidence: `Total steps: ${steps.length}, all skipped`,
				suggestedAction: 'Investigate why all steps were skipped; this may indicate the milestone is premature',
			});
		}

		this.recordCheckResults(results);
		return results;
	}

	// -- generateReport --

	generateReport(subject: string, checks: SanityCheckResult[]): SanityReport {
		const overall = worstSeverity(checks);

		const passedCount = checks.filter(c => c.severity === SanitySeverity.Pass).length;
		const warningCount = checks.filter(c => c.severity === SanitySeverity.Warning).length;
		const failedCount = checks.filter(c => c.severity === SanitySeverity.Fail).length;
		const criticalCount = checks.filter(c => c.severity === SanitySeverity.Critical).length;

		return {
			subject,
			timestamp: Date.now(),
			results: checks,
			overallSeverity: overall,
			passedCount,
			warningCount,
			failedCount,
			criticalCount,
		};
	}

	// -- Config accessors --

	getConfig(): SanityConfig {
		return { ...this.config };
	}

	updateConfig(config: Partial<SanityConfig>): void {
		this.config = { ...this.config, ...config };
		this.logService.trace('[Construct ExecutionSanityService] Config updated');
	}

	// -- Hallucination tracking --

	getHallucinationCount(): number {
		return this.hallucinationCount;
	}

	getHallucinationPreventionRate(): number {
		if (this.totalChecks === 0) {
			return 0;
		}
		return this.hallucinationPreventedCount / this.totalChecks;
	}

	// -- Private helpers --

	/**
	 * Record check results and update hallucination tracking counters.
	 */
	private recordCheckResults(results: SanityCheckResult[]): void {
		for (const result of results) {
			this.totalChecks++;
			if (result.severity === SanitySeverity.Warning
				|| result.severity === SanitySeverity.Fail
				|| result.severity === SanitySeverity.Critical) {
				this.hallucinationCount++;
				if (result.severity === SanitySeverity.Fail || result.severity === SanitySeverity.Critical) {
					this.hallucinationPreventedCount++;
				}
			}
		}
	}

	// -- Lifecycle --

	override dispose(): void {
		this.logService.trace('[Construct ExecutionSanityService] Disposed');
		super.dispose();
	}
}
