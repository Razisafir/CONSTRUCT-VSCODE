// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 3, item 3.6 — Air-gapped installer with bundled Ollama.
 *
 *  Offline installer that bundles Ollama + llama3.2 + nomic-embed-text.
 *  Works on machines with no internet — for regulated environments.
 *
 *  STATUS: Architecture stub. Helper functions only.
 *  The actual bundling is done by the electron-builder configuration.
 *
 *  Estimated effort to complete: 5-7 days
 *--------------------------------------------------------------------------------------------*/

/**
 * Configuration for the air-gapped installer.
 */
export interface IAirgapConfig {
	/** Ollama version to bundle */
	ollamaVersion: string;
	/** Models to bundle (offline) */
	bundledModels: Array<{ name: string; sizeMb: number; type: 'llm' | 'embedding' }>;
	/** Target platforms */
	platforms: Array<'win32-x64' | 'darwin-arm64' | 'darwin-x64' | 'linux-x64'>;
	/** Total installer size estimate (MB) */
	estimatedSizeMb: number;
}

/**
 * Default air-gapped config — bundles llama3.2 (small) + nomic-embed-text.
 */
export const DEFAULT_AIRGAP_CONFIG: IAirgapConfig = {
	ollamaVersion: '0.5.0',
	bundledModels: [
		{ name: 'llama3.2:1b', sizeMb: 1300, type: 'llm' },
		{ name: 'nomic-embed-text', sizeMb: 270, type: 'embedding' },
	],
	platforms: ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'],
	estimatedSizeMb: 2048, // ~2GB total
};

/**
 * Generate the install script for the bundled Ollama + models.
 *
 * Exported for unit testing.
 */
export function generateInstallScript(config: IAirgapConfig, platform: string): string {
	const isWindows = platform.startsWith('win32');
	const lines: string[] = [];
	lines.push(isWindows ? '@echo off' : '#!/bin/bash');
	lines.push('');
	lines.push('# Kovix air-gapped installer — bundles Ollama + models');
	lines.push('# Generated for platform: ' + platform);
	lines.push('');
	if (isWindows) {
		lines.push('echo Installing bundled Ollama...');
		lines.push('start /wait "" "%~dp0ollama-setup.exe" /S');
		lines.push('');
		lines.push('echo Loading bundled models...');
		for (const model of config.bundledModels) {
			lines.push(`ollama create ${model.name} -f "%~dp0models\${model.name.replace(':', '_')}.modelfile"`);
		}
	} else {
		lines.push('set -e');
		lines.push('echo "Installing bundled Ollama..."');
		lines.push('sudo dpkg -i "$(dirname "$0")/ollama.deb" || sudo installer -pkg "$(dirname "$0")/ollama.pkg" -target /');
		lines.push('');
		lines.push('echo "Loading bundled models..."');
		for (const model of config.bundledModels) {
			lines.push(`ollama create ${model.name} -f "$(dirname "$0")/models/${model.name.replace(':', '_')}.modelfile"`);
		}
	}
	lines.push('');
	lines.push(isWindows ? 'echo Kovix air-gapped setup complete.' : 'echo "Kovix air-gapped setup complete."');
	return lines.join('\n');
}

/**
 * Compute the total size of the installer in MB.
 *
 * Exported for unit testing.
 */
export function computeInstallerSizeMb(config: IAirgapConfig): number {
	// Ollama binary (~150 MB) + model sizes
	const ollamaBinaryMb = 150;
	const modelsMb = config.bundledModels.reduce((sum, m) => sum + m.sizeMb, 0);
	return ollamaBinaryMb + modelsMb;
}

/**
 * Generate a manifest file listing all bundled artifacts.
 *
 * Exported for unit testing.
 */
export function generateManifest(config: IAirgapConfig): Record<string, unknown> {
	return {
		version: '1.0.0',
		ollamaVersion: config.ollamaVersion,
		platforms: config.platforms,
		artifacts: [
			{ name: 'ollama', type: 'binary', version: config.ollamaVersion },
			...config.bundledModels.map(m => ({
				name: m.name,
				type: m.type,
				sizeMb: m.sizeMb,
			})),
		],
		totalSizeMb: computeInstallerSizeMb(config),
		generatedAt: new Date().toISOString(),
	};
}
