/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';

export const IConstructErrorState = createDecorator<IConstructErrorState>('construct.errorState');

export interface IConstructErrorState {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<IErrorStateChange>;
	showError(error: Error, options?: IErrorStateOptions): string;
	dismissError(id: string): void;
	getActiveErrors(): ReadonlyArray<IErrorStateEntry>;
}

export interface IErrorStateOptions {
	retryable?: boolean;
	undoable?: boolean;
	onRetry?: () => Promise<void>;
	onUndo?: () => Promise<void>;
}

export interface IErrorStateEntry {
	id: string;
	error: Error;
	timestamp: number;
	retryable: boolean;
	undoable: boolean;
}

export interface IErrorStateChange {
	type: 'added' | 'removed';
	entry: IErrorStateEntry;
}

/**
 * Persistent error state service for the Construct agent.
 *
 * Unlike toasts that auto-dismiss, errors shown through this service
 * remain visible until the user explicitly dismisses them or takes
 * an action (Retry / Undo).
 */
export class ConstructErrorStateService extends Disposable implements IConstructErrorState {
	declare readonly _serviceBrand: undefined;

	private readonly _errors: Map<string, IErrorStateEntry & IErrorStateOptions> = new Map();

	private readonly _onDidChange = this._register(new Emitter<IErrorStateChange>());
	readonly onDidChange = this._onDidChange.event;

	private _idCounter = 0;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.logService.info('[ConstructErrorState] Service created');
	}

	/**
	 * Show a persistent error notification.
	 * Returns a unique ID that can be used to dismiss the error later.
	 */
	showError(error: Error, options?: IErrorStateOptions): string {
		const id = `err-${Date.now()}-${++this._idCounter}`;

		const entry: IErrorStateEntry & IErrorStateOptions = {
			id,
			error,
			timestamp: Date.now(),
			retryable: options?.retryable ?? false,
			undoable: options?.undoable ?? false,
			onRetry: options?.onRetry,
			onUndo: options?.onUndo,
		};

		this._errors.set(id, entry);

		this._onDidChange.fire({ type: 'added', entry });

		this.logService.warn(`[ConstructErrorState] Error shown: ${id} — ${error.message}`);

		return id;
	}

	/**
	 * Dismiss a previously shown error by its ID.
	 */
	dismissError(id: string): void {
		const entry = this._errors.get(id);
		if (!entry) {
			this.logService.warn(`[ConstructErrorState] Cannot dismiss unknown error: ${id}`);
			return;
		}

		this._errors.delete(id);
		this._onDidChange.fire({ type: 'removed', entry });

		this.logService.info(`[ConstructErrorState] Error dismissed: ${id}`);
	}

	/**
	 * Retry the action associated with the given error ID.
	 * Dismisses the error after a successful retry.
	 */
	async retryError(id: string): Promise<void> {
		const entry = this._errors.get(id);
		if (!entry) {
			this.logService.warn(`[ConstructErrorState] Cannot retry unknown error: ${id}`);
			return;
		}

		if (!entry.retryable || !entry.onRetry) {
			this.logService.warn(`[ConstructErrorState] Error ${id} is not retryable`);
			return;
		}

		try {
			await entry.onRetry();
			// Auto-dismiss on successful retry
			this.dismissError(id);
		} catch (retryError) {
			this.logService.error(`[ConstructErrorState] Retry failed for ${id}: ${retryError}`);
			// Keep the error visible for the user to try again
		}
	}

	/**
	 * Undo the action associated with the given error ID.
	 * Dismisses the error after a successful undo.
	 */
	async undoError(id: string): Promise<void> {
		const entry = this._errors.get(id);
		if (!entry) {
			this.logService.warn(`[ConstructErrorState] Cannot undo unknown error: ${id}`);
			return;
		}

		if (!entry.undoable || !entry.onUndo) {
			this.logService.warn(`[ConstructErrorState] Error ${id} is not undoable`);
			return;
		}

		try {
			await entry.onUndo();
			// Auto-dismiss on successful undo
			this.dismissError(id);
		} catch (undoError) {
			this.logService.error(`[ConstructErrorState] Undo failed for ${id}: ${undoError}`);
			// Keep the error visible for the user to try again
		}
	}

	/**
	 * Get all currently active (non-dismissed) errors.
	 */
	getActiveErrors(): ReadonlyArray<IErrorStateEntry> {
		return Array.from(this._errors.values());
	}

	/**
	 * Get a specific error entry by ID, or undefined if not found.
	 */
	getError(id: string): IErrorStateEntry | undefined {
		return this._errors.get(id);
	}

	override dispose(): void {
		this._errors.clear();
		super.dispose();
	}
}
