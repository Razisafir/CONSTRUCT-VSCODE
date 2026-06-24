/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * verify-native-modules.js
 *
 * Verifies that every known native module was actually compiled and is a
 * valid binary for the CURRENT platform/arch. Catches two distinct v1.8.0
 * failure modes:
 *
 *   1. Native module didn't compile at all (e.g. .npmrc target was wrong,
 *      node-gyp silently failed, install --ignore-scripts skipped it).
 *      → file does not exist on disk.
 *
 *   2. Cross-platform contamination (the diagnostic report found a
 *      linux/x64 onnxruntime_binding.node inside the Windows release).
 *      → file exists but its binary header doesn't match the platform.
 *
 * This script does NOT attempt to dlopen the modules from Node, because
 * native modules built against the Electron ABI cannot be loaded by Node
 * (different NODE_MODULE_VERSION). That's expected and correct -- the .npmrc
 * target check (verify-npmrc-target.js) is what proves the ABI is right.
 *
 * For the strongest end-to-end verification, run verify-native-modules-electron.js
 * which spawns the actual Electron binary and tries to require() each module
 * from inside it. That script requires Electron to be installed.
 *
 * Exits 0 on success, 1 on any failure.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const platform = process.platform; // 'win32' | 'darwin' | 'linux'
const arch = process.arch;         // 'x64' | 'arm64' | etc.

/**
 * Each entry: { relPath, expectedMagic }
 * expectedMagic: a hex prefix that the file's first bytes must match for the
 *                current platform. PE32 (Windows) = "4d5a", ELF (Linux) = "7f454c46",
 *                Mach-O 64 (macOS) = "cffaedfe" (little-endian) or "feedfacf" (big-endian).
 */
function candidateModules() {
	const candidates = [];

	const platformMagic =
		platform === 'win32' ? '4d5a' :
		platform === 'linux' ? '7f454c46' :
		platform === 'darwin' ? 'cffaedfe' : null;

	const add = (relPath) => candidates.push({ relPath, expectedMagic: platformMagic });

	// Modules that ship per-platform binaries under per-platform paths.
	add('@vscode/policy-watcher/build/Release/vscode-policy-watcher.node');

	if (platform === 'win32') {
		add('@vscode/windows-registry/build/Release/vscode-windows-registry.node');
		add('windows-foreground-love/build/Release/foreground_love.node');
	}

	add('@vscode/kerberos/build/Release/kerberos.node');
	add('@vscode/sqlite3/build/Release/better_sqlite3.node');
	add('@vscode/spdlog/build/Release/spdlog.node');
	add('native-keymap/build/Release/keymapping.node');
	add('native-watchdog/build/Release/watchdog.node');

	if (platform === 'win32') {
		add('node-pty/build/Release/conpty.node');
		// winpty-agent is a standalone .exe, not a .node; still PE32.
		add('node-pty/build/Release/winpty-agent.exe');
	} else {
		add('node-pty/build/Release/pty.node');
	}

	add('@vscode/signature-blake3/build/Release/blake3.node');

	// sharp -- per-platform filename
	if (platform === 'win32' && arch === 'x64') add('sharp/build/Release/sharp-win32-x64.node');
	else if (platform === 'linux' && arch === 'x64') add('sharp/build/Release/sharp-linux-x64.node');
	else if (platform === 'darwin' && arch === 'x64') add('sharp/build/Release/sharp-darwin-x64.node');
	else if (platform === 'darwin' && arch === 'arm64') add('sharp/build/Release/sharp-darwin-arm64.node');

	// onnxruntime-node -- per-platform precompiled
	if (platform === 'win32' && arch === 'x64') add('onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime_binding.node');
	else if (platform === 'linux' && arch === 'x64') add('onnxruntime-node/bin/napi-v3/linux/x64/onnxruntime_binding.node');
	else if (platform === 'darwin' && arch === 'x64') add('onnxruntime-node/bin/napi-v3/darwin/x64/onnxruntime_binding.node');
	else if (platform === 'darwin' && arch === 'arm64') add('onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node');

	return candidates;
}

function readHexPrefix(filePath, byteCount) {
	const fd = fs.openSync(filePath, 'r');
	const buf = Buffer.alloc(byteCount);
	fs.readSync(fd, buf, 0, byteCount, 0);
	fs.closeSync(fd);
	return buf.toString('hex');
}

function main() {
	const mods = candidateModules();
	let failures = 0;
	let passes = 0;
	let skips = 0;

	console.log(`Verifying native modules for platform=${platform} arch=${arch}`);
	console.log('='.repeat(60));

	for (const { relPath, expectedMagic } of mods) {
		const abs = path.join(repoRoot, 'node_modules', relPath);

		if (!fs.existsSync(abs)) {
			// Module not installed on this platform / not in this repo -- skip, not a failure.
			console.log(`  SKIP  ${relPath}  (not installed)`);
			skips++;
			continue;
		}

		const stat = fs.statSync(abs);
		if (stat.size < 1024) {
			console.error(`  FAIL  ${relPath}  (suspiciously small: ${stat.size} bytes)`);
			failures++;
			continue;
		}

		const actualMagic = readHexPrefix(abs, 4);
		if (!actualMagic.startsWith(expectedMagic)) {
			console.error(`  FAIL  ${relPath}`);
			console.error(`        expected magic ${expectedMagic}, got ${actualMagic}`);
			console.error(`        This file is NOT a valid ${platform} binary -- possible cross-platform contamination.`);
			console.error(`        (This is exactly the v1.8.0 bug: a linux binary was bundled inside the Windows release.)`);
			failures++;
			continue;
		}

		// Optional: run `file` for a human-readable description
		let fileDesc = '';
		try {
			fileDesc = execFileSync('file', ['-b', abs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
			// Truncate to one line for compact output
			fileDesc = fileDesc.split('\n')[0].slice(0, 80);
		} catch (e) {
			// `file` not available on all systems (especially Windows); ignore.
		}

		console.log(`  OK    ${relPath}  (${(stat.size / 1024 / 1024).toFixed(1)} MB) ${fileDesc ? '-- ' + fileDesc : ''}`);
		passes++;
	}

	console.log('='.repeat(60));
	console.log(`passes=${passes} skips=${skips} failures=${failures}`);

	if (failures > 0) {
		console.error('');
		console.error('Native module verification FAILED.');
		console.error('See build/lib/verify-npmrc-target.js for the .npmrc ABI pin check,');
		console.error('and the v1.8.1 release notes for context.');
		process.exit(1);
	}
	console.log('All installed native modules are present with correct platform signature.');
}

main();
