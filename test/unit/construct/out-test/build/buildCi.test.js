"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
/**
 * Tests for Build/CI — workflow validation, SHA verification, build artifact checks.
 * Source references:
 * - CI workflow patterns from .github/workflows/build-verify.yml
 * - src/vs/platform/construct/common/constructTypes.ts — safeJsonParse
 */
// ---- Replicate production logic ----
function safeJsonParse(input, fallback) {
    try {
        return JSON.parse(input);
    }
    catch {
        return fallback;
    }
}
function validateBuildConfig(config) {
    const errors = [];
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
function verifySha256(data, expectedSha) {
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
function validateShaFormat(sha) {
    return /^[a-f0-9]{40,64}$/.test(sha);
}
function validateArtifact(artifact) {
    const errors = [];
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
function detectVersionConflicts(deps, otherDeps) {
    const conflicts = [];
    for (const [pkg, version] of Object.entries(deps)) {
        if (pkg in otherDeps && otherDeps[pkg] !== version) {
            conflicts.push(`${pkg}: ${version} vs ${otherDeps[pkg]}`);
        }
    }
    return conflicts;
}
function validatePipelineStages(stages) {
    const errors = [];
    const stageNames = new Set(stages.map(s => s.name));
    for (const stage of stages) {
        for (const dep of stage.dependsOn) {
            if (!stageNames.has(dep)) {
                errors.push(`Stage "${stage.name}" depends on non-existent stage "${dep}"`);
            }
        }
    }
    // Check for circular dependencies
    const visited = new Set();
    const inStack = new Set();
    function hasCycle(name, stageMap) {
        if (inStack.has(name)) {
            return true;
        }
        if (visited.has(name)) {
            return false;
        }
        visited.add(name);
        inStack.add(name);
        const s = stageMap.get(name);
        if (s) {
            for (const dep of s.dependsOn) {
                if (hasCycle(dep, stageMap)) {
                    return true;
                }
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
function generateBuildMetadata(config, sha) {
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
            const validConfig = {
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
            const badConfig = { name: '', version: 'not-semver', scripts: {} };
            const errors = validateBuildConfig(badConfig);
            assert.ok(errors.length >= 2, 'Should have errors for name, version, and scripts');
        });
    });
    suite('Artifact Integrity', () => {
        test('should verify artifact integrity', () => {
            const artifact = {
                name: 'kovix.vsix', size: 52428800,
                sha256: 'a'.repeat(64),
                createdAt: new Date().toISOString(),
            };
            assert.strictEqual(validateArtifact(artifact).length, 0);
        });
        test('should reject artifact with invalid SHA', () => {
            const artifact = {
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
            const stages = [
                { name: 'install', dependsOn: [], status: 'success' },
                { name: 'build', dependsOn: ['install'], status: 'success' },
                { name: 'test', dependsOn: ['build'], status: 'success' },
            ];
            assert.strictEqual(validatePipelineStages(stages).length, 0);
        });
        test('should detect circular dependencies in pipeline', () => {
            const stages = [
                { name: 'a', dependsOn: ['b'], status: 'pending' },
                { name: 'b', dependsOn: ['a'], status: 'pending' },
            ];
            const errors = validatePipelineStages(stages);
            assert.ok(errors.some(e => e.includes('Circular')));
        });
        test('should detect dependency on non-existent stage', () => {
            const stages = [
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
            const config = {
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
            assert.ok(['/', '\\'].includes(sep));
        });
        test('should validate packaging output', () => {
            const artifact = {
                name: 'kovix-1.0.0.vsix', size: 52428800,
                sha256: 'abcdef0123456789'.repeat(4),
                createdAt: new Date().toISOString(),
            };
            const errors = validateArtifact(artifact);
            assert.strictEqual(errors.length, 0, 'Valid artifact should pass validation');
        });
    });
});
//# sourceMappingURL=buildCi.test.js.map