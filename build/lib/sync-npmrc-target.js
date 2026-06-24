/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * sync-npmrc-target.js
 *
 * One-shot helper: rewrites .npmrc so that `target="..."` matches the
 * actually-resolved Electron version in node_modules/electron.
 *
 * Use this after bumping Electron in package.json. Run `npm install` first so
 * the new Electron is actually present in node_modules, then run this script.
 *
 * After running, commit the updated .npmrc alongside the package.json change.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const npmrcPath = path.join(repoRoot, '.npmrc');
const electronPkgPath = path.join(repoRoot, 'node_modules', 'electron', 'package.json');

if (!fs.existsSync(electronPkgPath)) {
	console.error('ABORT: node_modules/electron not installed. Run `npm install` first.');
	process.exit(1);
}
const { version } = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8'));

if (!fs.existsSync(npmrcPath)) {
	console.error(`ABORT: .npmrc not found at ${npmrcPath}`);
	process.exit(1);
}

const before = fs.readFileSync(npmrcPath, 'utf8');
const after = before.replace(
	/^(\s*target\s*=\s*")([^"]+)("\s*)$/m,
	`$1${version}$3`
);

if (before === after) {
	console.error(`ABORT: no \`target="..." line found in .npmrc -- nothing to sync.`);
	process.exit(1);
}

fs.writeFileSync(npmrcPath, after);
console.log(`.npmrc target updated to "${version}"`);
