// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

/**
 * Kali Linux Detector — determines whether Kali Linux is available
 * on the current system and in what form (native, WSL, Docker).
 *
 * Also provides `validateScanTarget()` to block scanning of
 * localhost / loopback / common router IPs.
 */

// ─── Types ───────────────────────────────────────────────────────────────────────

/** How Kali Linux is running on this machine */
export type KaliEnvironment = 'native' | 'wsl' | 'docker' | 'unavailable';

/** Full detection result returned by `detectKaliLinux()` */
export interface IKaliDetectionResult {
	/** Whether any Kali environment was detected */
	available: boolean;
	/** The type of Kali environment found */
	environment: KaliEnvironment;
	/** Command prefix needed to run tools (e.g. `wsl -d kali-linux --`) */
	commandPrefix: string;
	/** Human-readable description of the detected environment */
	description: string;
	/** Whether Docker is available on the system (even if Kali image is not pulled) */
	dockerAvailable: boolean;
}

// ─── Detection ───────────────────────────────────────────────────────────────────

/**
 * Detect whether Kali Linux is available on the current system.
 *
 * Checks in order:
 *  1. **Native** — reads `/etc/os-release` for `ID=kali`
 *  2. **WSL**    — runs `wsl.exe -l -v` on Windows
 *  3. **Docker**  — checks `docker --version` and `docker images kalilinux/kali-rolling`
 *
 * Uses dynamic `import()` for Node.js APIs so the module is safe to
 * import from browser contexts (the imports simply fail gracefully).
 */
export async function detectKaliLinux(): Promise<IKaliDetectionResult> {
	const unavailable: IKaliDetectionResult = {
		available: false,
		environment: 'unavailable',
		commandPrefix: '',
		description: 'Kali Linux not detected',
		dockerAvailable: false,
	};

	let dockerAvailable = false;

	// ── 1. Native Linux ───────────────────────────────────────────────────────
	try {
		const fs = await import('fs');
		const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
		if (osRelease.includes('ID=kali')) {
			const nameMatch = osRelease.match(/^NAME="?(.+?)"?$/m);
			const name = nameMatch ? nameMatch[1] : 'Kali Linux';

			// Also check docker while we're at it
			dockerAvailable = await checkDockerAvailable();

			return {
				available: true,
				environment: 'native',
				commandPrefix: '',
				description: `${name} (native installation)`,
				dockerAvailable,
			};
		}
	} catch {
		// Not on native Linux or /etc/os-release not readable
	}

	// ── 2. WSL on Windows ─────────────────────────────────────────────────────
	try {
		const childProcess = await import('child_process');
		const result = childProcess.execSync('wsl.exe -l -v', {
			encoding: 'utf8',
			timeout: 10000,
			windowsHide: true,
		});
		const normalised = result.replace(/\0/g, '').toLowerCase();
		if (normalised.includes('kali-linux') || normalised.includes('kali')) {
			dockerAvailable = await checkDockerAvailable();
			return {
				available: true,
				environment: 'wsl',
				commandPrefix: 'wsl -d kali-linux --',
				description: 'Kali Linux (WSL)',
				dockerAvailable,
			};
		}
	} catch {
		// WSL not available or not on Windows
	}

	// ── 3. Docker ─────────────────────────────────────────────────────────────
	dockerAvailable = await checkDockerAvailable();
	if (dockerAvailable) {
		try {
			const childProcess = await import('child_process');
			const images = childProcess.execSync(
				'docker images kalilinux/kali-rolling --format "{{.Repository}}"',
				{ encoding: 'utf8', timeout: 15000 }
			);
			if (images.trim().length > 0) {
				return {
					available: true,
					environment: 'docker',
					commandPrefix: 'docker run --rm kalilinux/kali-rolling',
					description: 'Kali Linux (Docker)',
					dockerAvailable: true,
				};
			}
		} catch {
			// Docker available but Kali image not pulled
		}
	}

	// ── Nothing found ─────────────────────────────────────────────────────────
	unavailable.dockerAvailable = dockerAvailable;
	return unavailable;
}

// ─── Target Validation ───────────────────────────────────────────────────────────

/** Hostnames that must never be scanned */
const BLOCKED_HOSTNAMES = new Set([
	'localhost',
]);

/** IPv4 / IPv6 patterns that are always blocked */
const BLOCKED_IP_PATTERNS: RegExp[] = [
	/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,   // 127.x.x.x (loopback block)
	/^0\.0\.0\.0$/,                          // 0.0.0.0
	/^::1?$/,                                // IPv6 loopback
];

/** Common router / gateway IPs that are blocked to avoid accidental network disruption */
const BLOCKED_ROUTER_IPS: Set<string> = new Set([
	'192.168.0.1',
	'192.168.1.1',
	'192.168.0.254',
	'192.168.1.254',
	'10.0.0.1',
	'10.0.0.254',
	'10.1.1.1',
	'172.16.0.1',
	'192.168.100.1',
	'192.168.2.1',
]);

/** General IP address pattern */
const IP_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Valid hostname pattern (RFC 1123 relaxed) */
const HOSTNAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validate a scan target to prevent scanning of local / loopback addresses
 * and common router IPs.
 *
 * @returns An object with `valid` and an optional `reason` when invalid.
 */
export function validateScanTarget(target: string): { valid: boolean; reason?: string } {
	if (!target || typeof target !== 'string') {
		return { valid: false, reason: 'Target is required' };
	}

	// Strip protocol, port, and path for analysis
	const cleaned = target
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '')
		.replace(/:\d+$/, '')
		.trim()
		.toLowerCase();

	if (!cleaned) {
		return { valid: false, reason: 'Target is empty after normalisation' };
	}

	// Check blocked hostnames
	if (BLOCKED_HOSTNAMES.has(cleaned)) {
		return { valid: false, reason: `"${cleaned}" is a blocked hostname (localhost)` };
	}

	// Check loopback / zero IP patterns
	for (const pattern of BLOCKED_IP_PATTERNS) {
		if (pattern.test(cleaned)) {
			return { valid: false, reason: `"${cleaned}" is a loopback / reserved address` };
		}
	}

	// Check common router IPs
	if (BLOCKED_ROUTER_IPS.has(cleaned)) {
		return { valid: false, reason: `"${cleaned}" is a common router/gateway IP` };
	}

	// Validate format — must look like an IP or a hostname
	if (IP_PATTERN.test(cleaned)) {
		// Looks like an IPv4 address — further sanity check octets
		const octets = cleaned.split('.').map(Number);
		for (const octet of octets) {
			if (octet < 0 || octet > 255) {
				return { valid: false, reason: `"${cleaned}" contains an invalid IP octet` };
			}
		}
	} else if (!HOSTNAME_PATTERN.test(cleaned)) {
		return { valid: false, reason: `"${cleaned}" is not a valid IP address or hostname` };
	}

	return { valid: true };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────────

/**
 * Check whether the Docker CLI is available on the system.
 */
async function checkDockerAvailable(): Promise<boolean> {
	try {
		const childProcess = await import('child_process');
		childProcess.execSync('docker --version', {
			encoding: 'utf8',
			timeout: 10000,
			windowsHide: true,
		});
		return true;
	} catch {
		return false;
	}
}
