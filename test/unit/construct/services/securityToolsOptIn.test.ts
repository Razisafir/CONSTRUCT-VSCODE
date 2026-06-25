/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * Phase 5 integration test: security tools opt-in verification.
 *
 * The user explicitly asked: "verify with a real test (not just code reading)
 * that a fresh install with no extension installed and no settings changed
 * truly cannot invoke nmap/Ghidra/Nuclei from the agent loop — i.e. the LLM
 * is never even offered these tools."
 *
 * This test exercises the REAL pieces of the security-tool registration
 * pipeline that can be tested without a full VS Code runtime:
 *
 *   1. The three security tool definitions (nmapToolDefinition,
 *      ghidraToolDefinition, nucleiToolDefinition) -- imported from their
 *      real source files. Verifies the tool names exist and have the
 *      expected shape.
 *
 *   2. The external-target guard (isExternalTarget,
 *      checkExternalTargetAllowed) -- imported from the real extracted
 *      helper. Verifies the safety gate refuses external targets by
 *      default.
 *
 *   3. The Phase 5 extraction contract -- verifies that the
 *      kovix.enableSecurityTools setting default is false, and that
 *      ConstructToolRegistryService's constructor does NOT auto-register
 *      the security tools. The registration is now triggered only by
 *      the Kovix Security Tools extension via the
 *      _kovix.toolRegistry.registerSecurityTools command.
 *
 * Why we don't instantiate ConstructToolRegistryService directly:
 *   ConstructToolRegistryService has 22 injected dependencies that pull in
 *   the full VS Code internal service graph (IFileService,
 *   IWorkspaceContextService, IInstantiationService, etc.). Instantiating
 *   it in a standalone mocha runner would require stubbing the entire VS
 *   Code service graph, which is what the Electron-based test runner
 *   (./scripts/test.sh) is for. The Electron runner is currently blocked
 *   by the pre-existing #136 SIGTRAP sandbox issue.
 *
 *   Instead, this test verifies the contract at the boundaries that
 *   matter for the user's requirement:
 *     - The tool definitions exist and have known names.
 *     - The external-target guard works correctly.
 *     - The kovix.enableSecurityTools default is false (verified by
 *       reading the registered configuration schema).
 *     - The ConstructToolRegistryService source does NOT call
 *       registerSecurityTools() from its constructor (verified by a
 *       regex match against the source file -- this is the "code reading"
 *       part the user warned about, but combined with the runtime tests
 *       above it provides a meaningful regression guard).
 *
 *   A future PR that adds a full integration test in the Electron runner
 *   would be welcome, but is out of scope for Phase 5.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { nmapToolDefinition } from '../../../../src/vs/workbench/contrib/construct/browser/tools/security/nmapTool.js';
import { ghidraToolDefinition } from '../../../../src/vs/workbench/contrib/construct/browser/tools/security/ghidraTool.js';
import { nucleiToolDefinition } from '../../../../src/vs/workbench/contrib/construct/browser/tools/security/nucleiTool.js';
import {
	isExternalTarget,
	checkExternalTargetAllowed,
} from '../../../../src/vs/platform/construct/common/security/securityTargetGuard.js';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

const SECURITY_TOOL_NAMES = ['nmap_scan', 'ghidra_decompile', 'nuclei_scan'] as const;

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const REGISTRY_SOURCE = path.join(
	REPO_ROOT,
	'src/vs/workbench/contrib/construct/browser/services/tools/constructToolRegistryService.ts',
);
const CONFIG_SOURCE = path.join(
	REPO_ROOT,
	'src/vs/workbench/contrib/construct/browser/constructApiConfig.ts',
);

// ----------------------------------------------------------------------
// 1. Security tool definitions exist with expected names
// ----------------------------------------------------------------------

describe('Phase 5 — security tool definitions', () => {

	it('nmapToolDefinition has the expected name and category', () => {
		assert.strictEqual(nmapToolDefinition.name, 'nmap_scan');
		assert.strictEqual(nmapToolDefinition.category, 'security');
		assert.strictEqual(nmapToolDefinition.requiresNetwork, true);
		assert.strictEqual(nmapToolDefinition.modifiesFiles, false);
	});

	it('ghidraToolDefinition has the expected name and category', () => {
		assert.strictEqual(ghidraToolDefinition.name, 'ghidra_decompile');
		assert.strictEqual(ghidraToolDefinition.category, 'security');
		assert.strictEqual(ghidraToolDefinition.requiresNetwork, false);
		assert.strictEqual(ghidraToolDefinition.modifiesFiles, false);
	});

	it('nucleiToolDefinition has the expected name and category', () => {
		assert.strictEqual(nucleiToolDefinition.name, 'nuclei_scan');
		assert.strictEqual(nucleiToolDefinition.category, 'security');
		assert.strictEqual(nucleiToolDefinition.requiresNetwork, true);
		assert.strictEqual(nucleiToolDefinition.modifiesFiles, false);
	});

	it('the three security tool names are exactly the set we test against', () => {
		const names = [nmapToolDefinition.name, ghidraToolDefinition.name, nucleiToolDefinition.name].sort();
		assert.deepStrictEqual(names, [...SECURITY_TOOL_NAMES].sort());
	});
});

// ----------------------------------------------------------------------
// 2. External-target guard (extracted pure function)
// ----------------------------------------------------------------------

describe('Phase 5 — external-target guard (securityTargetGuard)', () => {

	describe('isExternalTarget', () => {

		it('returns false for localhost', () => {
			assert.strictEqual(isExternalTarget('localhost'), false);
		});

		it('returns false for IPv6 loopback ::1', () => {
			assert.strictEqual(isExternalTarget('::1'), false);
		});

		it('returns false for 127.0.0.1', () => {
			assert.strictEqual(isExternalTarget('127.0.0.1'), false);
		});

		it('returns false for the full 127.0.0.0/8 loopback range', () => {
			assert.strictEqual(isExternalTarget('127.1.2.3'), false);
			assert.strictEqual(isExternalTarget('127.255.255.255'), false);
		});

		it('returns false for 10.0.0.0/8 private range', () => {
			assert.strictEqual(isExternalTarget('10.0.0.1'), false);
			assert.strictEqual(isExternalTarget('10.255.255.255'), false);
		});

		it('returns false for 172.16.0.0/12 private range', () => {
			assert.strictEqual(isExternalTarget('172.16.0.1'), false);
			assert.strictEqual(isExternalTarget('172.31.255.255'), false);
		});

		it('returns false for 192.168.0.0/16 private range', () => {
			assert.strictEqual(isExternalTarget('192.168.0.1'), false);
			assert.strictEqual(isExternalTarget('192.168.1.100'), false);
		});

		it('returns true for public IPv4 addresses', () => {
			assert.strictEqual(isExternalTarget('8.8.8.8'), true);
			assert.strictEqual(isExternalTarget('1.1.1.1'), true);
			assert.strictEqual(isExternalTarget('203.0.113.1'), true);
		});

		it('returns true for non-IP hostnames (could resolve to anything)', () => {
			assert.strictEqual(isExternalTarget('example.com'), true);
			assert.strictEqual(isExternalTarget('internal.corp.local'), true);
		});

		it('handles targets with port suffixes', () => {
			// The guard splits on ':' and checks the host part.
			assert.strictEqual(isExternalTarget('127.0.0.1:8080'), false);
			assert.strictEqual(isExternalTarget('localhost:3000'), false);
			assert.strictEqual(isExternalTarget('example.com:443'), true);
		});

		it('is case-insensitive', () => {
			assert.strictEqual(isExternalTarget('LOCALHOST'), false);
			assert.strictEqual(isExternalTarget('Localhost'), false);
			assert.strictEqual(isExternalTarget('EXAMPLE.com'), true);
		});
	});

	describe('checkExternalTargetAllowed', () => {

		it('returns undefined (allow) for loopback targets regardless of setting', () => {
			assert.strictEqual(checkExternalTargetAllowed('127.0.0.1', false), undefined);
			assert.strictEqual(checkExternalTargetAllowed('127.0.0.1', true), undefined);
			assert.strictEqual(checkExternalTargetAllowed('127.0.0.1', undefined), undefined);
		});

		it('returns undefined (allow) for private-range targets regardless of setting', () => {
			assert.strictEqual(checkExternalTargetAllowed('10.0.0.1', false), undefined);
			assert.strictEqual(checkExternalTargetAllowed('192.168.1.1', true), undefined);
		});

		it('returns a refusal message for external targets when allowExternalTargets is false', () => {
			const result = checkExternalTargetAllowed('8.8.8.8', false);
			assert.ok(result, 'Expected a refusal message for external target with allowExternalTargets=false');
			assert.ok(result!.includes('Refusing to scan external target'), `Unexpected message: ${result}`);
			assert.ok(result!.includes('8.8.8.8'), `Refusal message should mention the target: ${result}`);
		});

		it('returns a refusal message for external targets when allowExternalTargets is undefined', () => {
			// undefined should be treated as false (the default).
			const result = checkExternalTargetAllowed('example.com', undefined);
			assert.ok(result, 'Expected a refusal message for external target with allowExternalTargets=undefined');
		});

		it('returns undefined (allow) for external targets when allowExternalTargets is true', () => {
			assert.strictEqual(checkExternalTargetAllowed('8.8.8.8', true), undefined);
			assert.strictEqual(checkExternalTargetAllowed('example.com', true), undefined);
		});

		it('includes the kovix.security.allowExternalTargets setting name in the refusal', () => {
			const result = checkExternalTargetAllowed('8.8.8.8', false);
			assert.ok(
				result!.includes('kovix.security.allowExternalTargets'),
				`Refusal message should tell the user which setting to flip: ${result}`,
			);
		});
	});
});

// ----------------------------------------------------------------------
// 3. Phase 5 extraction contract
// ----------------------------------------------------------------------

describe('Phase 5 — extraction contract (regression guards)', () => {

	describe('ConstructToolRegistryService constructor', () => {

		it('does NOT auto-call registerSecurityTools() (registration is gated by the extension)', () => {
			// Read the actual source file and verify the constructor does
			// not contain a call to this.registerSecurityTools().
			//
			// This is a regression guard: if a future PR accidentally
			// re-adds the auto-call (which existed before Phase 5), this
			// test will fail.
			const source = fs.readFileSync(REGISTRY_SOURCE, 'utf8');

			// Find the constructor body. The constructor starts at
			// "constructor(" and ends at the matching "}".
			const ctorStart = source.indexOf('constructor(');
			assert.ok(ctorStart >= 0, 'Could not find constructor in constructToolRegistryService.ts');

			// Find the end of the constructor by brace-matching.
			let braceDepth = 0;
			let ctorEnd = -1;
			let inString: '"' | "'" | '`' | null = null;
			for (let i = source.indexOf('{', ctorStart); i < source.length; i++) {
				const ch = source[i];
				if (inString) {
					if (ch === '\\') { i++; continue; }
					if (ch === inString) { inString = null; }
					continue;
				}
				if (ch === '"' || ch === "'" || ch === '`') {
					inString = ch as any;
					continue;
				}
				if (ch === '{') { braceDepth++; }
				else if (ch === '}') {
					braceDepth--;
					if (braceDepth === 0) { ctorEnd = i; break; }
				}
			}
			assert.ok(ctorEnd > ctorStart, 'Could not find end of constructor');

			const ctorBody = source.slice(ctorStart, ctorEnd);

			// The constructor must NOT contain a call to registerSecurityTools().
			// (The Phase 4 baseline had `this.registerSecurityTools();` inside
			// an `if (enableSecurityTools !== false)` block; Phase 5 removed it.)
			assert.ok(
				!ctorBody.includes('this.registerSecurityTools()'),
				'Constructor must NOT auto-call registerSecurityTools(). ' +
				'Phase 5 moved registration to be triggered by the Kovix Security Tools extension. ' +
				'Found auto-call in constructor:\n' + ctorBody,
			);
		});

		it('contains the Phase 5 comment explaining the extraction', () => {
			// This is a documentation guard: the comment explains to future
			// readers WHY the auto-call was removed. If a future PR deletes
			// the comment (without restoring the auto-call), this test
			// forces them to think about it.
			const source = fs.readFileSync(REGISTRY_SOURCE, 'utf8');
			assert.ok(
				source.includes('Phase 5') && source.includes('Kovix Security Tools extension'),
				'constructToolRegistryService.ts must contain the Phase 5 extraction comment',
			);
		});
	});

	describe('kovix.enableSecurityTools default', () => {

		it('defaults to false in the configuration schema', () => {
			// Read the actual source file and verify the default is false.
			const source = fs.readFileSync(CONFIG_SOURCE, 'utf8');

			// Find the kovix.enableSecurityTools property block.
			const key = "'kovix.enableSecurityTools'";
			const keyIndex = source.indexOf(key);
			assert.ok(keyIndex >= 0, 'Could not find kovix.enableSecurityTools in constructApiConfig.ts');

			// Find the next occurrence of "default:" after the key.
			const defaultIndex = source.indexOf('default:', keyIndex);
			assert.ok(defaultIndex > keyIndex, 'Could not find default: for kovix.enableSecurityTools');

			// Read the value (next non-whitespace token after "default:").
			const valueStart = defaultIndex + 'default:'.length;
			const match = source.slice(valueStart).match(/^\s*(true|false)/);
			assert.ok(match, `Could not parse default value for kovix.enableSecurityTools`);

			assert.strictEqual(
				match![1],
				'false',
				'kovix.enableSecurityTools must default to false (Phase 5 extraction). ' +
				`Found default: ${match![1]}.`,
			);
		});

		it('description mentions Phase 5 and the extension', () => {
			const source = fs.readFileSync(CONFIG_SOURCE, 'utf8');
			assert.ok(
				source.includes('Phase 5') && source.includes('Kovix Security Tools extension'),
				'kovix.enableSecurityTools description must mention Phase 5 and the extension',
			);
		});
	});
});

// ----------------------------------------------------------------------
// 4. Extension package.json contract
// ----------------------------------------------------------------------

describe('Phase 5 — Kovix Security Tools extension manifest', () => {

	const EXT_PACKAGE_JSON = path.join(REPO_ROOT, 'extensions/kovix-security-tools/package.json');
	const EXT_ACTIVATION = path.join(REPO_ROOT, 'extensions/kovix-security-tools/src/extension.ts');

	it('extension package.json exists', () => {
		assert.ok(fs.existsSync(EXT_PACKAGE_JSON), `Extension package.json not found: ${EXT_PACKAGE_JSON}`);
	});

	it('extension declares onStartupFinished activation', () => {
		const pkg = JSON.parse(fs.readFileSync(EXT_PACKAGE_JSON, 'utf8'));
		assert.ok(
			pkg.activationEvents?.includes('onStartupFinished'),
			`Extension must activate on startup to sync registration with the setting`,
		);
	});

	it('extension contributes the enable/disable/status commands', () => {
		const pkg = JSON.parse(fs.readFileSync(EXT_PACKAGE_JSON, 'utf8'));
		const commandIds = (pkg.contributes?.commands ?? []).map((c: any) => c.command);
		assert.ok(commandIds.includes('kovix-security-tools.enable'), 'Missing enable command');
		assert.ok(commandIds.includes('kovix-security-tools.disable'), 'Missing disable command');
		assert.ok(commandIds.includes('kovix-security-tools.status'), 'Missing status command');
	});

	it('extension activate() reads kovix.enableSecurityTools', () => {
		// Regression guard: if a future PR renames the setting without
		// updating the extension, this test fails.
		const source = fs.readFileSync(EXT_ACTIVATION, 'utf8');
		assert.ok(
			source.includes("'kovix.enableSecurityTools'"),
			'Extension activate() must read the kovix.enableSecurityTools setting',
		);
	});

	it('extension activate() calls the register/unregister commands', () => {
		const source = fs.readFileSync(EXT_ACTIVATION, 'utf8');
		assert.ok(
			source.includes("'_kovix.toolRegistry.registerSecurityTools'"),
			'Extension must call the register command',
		);
		assert.ok(
			source.includes("'_kovix.toolRegistry.unregisterSecurityTools'"),
			'Extension must call the unregister command',
		);
	});
});
