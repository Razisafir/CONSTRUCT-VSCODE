// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { isConstructTrustedSender, IpcSenderContext } from './ipcSenderValidation.js';

/**
 * SEC-2: Validating wrapper for CONSTRUCT IPC channels.
 *
 * Wraps an `IServerChannel` and validates the sender context before
 * forwarding `call()` and `listen()` requests. For restricted channels
 * (SECURE_KEYS, TERMINAL, CONFIG), untrusted senders are rejected.
 *
 * Usage:
 * ```ts
 * const channel = ProxyChannel.fromService(service, disposables);
 * const wrapped = createValidatingChannel('constructSecureKeys', channel);
 * server.registerChannel('constructSecureKeys', wrapped);
 * ```
 */
export class ValidatingConstructChannel<TContext = string> implements IServerChannel<TContext> {

	constructor(
		private readonly channelName: string,
		private readonly inner: IServerChannel<TContext>,
		private readonly logWarning?: (msg: string) => void,
	) { }

	call<T>(ctx: TContext, command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T> {
		const senderContext = this.extractSenderContext(ctx);
		if (!isConstructTrustedSender(this.channelName, senderContext)) {
			const reason = senderContext?.extensionId
				? `extension "${senderContext.extensionId}"`
				: senderContext?.origin
					? `origin "${senderContext.origin}"`
					: 'untrusted sender';
			const msg = `[SEC-2] Rejected IPC call on restricted channel "${this.channelName}.${command}" from ${reason}`;
			this.logWarning?.(msg);
			return Promise.reject(new Error(`SEC-2: Access denied — ${reason} is not trusted for channel "${this.channelName}"`)) as Promise<T>;
		}
		return this.inner.call(ctx, command, arg, cancellationToken);
	}

	listen<T>(ctx: TContext, event: string, arg?: any): Event<T> {
		const senderContext = this.extractSenderContext(ctx);
		if (!isConstructTrustedSender(this.channelName, senderContext)) {
			const reason = senderContext?.extensionId
				? `extension "${senderContext.extensionId}"`
				: senderContext?.origin
					? `origin "${senderContext.origin}"`
					: 'untrusted sender';
			const msg = `[SEC-2] Rejected IPC listen on restricted channel "${this.channelName}.${event}" from ${reason}`;
			this.logWarning?.(msg);
			return Event.None;
		}
		return this.inner.listen(ctx, event, arg);
	}

	/**
	 * Extract sender context from the IPC connection context.
	 *
	 * In VS Code's Electron IPC architecture, `ctx` is a string identifier
	 * set by the renderer during the `vscode:hello` handshake. It typically
	 * includes the window ID and a client type prefix (e.g., "window:1").
	 *
	 * Extension host connections have different prefixes (e.g., "extensionHost").
	 * Webview connections are not made through this IPC path at all.
	 */
	private extractSenderContext(ctx: TContext): IpcSenderContext | undefined {
		if (typeof ctx === 'string') {
			const context: IpcSenderContext = {};
			if (ctx.includes('extension') || ctx.includes('exthost')) {
				context.extensionId = ctx;
			}
			if (ctx.includes('webview')) {
				context.origin = ctx;
			}
			// Try to extract windowId from context strings like "window:123"
			const windowMatch = ctx.match(/window:(\d+)/);
			if (windowMatch) {
				context.windowId = parseInt(windowMatch[1], 10);
			}
			return Object.keys(context).length > 0 ? context : undefined;
		}
		return undefined;
	}
}

/**
 * Create a validating wrapper around an IServerChannel for a CONSTRUCT IPC channel.
 *
 * @param channelName The CONSTRUCT channel name (e.g., from CONSTRUCT_CHANNELS.SECURE_KEYS)
 * @param inner The underlying IServerChannel to wrap
 * @param logWarning Optional logger for rejected calls
 * @returns A new IServerChannel that validates senders before forwarding
 */
export function createValidatingChannel<TContext = string>(
	channelName: string,
	inner: IServerChannel<TContext>,
	logWarning?: (msg: string) => void,
): IServerChannel<TContext> {
	return new ValidatingConstructChannel(channelName, inner, logWarning);
}
