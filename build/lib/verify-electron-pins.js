/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * verify-electron-pins.js
 *
 * Verifies the FULL Electron version pin chain is internally consistent:
 *
 *   1. package.json: "electron" field -- the version we declare as a dep
 *   2. .npmrc: target="..." -- the ABI native modules compile against
 *   3. build/checksums/electron.txt -- SHASUMS256 file for the pinned version
 *   4. .nvmrc -- Node version used for dev/build (must be compatible with Electron major)
 *
 * Why this exists:
 *   v1.8.0 shipped with .npmrc target="32.2.6" but package.json electron "^42.4.1"
 *   (resolved to 42.4.1) -- every native module ended up built against the wrong
 *   ABI. v1.8.1 fixed .npmrc + added verify-npmrc-target.js, but that only catches
 *   one link of the chain. This script catches the rest:
 *
 *     - If someone bumps package.json electron but forgets build/checksums/electron.txt
 *       -> checksum verification against the wrong SHASUMS256 file will pass on
 *         hashes that don't actually correspond to the installed Electron.
 *     - If someone bumps Electron major (e.g. 42 -> 44) but forgets .nvmrc ->
 *       the dev Node version may be too old to build native modules for the
 *       new Electron's expected Node-API version.
 *     - If package.json electron uses "^42.4.1" (caret) and a future `npm install`
 *       drifts to 42.5.0, the .npmrc target will silently drift out of sync.
 *
 * Exits 0 on success, 1 on any mismatch (with an actionable message).
 *
 * Run after `npm ci` (so node_modules/electron exists) and before any
 * compile/package step. Can be run manually:
 *   node build/lib/verify-electron-pins.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

let failures = 0;
function fail(msg) {
        console.error(`  FAIL: ${msg}`);
        failures++;
}
function ok(msg) {
        console.log(`  OK:   ${msg}`);
}

console.log('');
console.log('Verifying Electron version pin chain...');
console.log('');

// --- 1. Read Electron version from package.json (devDependencies.electron) ---
// Note: VS Code forks pin Electron in devDependencies (not the top-level "electron"
// field, which is a script command: "node build/lib/electron"). The v1.8.1 hotfix
// pinned devDependencies.electron to an exact "42.4.1" (no caret) to prevent drift.
const pkgJsonPath = path.join(repoRoot, 'package.json');
if (!fs.existsSync(pkgJsonPath)) {
        console.error(`ABORT: package.json not found at ${pkgJsonPath}`);
        process.exit(1);
}
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
const pkgElectron = pkgJson.devDependencies && pkgJson.devDependencies.electron;
if (!pkgElectron) {
        fail('package.json devDependencies.electron is missing -- Electron version must be pinned here.');
} else if (pkgElectron.startsWith('^') || pkgElectron.startsWith('~')) {
        fail(`package.json devDependencies.electron is "${pkgElectron}" -- caret/tilde allows silent drift. Pin exact version (e.g. "42.4.1").`);
} else {
        ok(`package.json devDependencies.electron = "${pkgElectron}" (exact pin)`);
}

// --- 2. Read .npmrc target= pin ---
const npmrcPath = path.join(repoRoot, '.npmrc');
if (!fs.existsSync(npmrcPath)) {
        console.error(`ABORT: .npmrc not found at ${npmrcPath}`);
        process.exit(1);
}
const npmrc = fs.readFileSync(npmrcPath, 'utf8');
const targetMatch = npmrc.match(/^\s*target\s*=\s*"([^"]+)"\s*$/m);
if (!targetMatch) {
        fail('.npmrc does not contain a `target="..."` line. Native modules need this pin to build against the right Electron ABI.');
} else {
        const pinnedTarget = targetMatch[1];
        ok(`.npmrc target = "${pinnedTarget}"`);
        if (pkgElectron && pinnedTarget !== pkgElectron) {
                fail(`.npmrc target ("${pinnedTarget}") does not match package.json electron ("${pkgElectron}"). Native modules will be built against the wrong ABI.`);
        }
}

// --- 3. Read resolved Electron version from node_modules/electron ---
const electronPkgPath = path.join(repoRoot, 'node_modules', 'electron', 'package.json');
let resolvedVersion = null;
if (!fs.existsSync(electronPkgPath)) {
        fail('node_modules/electron not installed. Run `npm ci` first. (Skipping resolved-version checks.)');
} else {
        const electronPkg = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8'));
        resolvedVersion = electronPkg.version;
        ok(`node_modules/electron version = "${resolvedVersion}"`);
        if (pkgElectron && resolvedVersion !== pkgElectron) {
                fail(`package.json electron ("${pkgElectron}") does not match node_modules/electron ("${resolvedVersion}"). Run \`npm install\` to resync.`);
        }
        if (targetMatch && targetMatch[1] !== resolvedVersion) {
                fail(`.npmrc target ("${targetMatch[1]}") does not match resolved Electron ("${resolvedVersion}"). This is the v1.8.0 bug -- see verify-npmrc-target.js.`);
        }
}

// --- 4. Verify build/checksums/electron.txt is for the pinned version ---
const checksumsPath = path.join(repoRoot, 'build', 'checksums', 'electron.txt');
if (!fs.existsSync(checksumsPath)) {
        fail('build/checksums/electron.txt not found. This file holds the official SHASUMS256 for the pinned Electron version.');
} else {
        const checksums = fs.readFileSync(checksumsPath, 'utf8');
        const versionToCheck = resolvedVersion || pkgElectron;
        if (!versionToCheck) {
                fail('Cannot verify checksums file -- no Electron version known (package.json missing electron field and node_modules/electron not installed).');
        } else {
                const expectedPrefix = `v${versionToCheck}`;
                const linesReferencingVersion = checksums
                        .split('\n')
                        .filter(l => l.includes(expectedPrefix)).length;
                if (linesReferencingVersion === 0) {
                        fail(`build/checksums/electron.txt contains ZERO entries for Electron ${expectedPrefix}. The file is for the wrong version. Fetch the real SHASUMS256.txt from https://github.com/electron/electron/releases/download/${expectedPrefix}/SHASUMS256.txt`);
                } else {
                        ok(`build/checksums/electron.txt has ${linesReferencingVersion} entries for Electron ${expectedPrefix}`);
                        // Also check no stale entries from a different version remain
                        const allVersionMatches = checksums.match(/v\d+\.\d+\.\d+/g) || [];
                        const uniqueVersions = [...new Set(allVersionMatches)];
                        if (uniqueVersions.length > 1) {
                                fail(`build/checksums/electron.txt references multiple Electron versions: ${uniqueVersions.join(', ')}. Should reference only v${versionToCheck}.`);
                        }
                }
        }
}

// --- 5. Verify .nvmrc Node version is compatible with Electron major ---
const nvmrcPath = path.join(repoRoot, '.nvmrc');
if (!fs.existsSync(nvmrcPath)) {
        fail('.nvmrc not found. Dev Node version should be pinned for reproducible native module builds.');
} else {
        const nvmrc = fs.readFileSync(nvmrcPath, 'utf8').trim();
        const nodeMatch = nvmrc.match(/^v?(\d+)\.(\d+)\.(\d+)/);
        if (!nodeMatch) {
                fail(`.nvmrc content "${nvmrc}" is not a recognizable Node version.`);
        } else {
                const nodeMajor = parseInt(nodeMatch[1], 10);
                const nodeMinor = parseInt(nodeMatch[2], 10);
                const nodePatch = parseInt(nodeMatch[3], 10);
                ok(`.nvmrc Node version = "${nvmrc}" (v${nodeMajor}.${nodeMinor}.${nodePatch})`);

                // Determine Electron major to check compatibility
                const electronVersionToCheck = resolvedVersion || pkgElectron;
                if (electronVersionToCheck) {
                        const electronMajorMatch = electronVersionToCheck.match(/^(\d+)/);
                        if (electronMajorMatch) {
                                const electronMajor = parseInt(electronMajorMatch[1], 10);

                                // Electron embeds Node.js as its runtime. For Electron 42+,
                                // the embedded Node is 22.x. Dev/build should use Node 22.x+
                                // (>=22.12.0 is the LTS minor recommended for Electron 42).
                                //
                                // General rule: Electron N embeds Node (N-20).x -- e.g.
                                //   Electron 32 -> Node 20.x
                                //   Electron 38 -> Node 22.x (Node 22 LTS aligned with Electron 38+)
                                //   Electron 42 -> Node 22.x (still 22.x; Electron 42 is on Node 22.20.0)
                                // For dev/build safety, require Node major >= embedded major.
                                const expectedNodeMajor = electronMajor >= 38 ? 22 : 20;
                                const minNodeMinor = expectedNodeMajor === 22 ? 12 : 18;
                                const minNodePatch = 0;

                                if (nodeMajor < expectedNodeMajor) {
                                        fail(`.nvmrc Node v${nodeMajor}.${nodeMinor}.${nodePatch} is too old for Electron ${electronMajor}. Electron ${electronMajor} embeds Node ${expectedNodeMajor}.x -- dev Node must be >= v${expectedNodeMajor}.${minNodeMinor}.${minNodePatch}.`);
                                } else if (nodeMajor === expectedNodeMajor && nodeMinor < minNodeMinor) {
                                        fail(`.nvmrc Node v${nodeMajor}.${nodeMinor}.${nodePatch} is too old for Electron ${electronMajor}. Required: >= v${expectedNodeMajor}.${minNodeMinor}.${minNodePatch}.`);
                                } else {
                                        ok(`.nvmrc Node v${nodeMajor}.${nodeMinor}.${nodePatch} is compatible with Electron ${electronMajor} (requires Node >= v${expectedNodeMajor}.${minNodeMinor}.${minNodePatch})`);
                                }
                        }
                }
        }
}

// --- Final verdict ---
console.log('');
if (failures === 0) {
        console.log('PASS: Electron version pin chain is internally consistent.');
        console.log('');
        process.exit(0);
} else {
        console.error(`FAIL: ${failures} pin-chain mismatch(es) found.`);
        console.error('');
        console.error('Native modules built with an inconsistent pin chain will crash at launch');
        console.error('with ERR_DLOPEN_FAILED. See CHANGELOG.md v1.8.1 for the v1.8.0 postmortem.');
        console.error('');
        process.exit(1);
}
