// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 3, item 3.5 — Kali Linux integration pack.
 *
 *  One-click Kali WSL2 setup; pre-configured MCP servers for common pentest
 *  tools. Aimed at security researchers who use Kovix as their daily driver.
 *
 *  STATUS: Architecture stub. Configuration templates and helper functions
 *  only. The actual WSL2 provisioning is left as future work.
 *
 *  Estimated effort to complete: 4-6 days
 *--------------------------------------------------------------------------------------------*/

/**
 * Kali WSL2 installation profile.
 */
export interface IKaliProfile {
	id: string;
	name: string;
	description: string;
	/** WSL2 distribution name */
	distribution: string;
	/** Packages to install via apt */
	packages: string[];
	/** MCP servers to register */
	mcpServers: Array<{ name: string; command: string; args: string[] }>;
	/** Tools to expose to the agent */
	agentTools: string[];
	/** Setup script (bash) to run inside WSL2 */
	setupScript: string;
}

/**
 * Default Kali profile — common pentest tools.
 */
export const DEFAULT_KALI_PROFILE: IKaliProfile = {
	id: 'kali-default',
	name: 'Kali Linux (Default)',
	description: 'Standard Kali Linux pentest distribution with nmap, nuclei, sqlmap, and other common tools.',
	distribution: 'kali-linux',
	packages: [
		'nmap',
		'nuclei',
		'sqlmap',
		'gobuster',
		'ffuf',
		'hydra',
		'john',
		'hashcat',
		'wireshark',
		'tshark',
		'tcpdump',
		'netcat-traditional',
		'socat',
		'burpsuite',
		'metasploit-framework',
	],
	mcpServers: [
		{
			name: 'kali-nmap',
			command: 'wsl',
			args: ['-d', 'kali-linux', '--', 'nmap-mcp-server'],
		},
		{
			name: 'kali-nuclei',
			command: 'wsl',
			args: ['-d', 'kali-linux', '--', 'nuclei-mcp-server'],
		},
	],
	agentTools: [
		'nmap_scan',
		'nuclei_scan',
		'sqlmap_scan',
		'gobuster_scan',
		'ffuf_scan',
	],
	setupScript: `#!/bin/bash
# Kali Linux setup script — runs inside WSL2
set -e

echo "Updating package lists..."
sudo apt update

echo "Installing pentest tools..."
sudo apt install -y nmap nuclei sqlmap gobuster ffuf hydra john hashcat wireshark tshark tcpdump netcat-traditional socat

echo "Installing MCP server bridges..."
pip install nmap-mcp-server nuclei-mcp-server

echo "Kali setup complete."
`,
};

/**
 * Check whether WSL2 is available (Windows only).
 *
 * Exported for unit testing (mocked).
 */
export function isWsl2Available(): boolean {
	// TODO: Actually check `wsl --status` on Windows
	// For now, return false — this is a stub.
	return false;
}

/**
 * Check whether the Kali distribution is installed in WSL2.
 *
 * Exported for unit testing (mocked).
 */
export function isKaliInstalled(): boolean {
	// TODO: Actually check `wsl -l -v` for kali-linux
	return false;
}

/**
 * Generate the WSL2 install command for the Kali distribution.
 *
 * Exported for unit testing.
 */
export function buildKaliInstallCommand(): string {
	return 'wsl --install -d kali-linux';
}

/**
 * Generate the command to run the setup script inside WSL2.
 *
 * Exported for unit testing.
 */
export function buildSetupCommand(profile: IKaliProfile, scriptPath: string): string {
	return `wsl -d ${profile.distribution} -- bash ${scriptPath}`;
}
