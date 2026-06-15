// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

import { CONSTRUCT_CHANNELS, ConstructChannelName } from '../constructIpcChannels.js';

/**
 * Validate that an IPC message sender is trusted to send on CONSTRUCT channels.
 *
 * SEC-2: IPC message validation — ensures only legitimate VS Code internals
 * can send/receive on CONSTRUCT IPC channels, preventing extensions or
 * webviews from triggering privileged operations.
 *
 * VS Code's IPC infrastructure routes messages through registered channels.
 * The main process server only exposes channels to renderer windows that
 * request them through the proper IPC initialization handshake. This means:
 * - Extensions cannot directly send IPC messages to construct channels
 * - Webviews are isolated and cannot access main process IPC
 * - Only the renderer process (workbench) can call IPC methods
 *
 * This validator provides a defense-in-depth check that can be called
 * at any IPC handler to verify the sender context.
 */

/** Set of channels that require strict sender validation */
const RESTRICTED_CHANNELS: ReadonlySet<string> = new Set([
	CONSTRUCT_CHANNELS.SECURE_KEYS,
	CONSTRUCT_CHANNELS.TERMINAL,
	CONSTRUCT_CHANNELS.CONFIG,
]);

/**
 * Sender context information for IPC validation.
 * Used to identify the origin of an IPC message for access control.
 */
export interface IpcSenderContext {
	/** Origin identifier (e.g., 'main', 'renderer', 'vscode-webview://...') */
	origin?: string;
	/** Window ID of the sender (Electron WebContents ID) */
	windowId?: number;
	/** Extension ID if the call originates from an extension host */
	extensionId?: string;
}

/**
 * Check if a given IPC channel name is a CONSTRUCT channel.
 * Useful for filtering and logging.
 */
export function isConstructChannel(channel: string): boolean {
	return Object.values(CONSTRUCT_CHANNELS).includes(channel as ConstructChannelName);
}

/**
 * Validate that the sender context is trusted for a given CONSTRUCT IPC channel.
 *
 * @param channel The IPC channel being accessed
 * @param senderContext Optional sender context information (e.g., origin, window ID)
 * @returns true if the sender is trusted, false otherwise
 *
 * In the current VS Code architecture:
 * - Main process IPC channels are only accessible from renderer processes
 *   that have gone through the proper IPC handshake
 * - Extensions run in an Extension Host process with separate IPC
 * - Webviews are sandboxed and cannot access main process IPC directly
 *
 * The primary validation is architectural (VS Code enforces this by design).
 * This function adds defense-in-depth for restricted channels (SECURE_KEYS, TERMINAL, CONFIG).
 */
export function isConstructTrustedSender(
	channel: string,
	senderContext?: IpcSenderContext
): boolean {
	// If an extension ID is present, it's an extension host call — reject for restricted channels
	if (senderContext?.extensionId && RESTRICTED_CHANNELS.has(channel)) {
		return false;
	}

	// If origin is present and it's a webview, reject for restricted channels
	if (senderContext?.origin && RESTRICTED_CHANNELS.has(channel)) {
		// Webview origins are typically like 'vscode-webview://...'
		if (senderContext.origin.includes('webview')) {
			return false;
		}
	}

	// Default: trust the sender (VS Code's IPC infrastructure already validates
	// that messages come from legitimate renderer processes)
	return true;
}

/**
 * Get the list of restricted CONSTRUCT IPC channels that require
 * additional sender validation.
 */
export function getRestrictedChannels(): ReadonlySet<string> {
	return RESTRICTED_CHANNELS;
}
