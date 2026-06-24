/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * verify-npmrc-target.js
 *
 * Fails the build LOUDLY when the `target=...` pin in .npmrc does not match
 * the actually-resolved Electron version. This is the structural guard against
 * the v1.8.0 bug, where .npmrc pinned `target="32.2.6"` while package.json
 * declared `electron: ^42.4.1` -- every native .node module ended up compiled
 * against Electron 32's ABI and then loaded by an Electron 42 runtime, which
 * crashes every renderer with ERR_DLOPEN_FAILED on Windows.
 *
 * Run this BEFORE the expensive build/package steps so the failure is fast.
 *
 * Exits 0 on success, 1 on mismatch (with an actionable message).
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

// --- 1. Read .npmrc target= pin ---
const npmrcPath = path.join(repoRoot, '.npmrc');
if (!fs.existsSync(npmrcPath)) {
	console.error(`ABORT: .npmrc not found at ${npmrcPath}`);
	process.exit(1);
}
const npmrc = fs.readFileSync(npmrcPath, 'utf8');
const targetMatch = npmrc.match(/^\s*target\s*=\s*"([^"]+)"\s*$/m);
if (!targetMatch) {
	console.error('ABORT: .npmrc does not contain a `target="..."` line.');
	console.error('       Native modules need this pin to build against the right Electron ABI.');
	process.exit(1);
}
const pinnedTarget = targetMatch[1];

// --- 2. Read resolved Electron version from node_modules ---
const electronPkgPath = path.join(repoRoot, 'node_modules', 'electron', 'package.json');
if (!fs.existsSync(electronPkgPath)) {
	console.error('ABORT: node_modules/electron not installed. Run `npm ci` first.');
	process.exit(1);
}
const electronPkg = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8'));
const resolvedVersion = electronPkg.version;

// --- 3. Compare ---
if (pinnedTarget !== resolvedVersion) {
	console.error('');
	console.error('========================================');
	console.error('  .npmrc target / Electron ABI MISMATCH');
	console.error('========================================');
	console.error(`  .npmrc target        = "${pinnedTarget}"`);
	console.error(`  resolved electron    = "${resolvedVersion}"`);
	console.error('');
	console.error('  Native .node modules built with this .npmrc will be loaded by a');
	console.error('  different Electron runtime, causing ERR_DLOPEN_FAILED at launch.');
	console.error('  This is exactly the v1.8.0 bug -- see CHANGELOG.md / v1.8.1 notes.');
	console.error('');
	console.error('  Fix: edit .npmrc and set target="' + resolvedVersion + '"');
	console.error('  (or run: node build/lib/sync-npmrc-target.js)');
	console.error('');
	process.exit(1);
}

console.log(`OK: .npmrc target matches resolved Electron version (${resolvedVersion})`);
