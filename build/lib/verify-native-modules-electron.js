/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * verify-native-modules-electron.js
 *
 * Gold-standard end-to-end check: spawn the actual Electron binary that
 * ships with Kovix, require() each known native module from inside it, and
 * fail loudly if any throws ERR_DLOPEN_FAILED or an ABI mismatch error.
 *
 * This is the test the v1.8.0 release needed and didn't have. The diagnostic
 * report found that EVERY native module in the v1.8.0 Windows release threw
 * ERR_DLOPEN_FAILED at launch because .npmrc pinned Electron 32 while
 * package.json declared Electron 42. This script would have caught that at
 * build time instead of letting users find it.
 *
 * Usage:
 *   node build/lib/verify-native-modules-electron.js
 *
 * Requires: node_modules/electron installed (it is, after `npm ci`).
 *
 * In CI: run this AFTER `npm ci` and the .npmrc target check, BEFORE the
 * packaging gulp tasks. Add as a workflow step:
 *
 *   - name: Verify native modules load inside Electron
 *     shell: bash
 *     run: node build/lib/verify-native-modules-electron.js
 *
 * Note: on Linux CI runners without a display, this script uses
 * `--disable-gpu --no-sandbox` and avoids opening a window -- it only needs
 * the main process to be able to dlopen native modules, which works headless.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const electronBinDir = path.join(repoRoot, 'node_modules', '.bin');

// Find the Electron binary.
function findElectron() {
	const candidates = process.platform === 'win32'
		? ['electron.cmd', 'electron.exe', 'electron']
		: ['electron'];
	for (const c of candidates) {
		const p = path.join(electronBinDir, c);
		if (fs.existsSync(p)) return p;
	}
	// Fall back to the dist path Electron publishes in its package.json
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules/electron/package.json'), 'utf8'));
		if (pkg.main && fs.existsSync(path.join(repoRoot, 'node_modules/electron', pkg.main))) {
			return path.join(repoRoot, 'node_modules/electron', pkg.main);
		}
	} catch (_) { /* ignore */ }
	return null;
}

// The probe script runs INSIDE Electron's main process. It writes its result
// to a temp file (because Electron's stdout can be noisy with GPU warnings).
const PROBE_SCRIPT = `
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const resultFile = process.env.KOVIX_NATIVE_PROBE_RESULT;
const mods = JSON.parse(process.env.KOVIX_NATIVE_PROBE_MODS);

const results = [];
let failures = 0;

for (const m of mods) {
  try {
    require(m);
    results.push({ mod: m, status: 'ok' });
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    results.push({ mod: m, status: 'fail', reason: msg });
    failures++;
  }
}

fs.writeFileSync(resultFile, JSON.stringify({ results, failures }, null, 2));

// Exit Electron
app.whenReady().then(() => app.exit(failures > 0 ? 1 : 0));
`;

function main() {
	const electronPath = findElectron();
	if (!electronPath) {
		console.error('SKIP: electron binary not found in node_modules/.bin');
		console.error('      (This is OK if ELECTRON_SKIP_BINARY_DOWNLOAD=1 was set.)');
		console.error('      This check requires Electron to be installed.');
		// Don't fail -- let the caller decide if this is fatal. In CI for the
		// main release path, Electron IS installed, so this will run.
		process.exit(0);
	}

	// List modules to probe (these are the modules whose main entry requires the .node)
	const modsToProbe = [
		'@vscode/policy-watcher',
		'@vscode/sqlite3',
		'@vscode/kerberos',
		'@vscode/spdlog',
		'native-keymap',
		'native-watchdog',
		'sharp',
		'onnxruntime-node',
	];
	if (process.platform === 'win32') {
		modsToProbe.push('@vscode/windows-registry');
		modsToProbe.push('windows-foreground-love');
	}

	const probeScriptPath = path.join(repoRoot, '.tmp-native-probe.js');
	const resultFile = path.join(repoRoot, '.tmp-native-probe-result.json');
	fs.writeFileSync(probeScriptPath, PROBE_SCRIPT);

	const env = {
		...process.env,
		KOVIX_NATIVE_PROBE_RESULT: resultFile,
		KOVIX_NATIVE_PROBE_MODS: JSON.stringify(modsToProbe),
		ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
		ELECTRON_ENABLE_LOGGING: '0',
	};

	const args = [probeScriptPath, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
	console.log(`Spawning Electron to load ${modsToProbe.length} native modules...`);
	console.log(`  electron: ${electronPath}`);

	const result = spawnSync(electronPath, args, {
		env,
		cwd: repoRoot,
		encoding: 'utf8',
		timeout: 120000, // 2 minutes
		stdio: 'pipe',
	});

	// Clean up probe script
	try { fs.unlinkSync(probeScriptPath); } catch (_) {}

	let probeResult = null;
	try {
		probeResult = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
		try { fs.unlinkSync(resultFile); } catch (_) {}
	} catch (e) {
		console.error('FAIL: Electron probe did not write a result file.');
		console.error('Electron exit code:', result.status);
		console.error('Electron stdout:', (result.stdout || '').slice(-2000));
		console.error('Electron stderr:', (result.stderr || '').slice(-2000));
		process.exit(1);
	}

	console.log('='.repeat(60));
	let passes = 0, failures = 0;
	for (const r of probeResult.results) {
		if (r.status === 'ok') {
			console.log(`  OK    ${r.mod}`);
			passes++;
		} else {
			console.error(`  FAIL  ${r.mod}`);
			console.error(`        ${r.reason}`);
			failures++;
		}
	}
	console.log('='.repeat(60));
	console.log(`passes=${passes} failures=${failures}`);

	if (failures > 0 || probeResult.failures > 0) {
		console.error('');
		console.error('Native module load verification (Electron) FAILED.');
		console.error('This is the v1.8.0 bug class -- every renderer would crash with ERR_DLOPEN_FAILED.');
		process.exit(1);
	}
	console.log('All native modules loaded successfully inside Electron.');
}

main();
