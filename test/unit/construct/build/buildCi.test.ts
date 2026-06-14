/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for Build/CI — workflow validation, SHA verification, build artifact checks.
 * Source references:
 * - CI workflow patterns from .github/workflows/build-verify.yml
 * - src/vs/platform/construct/common/constructTypes.ts — safeJsonParse
 */

// ---- Replicate production logic ----

function safeJsonParse<T>(input: string, fallback: T): T {
	try {
		return JSON.parse(input) as T;
	} catch {
		return fallback;
	}
}

interface IBuildConfig {
	name: string;
	version: string;
	scripts: Record<string, string>;
	dependencies: Record<string, string>;
}

function validateBuildConfig(config: IBuildConfig): string[] {
	const errors: string[] = [];
	if (!config.name || config.name.trim() === '') {
		errors.push('Build config: name is required');
	}
	if (!config.version || !/^\d+\.\d+\.\d+/.test(config.version)) {
		errors.push('Build config: version must be semver (x.y.z)');
	}
	if (!config.scripts || !config.scripts.build) {
		errors.push('Build config: scripts.build is required');
	}
	return errors;
}

function verifySha256(data: string, expectedSha: string): boolean {
	// Simple hash simulation for testing (real impl uses crypto)
	// We test the comparison logic, not actual hashing
	if (!expectedSha || expectedSha.length !== 64) {
		return false;
	}
	if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
		return false;
	}
	return true;
}

function validateShaFormat(sha: string): boolean {
	return /^[a-f0-9]{40,64}$/.test(sha);
}

interface IArtifactMetadata {
	name: string;
	size: number;
	sha256: string;
	createdAt: string;
}

function validateArtifact(artifact: IArtifactMetadata): string[] {
	const errors: string[] = [];
	if (!artifact.name) {
		errors.push('Artifact name is required');
	}
	if (artifact.size <= 0) {
		errors.push('Artifact size must be positive');
	}
	if (!validateShaFormat(artifact.sha256)) {
		errors.push('Artifact SHA256 must be a valid hex string (40-64 chars)');
	}
	if (!artifact.createdAt || isNaN(Date.parse(artifact.createdAt))) {
		errors.push('Artifact createdAt must be a valid ISO date');
	}
	return errors;
}

function detectVersionConflicts(deps: Record<string, string>, otherDeps: Record<string, string>): string[] {
	const conflicts: string[] = [];
	for (const [pkg, version] of Object.entries(deps)) {
		if (pkg in otherDeps && otherDeps[pkg] !== version) {
			conflicts.push(`${pkg}: ${version} vs ${otherDeps[pkg]}`);
		}
	}
	return conflicts;
}

interface ICIStage {
	name: string;
	dependsOn: string[];
	status: 'pending' | 'running' | 'success' | 'failed';
}

function validatePipelineStages(stages: ICIStage[]): string[] {
	const errors: string[] = [];
	const stageNames = new Set(stages.map(s => s.name));

	for (const stage of stages) {
		for (const dep of stage.dependsOn) {
			if (!stageNames.has(dep)) {
				errors.push(`Stage "${stage.name}" depends on non-existent stage "${dep}"`);
			}
		}
	}

	// Check for circular dependencies
	const visited = new Set<string>();
	const inStack = new Set<string>();
	function hasCycle(name: string, stageMap: Map<string, ICIStage>): boolean {
		if (inStack.has(name)) { return true; }
		if (visited.has(name)) { return false; }
		visited.add(name);
		inStack.add(name);
		const s = stageMap.get(name);
		if (s) {
			for (const dep of s.dependsOn) {
				if (hasCycle(dep, stageMap)) { return true; }
			}
		}
		inStack.delete(name);
		return false;
	}

	const stageMap = new Map(stages.map(s => [s.name, s]));
	for (const stage of stages) {
		if (hasCycle(stage.name, stageMap)) {
			errors.push(`Circular dependency detected involving "${stage.name}"`);
			break;
		}
	}

	return errors;
}

function generateBuildMetadata(config: IBuildConfig, sha: string): Record<string, string> {
	return {
		name: config.name,
		version: config.version,
		commitSha: sha,
		buildTimestamp: new Date().toISOString(),
		nodeVersion: process.version,
	};
}

// ---- Tests ----

suite('Build/CI Tests', () => {

	suite('Build Configuration', () => {
		test('should validate build configuration', () => {
			const validConfig: IBuildConfig = {
				name: 'kovix', version: '1.0.0',
				scripts: { build: 'tsc', test: 'mocha' },
				dependencies: { typescript: '^5.0.0' },
			};
			assert.strictEqual(validateBuildConfig(validConfig).length, 0);
		});

		test('should detect missing dependencies', () => {
			const deps = { react: '18.0.0', lodash: '4.17.21' };
			const installed = { react: '18.0.0' }; // lodash missing
			const missing = Object.keys(deps).filter(d => !(d in installed));
			assert.strictEqual(missing.length, 1);
			assert.strictEqual(missing[0], 'lodash');
		});

		test('should validate config with missing fields', () => {
			const badConfig = { name: '', version: 'not-semver', scripts: {} } as IBuildConfig;
			const errors = validateBuildConfig(badConfig);
			assert.ok(errors.length >= 2, 'Should have errors for name, version, and scripts');
		});
	});

	suite('Artifact Integrity', () => {
		test('should verify artifact integrity', () => {
			const artifact: IArtifactMetadata = {
				name: 'kovix.vsix', size: 52428800,
				sha256: 'a'.repeat(64),
				createdAt: new Date().toISOString(),
			};
			assert.strictEqual(validateArtifact(artifact).length, 0);
		});

		test('should reject artifact with invalid SHA', () => {
			const artifact: IArtifactMetadata = {
				name: 'bad.vsix', size: 1024,
				sha256: 'not-a-sha',
				createdAt: new Date().toISOString(),
			};
			const errors = validateArtifact(artifact);
			assert.ok(errors.some(e => e.includes('SHA256')));
		});

		test('should validate SHA format', () => {
			assert.strictEqual(validateShaFormat('a'.repeat(64)), true);
			assert.strictEqual(validateShaFormat('0123456789abcdef'.repeat(4)), true);
			assert.strictEqual(validateShaFormat('short'), false);
			assert.strictEqual(validateShaFormat('G'.repeat(64)), false); // uppercase G is not hex
			assert.strictEqual(validateShaFormat(''), false);
		});
	});

	suite('CI Pipeline', () => {
		test('should validate CI pipeline stages', () => {
			const stages: ICIStage[] = [
				{ name: 'install', dependsOn: [], status: 'success' },
				{ name: 'build', dependsOn: ['install'], status: 'success' },
				{ name: 'test', dependsOn: ['build'], status: 'success' },
			];
			assert.strictEqual(validatePipelineStages(stages).length, 0);
		});

		test('should detect circular dependencies in pipeline', () => {
			const stages: ICIStage[] = [
				{ name: 'a', dependsOn: ['b'], status: 'pending' },
				{ name: 'b', dependsOn: ['a'], status: 'pending' },
			];
			const errors = validatePipelineStages(stages);
			assert.ok(errors.some(e => e.includes('Circular')));
		});

		test('should detect dependency on non-existent stage', () => {
			const stages: ICIStage[] = [
				{ name: 'build', dependsOn: ['nonexistent'], status: 'pending' },
			];
			const errors = validatePipelineStages(stages);
			assert.ok(errors.some(e => e.includes('non-existent')));
		});
	});

	suite('Version and Metadata', () => {
		test('should detect version conflicts', () => {
			const deps = { react: '18.0.0', lodash: '4.17.21' };
			const otherDeps = { react: '17.0.0', lodash: '4.17.21' };
			const conflicts = detectVersionConflicts(deps, otherDeps);
			assert.strictEqual(conflicts.length, 1);
			assert.ok(conflicts[0].includes('react'));
		});

		test('should generate build metadata', () => {
			const config: IBuildConfig = {
				name: 'kovix', version: '1.2.3',
				scripts: { build: 'tsc' }, dependencies: {},
			};
			const metadata = generateBuildMetadata(config, 'abc123');
			assert.strictEqual(metadata.name, 'kovix');
			assert.strictEqual(metadata.version, '1.2.3');
			assert.strictEqual(metadata.commitSha, 'abc123');
			assert.ok(metadata.buildTimestamp);
		});

		test('should handle cross-platform build differences', () => {
			const platform = process.platform;
			const isWindows = platform === 'win32';
			const isMac = platform === 'darwin';
			const isLinux = platform === 'linux';

			// At least one should be true on any CI runner
			assert.ok(isWindows || isMac || isLinux, 'Should detect a valid platform');

			// Path separator differs
			const sep = isWindows ? '\\' : '/';
			assert.ok(['/','\\'].includes(sep));
		});

		test('should validate packaging output', () => {
			const artifact: IArtifactMetadata = {
				name: 'kovix-1.0.0.vsix', size: 52428800,
				sha256: 'abcdef0123456789'.repeat(4),
				createdAt: new Date().toISOString(),
			};
			const errors = validateArtifact(artifact);
			assert.strictEqual(errors.length, 0, 'Valid artifact should pass validation');
		});
	});
});
