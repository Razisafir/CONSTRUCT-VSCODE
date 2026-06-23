/*---------------------------------------------------------------------------------------------
 *  AI Execution Kernel -- Phase 4: Execution Sanity Validation
 *  Construct IDE -- AI-Native IDE
 *
 *  IExecutionSanityService -- Detect and prevent hallucinated success.
 *
 *  The system must distrust ambiguous success and require evidence.
 *  This service validates that claimed outcomes match reality.
 *
 *  REAL responsibilities:
 *    - Output sanity checks: verify command output is not empty/trivial
 *    - Impossible-state detection: catch contradictions in execution state
 *    - Verification contradiction detection: build says success but no artifacts
 *    - Execution consistency validation: state transitions are logical
 *    - Milestone completion proof validation: require evidence for completion
 *
 *  Examples of hallucinated success that this service detects:
 *    - Build says success but artifacts are missing from expected paths
 *    - Test runner exited but no tests actually ran
 *    - Git commit reported success but commit hash is missing
 *    - File claimed edited but checksum unchanged
 *    - Verification passed but output is suspiciously empty
 *    - Command exited with code 0 but stderr contains "error"
 *    - Milestone marked completed with no steps completed
 *
 *  HONEST limitations:
 *    - Sanity checks are heuristic; they may produce false positives
 *      (flagging legitimate successes as suspicious) or false negatives
 *      (missing subtle hallucinations)
 *    - Artifact detection depends on knowing expected output paths
 *    - Cannot verify semantic correctness, only structural consistency
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

// -- Enumerations --

/**
 * Severity of a sanity check result.
 */
export enum SanitySeverity {
	/** Looks fine */
	Pass = 'pass',
	/** Suspicious but not definitive */
	Warning = 'warning',
	/** Likely hallucinated success */
	Fail = 'fail',
	/** Critical contradiction detected */
	Critical = 'critical',
}

// -- Data Types --

/**
 * Result of a single sanity check.
 */
export interface SanityCheckResult {
	/** Name of the check that was performed */
	readonly checkName: string;
	/** What was being validated */
	readonly description: string;
	/** Severity of the result */
	readonly severity: SanitySeverity;
	/** Human-readable explanation of the finding */
	readonly message: string;
	/** Evidence supporting this result */
	readonly evidence: string;
	/** Suggested action (if severity is Warning or above) */
	readonly suggestedAction: string | null;
}

/**
 * Complete sanity report for an execution or milestone.
 */
export interface SanityReport {
	/** What this report is about */
	readonly subject: string;
	/** Timestamp of the report */
	readonly timestamp: number;
	/** All check results */
	readonly results: SanityCheckResult[];
	/** Overall severity (worst individual result) */
	readonly overallSeverity: SanitySeverity;
	/** Number of checks that passed */
	readonly passedCount: number;
	/** Number of warnings */
	readonly warningCount: number;
	/** Number of failures */
	readonly failedCount: number;
	/** Number of critical issues */
	readonly criticalCount: number;
}

/**
 * Configuration for sanity validation.
 */
export interface SanityConfig {
	/** Whether to check for empty build output */
	checkEmptyBuildOutput: boolean;
	/** Whether to check for test runner with zero tests */
	checkZeroTestsRun: boolean;
	/** Whether to verify git commit hash existence */
	checkGitCommitHash: boolean;
	/** Whether to verify file checksums after claimed edits */
	checkFileChecksums: boolean;
	/** Whether to check for "error" in stderr despite exit code 0 */
	checkErrorInStderr: boolean;
	/** Whether to validate milestone completion requires completed steps */
	checkMilestoneCompletionProof: boolean;
	/** Whether to check for missing build artifacts */
	checkMissingArtifacts: boolean;
	/** Known build artifact paths (relative to workspace root) */
	knownArtifactPaths: string[];
}

// -- Service Interface --

export interface IExecutionSanityService {
	readonly _serviceBrand: undefined;

	/**
	 * Validate that a command execution result is sane.
	 * Checks for: empty output with success, errors in stderr despite
	 * exit code 0, suspiciously short output, timeout markers.
	 */
	validateCommandResult(command: string, exitCode: number, stdout: string, stderr: string): SanityCheckResult[];

	/**
	 * Validate that a build result is sane.
	 * Checks for: success exit code but no artifacts, zero output,
	 * suspiciously fast completion.
	 */
	validateBuildResult(exitCode: number, output: string, expectedArtifacts?: string[]): SanityCheckResult[];

	/**
	 * Validate that a test result is sane.
	 * Checks for: zero tests run, all tests skipped, no test output.
	 */
	validateTestResult(exitCode: number, output: string): SanityCheckResult[];

	/**
	 * Validate that a git commit result is sane.
	 * Checks for: commit hash present, files changed count > 0.
	 */
	validateGitResult(exitCode: number, output: string, expectedHash?: string): SanityCheckResult[];

	/**
	 * Validate that a file edit was actually applied.
	 * Checks: file exists, content differs from original, checksum changed.
	 */
	validateFileEdit(filePath: string, originalHash: string, claimedNewHash: string): Promise<SanityCheckResult[]>;

	/**
	 * Validate milestone completion proof.
	 * Checks: at least one step completed, verification step ran,
	 * no steps still in running state.
	 */
	validateMilestoneCompletion(milestoneId: string, steps: { status: string; action: string }[], verificationRan: boolean): SanityCheckResult[];

	/**
	 * Generate a full sanity report for a subject.
	 * Runs all applicable checks and aggregates results.
	 */
	generateReport(subject: string, checks: SanityCheckResult[]): SanityReport;

	/**
	 * Get the current sanity configuration.
	 */
	getConfig(): SanityConfig;

	/**
	 * Update the sanity configuration.
	 */
	updateConfig(config: Partial<SanityConfig>): void;

	/**
	 * Get the number of hallucinated successes detected in this session.
	 */
	getHallucinationCount(): number;

	/**
	 * Get the hallucination prevention rate.
	 * Percentage of suspicious results that were caught before
	 * being treated as genuine success.
	 */
	getHallucinationPreventionRate(): number;
}

export const IExecutionSanityService = createDecorator<IExecutionSanityService>('construct.executionSanityService');
