/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * securityTargetGuard -- pure helpers for the nmap/nuclei external-target
 * safety gate (QA-8).
 *
 * Extracted from ConstructToolRegistryService in Phase 5 for unit
 * testability. The original methods were private and required the full
 * service instance to test; these extracted functions take their
 * collaborators as parameters so they can be tested directly.
 *
 * These functions are used by the security tool execute methods
 * (executeNmapScan, executeNucleiScan) that remain in
 * ConstructToolRegistryService. They are also re-exported from there
 * for backwards compatibility with any internal callers.
 */

/**
 * Returns true if the target is NOT loopback and NOT in a private RFC1918 range.
 * Used to gate nmap/nuclei scans behind an explicit user opt-in setting.
 *
 * "External" targets (returns true):
 *   - Public IPv4 addresses (anything not in 10.0.0.0/8, 172.16.0.0/12,
 *     192.168.0.0/16, 127.0.0.0/8)
 *   - Non-IP hostnames (e.g. "example.com") -- these resolve via DNS at
 *     scan time and could be external
 *
 * "Internal" targets (returns false):
 *   - "localhost", "::1", "127.0.0.1"
 *   - Any 127.x.x.x address
 *   - Any 10.x.x.x address
 *   - Any 172.16-31.x.x address
 *   - Any 192.168.x.x address
 */
export function isExternalTarget(target: string): boolean {
	const t = target.trim().toLowerCase();
	if (t === 'localhost' || t === '::1' || t === '127.0.0.1') { return false; }
	const host = t.split(':')[0];
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const a = +ipv4[1], b = +ipv4[2];
		if (a === 10) { return false; }
		if (a === 172 && b >= 16 && b <= 31) { return false; }
		if (a === 192 && b === 168) { return false; }
		if (a === 127) { return false; }
		return true;
	}
	return true;
}

/**
 * Returns an error message if the scan should be refused, or undefined if
 * it may proceed.
 *
 * @param target The scan target (hostname or IP)
 * @param allowExternalTargets The value of the kovix.security.allowExternalTargets
 *   setting. When true, external targets are allowed. When false/undefined,
 *   external targets are refused.
 */
export function checkExternalTargetAllowed(
	target: string,
	allowExternalTargets: boolean | undefined,
): string | undefined {
	if (!isExternalTarget(target)) { return undefined; }
	if (allowExternalTargets) { return undefined; }
	return [
		`Refusing to scan external target '${target}'.`,
		'',
		'This is a safety guard: scanning external hosts without explicit permission',
		'may be illegal and is blocked by default.',
		'',
		'To allow external scans, enable the setting:',
		'  Settings -> Kovix -- Security Tools -> Allow External Targets',
		'Or in settings.json:',
		'  "kovix.security.allowExternalTargets": true',
	].join('\n');
}
