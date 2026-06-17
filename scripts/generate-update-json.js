#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * generate-update-json.js
 *
 * Generates the update.json manifest for the Kovix IDE update server.
 * Reads built artifacts from a directory, computes SHA256 hashes, and
 * writes the final update.json to docs/update.json.
 *
 * Usage:
 *   node scripts/generate-update-json.js <version> <artifacts-dir>
 *
 * Example:
 *   node scripts/generate-update-json.js 1.0.0 out/
 *   node scripts/generate-update-json.js 2.1.3 .build/
 *
 * The script expects artifact files matching these patterns in the artifacts directory:
 *   - Kovix-darwin-x64.zip        (macOS Intel)
 *   - Kovix-darwin-arm64.zip      (macOS Apple Silicon)
 *   - kovix_<version>_amd64.deb   (Linux x64)
 *   - KovixSetup-x64.exe          (Windows x64)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GITHUB_OWNER = 'Razisafir';
const GITHUB_REPO = 'KOVIX';

/**
 * Maps platform keys to artifact filename matchers and release URL patterns.
 * Each entry has:
 *   - pattern: RegExp to match the artifact file in the artifacts directory
 *   - urlTemplate: function(version, filename) => download URL
 */
const PLATFORMS = {
  'darwin-x64': {
    pattern: /^Kovix-darwin-x64\.zip$/,
    urlTemplate: (version, filename) =>
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${filename}`,
  },
  'darwin-arm64': {
    pattern: /^Kovix-darwin-arm64\.zip$/,
    urlTemplate: (version, filename) =>
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${filename}`,
  },
  'linux-x64': {
    pattern: /^kovix_.*_amd64\.deb$/,
    urlTemplate: (version, filename) =>
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${filename}`,
  },
  'win32-x64': {
    pattern: /^KovixSetup-x64\.exe$/,
    urlTemplate: (version, filename) =>
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${filename}`,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the SHA256 hash of a file.
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Hex-encoded SHA256 hash.
 */
function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Validate that a version string looks like a semver version.
 * @param {string} version
 */
function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw new Error(
      `Invalid version "${version}". Expected semver format like "1.0.0" or "2.0.0-beta.1".`
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node scripts/generate-update-json.js <version> <artifacts-dir>');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/generate-update-json.js 1.0.0 out/');
    process.exit(1);
  }

  const version = args[0];
  const artifactsDir = path.resolve(args[1]);

  // Validate inputs
  validateVersion(version);

  if (!fs.existsSync(artifactsDir)) {
    throw new Error(`Artifacts directory not found: ${artifactsDir}`);
  }

  console.log(`Generating update.json for version ${version}`);
  console.log(`Scanning artifacts directory: ${artifactsDir}`);

  // List all files in the artifacts directory
  const artifactFiles = fs.readdirSync(artifactsDir).filter((name) => {
    const fullPath = path.join(artifactsDir, name);
    return fs.statSync(fullPath).isFile();
  });

  console.log(`Found ${artifactFiles.length} file(s) in artifacts directory`);

  // Match artifacts to platforms and compute hashes
  const products = {};

  for (const [platform, config] of Object.entries(PLATFORMS)) {
    const matchedFile = artifactFiles.find((name) => config.pattern.test(name));

    if (matchedFile) {
      const filePath = path.join(artifactsDir, matchedFile);
      console.log(`  ${platform}: matched "${matchedFile}" — computing SHA256...`);

      const sha256hash = await computeSha256(filePath);
      const url = config.urlTemplate(version, matchedFile);

      products[platform] = {
        url,
        sha256hash,
      };

      console.log(`    URL:   ${url}`);
      console.log(`    SHA256: ${sha256hash}`);
    } else {
      console.warn(`  ${platform}: no matching artifact found (expected pattern: ${config.pattern})`);
    }
  }

  // Build the update manifest
  const updateManifest = {
    id: 'kovix',
    version,
    name: 'Kovix IDE',
    quality: 'stable',
    products,
  };

  // Determine output path — always write to docs/update.json relative to project root
  const projectRoot = path.resolve(__dirname, '..');
  const docsDir = path.join(projectRoot, 'docs');
  const outputPath = path.join(docsDir, 'update.json');

  // Ensure docs/ directory exists
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  // Write the manifest with 2-space indentation
  const jsonContent = JSON.stringify(updateManifest, null, 2) + '\n';
  fs.writeFileSync(outputPath, jsonContent, 'utf8');

  console.log('');
  console.log(`update.json written to: ${outputPath}`);
  console.log(`Platforms included: ${Object.keys(products).join(', ') || '(none)'}`);

  if (Object.keys(products).length === 0) {
    console.warn('');
    console.warn('WARNING: No artifacts were matched. The update.json will have an empty products map.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Error generating update.json:', err.message);
  process.exit(1);
});
