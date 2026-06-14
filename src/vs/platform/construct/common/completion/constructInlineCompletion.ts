// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IConstructInlineCompletionProvider = createDecorator<IConstructInlineCompletionProvider>('construct.inlineCompletionProvider');

export interface IConstructInlineCompletionProvider {
	readonly _serviceBrand: undefined;
}
