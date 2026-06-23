/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkingMemoryEntry } from './memoryTypes.js';

export const IWorkingMemoryService = createDecorator<IWorkingMemoryService>('kovix.workingMemory');

export interface IWorkingMemoryService extends IDisposable {
	readonly _serviceBrand: undefined;

	getCurrentContext(projectId: string): IWorkingMemoryEntry | undefined;
	updateContext(projectId: string, update: Partial<Omit<IWorkingMemoryEntry, 'id' | 'layer' | 'timestamp'>>): void;
	clearContext(projectId: string): void;
	getContextWindowSize(projectId: string): number;
	getTokenBudget(projectId: string): number;
	pruneContext(projectId: string, targetTokens: number): void;

	readonly onDidChangeContext: Event<{ projectId: string; entry: IWorkingMemoryEntry }>;
}
