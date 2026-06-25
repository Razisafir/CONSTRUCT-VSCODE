/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

/**
 * Kovix Security Tools extension -- Phase 5.
 *
 * This extension provides the three security scanning tools (nmap, Ghidra,
 * Nuclei) to the Kovix agent. It is DISABLED BY DEFAULT -- a fresh install
 * has the extension files present but the tools are NOT registered with the
 * agent loop. The LLM is never offered these tools unless the user takes
 * explicit opt-in action:
 *
 *   1. The extension must be enabled (Extensions view -> "Kovix Security
 *      Tools" -> Enable). Built-in extensions are present in the install
 *      but can be disabled per-workspace or globally.
 *   2. The user must set `kovix.enableSecurityTools = true` in settings,
 *      OR run the "Kovix: Enable Security Tools" command.
 *
 * When BOTH conditions hold, this extension's activate() function calls
 * the internal `_kovix.toolRegistry.registerSecurityTools` command exposed
 * by the core ConstructToolRegistryService. That command registers
 * `nmap_scan`, `ghidra_decompile`, and `nuclei_scan` with the agent's tool
 * registry, making them visible to the LLM on subsequent agent rounds.
 *
 * When EITHER condition stops holding (user disables the extension, or
 * flips the setting to false), the `_kovix.toolRegistry.unregisterSecurityTools`
 * command is called to remove the tools from the registry.
 *
 * Why this design:
 *   - Zero-cost default: a fresh install pays no compile, registration, or
 *     LLM-context cost for security tools the user didn't ask for.
 *   - Enterprise-friendly: corporate IT can install Kovix without the
 *     security tooling triggering AV/EDR heuristics that flag nmap/nuclei.
 *   - Legal posture: the user must take TWO explicit actions to enable
 *     these tools, which is a stronger opt-in than a single setting flip.
 *
 * Safety guards REMAIN in core (not removed by Phase 5):
 *   - nmap/nuclei external-target guard (RFC1918/loopback only by default,
 *     kovix.security.allowExternalTargets overrides, application-scoped).
 *   - ghidra workspace-local binary guard (assertWithinWorkspace, always on).
 *   These guards run inside the execute methods in
 *   src/vs/workbench/contrib/construct/browser/services/tools/constructToolRegistryService.ts
 *   and are NOT affected by whether this extension is installed.
 */

import * as vscode from 'vscode';

const SETTING_KEY = 'kovix.enableSecurityTools';
const REGISTER_CMD = '_kovix.toolRegistry.registerSecurityTools';
const UNREGISTER_CMD = '_kovix.toolRegistry.unregisterSecurityTools';

let currentlyRegistered = false;

export function activate(context: vscode.ExtensionContext): void {
	// On activation, check the current setting and register if needed.
	// activate() only fires when the extension is enabled, so reaching
	// here already satisfies condition #1 (extension installed+enabled).
	syncRegistration();

	// Re-sync whenever the setting changes. This lets the user flip the
	// setting in settings.json without needing to reload the window.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(SETTING_KEY)) {
				syncRegistration();
			}
		})
	);

	// Expose user-facing commands so the user has a discoverable UI affordance
	// (instead of having to know about the setting).
	context.subscriptions.push(
		vscode.commands.registerCommand('kovix-security-tools.enable', async () => {
			const config = vscode.workspace.getConfiguration();
			await config.update(SETTING_KEY, true, vscode.ConfigurationTarget.Global);
			// The onDidChangeConfiguration listener will fire and call syncRegistration().
			vscode.window.showInformationMessage(
				'Kovix Security Tools enabled. nmap_scan, ghidra_decompile, and nuclei_scan are now visible to the agent.'
			);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('kovix-security-tools.disable', async () => {
			const config = vscode.workspace.getConfiguration();
			await config.update(SETTING_KEY, false, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(
				'Kovix Security Tools disabled. The agent will no longer offer nmap_scan, ghidra_decompile, or nuclei_scan.'
			);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('kovix-security-tools.status', () => {
			const enabled = vscode.workspace.getConfiguration().get<boolean>(SETTING_KEY) ?? false;
			const state = currentlyRegistered ? 'REGISTERED' : 'NOT registered';
			const message = currentlyRegistered
				? `Security tools are ${state}. The agent can invoke nmap_scan, ghidra_decompile, and nuclei_scan.`
				: `Security tools are ${state}. Setting kovix.enableSecurityTools=${enabled}. Set it to true to register the tools.`;
			vscode.window.showInformationMessage(message);
		})
	);
}

/**
 * Reads the current kovix.enableSecurityTools value and registers or
 * unregisters the security tools accordingly. Idempotent: if the desired
 * state matches the current state, no command is invoked.
 */
async function syncRegistration(): Promise<void> {
	const enabled = vscode.workspace.getConfiguration().get<boolean>(SETTING_KEY) ?? false;

	if (enabled && !currentlyRegistered) {
		try {
			const registered = await vscode.commands.executeCommand<string[]>(REGISTER_CMD);
			currentlyRegistered = (registered?.length ?? 0) > 0;
		} catch (err) {
			// The core command may not be available if the Kovix contribution
			// hasn't loaded yet (race on startup). Log and leave unregistered;
			// the next setting change or window reload will retry.
			console.error('[kovix-security-tools] register command failed:', err);
			currentlyRegistered = false;
		}
	} else if (!enabled && currentlyRegistered) {
		try {
			await vscode.commands.executeCommand<string[]>(UNREGISTER_CMD);
			currentlyRegistered = false;
		} catch (err) {
			console.error('[kovix-security-tools] unregister command failed:', err);
			// Leave currentlyRegistered=true on failure so the next retry
			// will attempt to unregister again.
		}
	}
}

export function deactivate(): void {
	// Best-effort cleanup: unregister the tools when the extension is
	// deactivated (window close, extension disable, etc.). The core
	// registry's dispose() will also clear all tools, so a failure here
	// is not a leak.
	if (currentlyRegistered) {
		try {
			vscode.commands.executeCommand<string[]>(UNREGISTER_CMD);
		} catch {
			// Best effort -- ignore.
		}
		currentlyRegistered = false;
	}
}
