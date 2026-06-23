/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IRefinementQuestion, IRefinementAnswer, IRefinedIdea, RefinementEvent } from './ideaRefinementTypes.js';

export const IIdeaRefinementService = createDecorator<IIdeaRefinementService>('kovix.ideaRefinement');

/**
 * Service for the idea refinement phase of the Construct agent workflow.
 * Takes a raw user idea and conducts an interactive Q&A to produce a
 * well-scoped, detailed specification before planning begins.
 */
export interface IIdeaRefinementService {
	readonly _serviceBrand: undefined;

	/** Events emitted during the refinement process. */
	readonly onRefinementEvent: Event<RefinementEvent>;

	/** Whether a refinement session is currently active. */
	readonly isRefining: boolean;

	/**
	 * Start the refinement process for a user's raw idea.
	 * The AI will generate clarifying questions.
	 * @param idea The raw user idea or task description.
	 * @returns The initial set of refinement questions.
	 */
	startRefinement(idea: string): Promise<IRefinementQuestion[]>;

	/**
	 * Submit answers to the current refinement questions.
	 * The AI may generate more questions or complete the refinement.
	 * @param answers The user's answers to the current questions.
	 * @returns Either more questions or the refined idea.
	 */
	submitAnswers(answers: IRefinementAnswer[]): Promise<{ type: 'questions'; questions: IRefinementQuestion[] } | { type: 'complete'; refinedIdea: IRefinedIdea }>;

	/**
	 * Skip the refinement process and produce a best-effort refined idea
	 * from whatever information is available.
	 */
	skipToRefinedIdea(): Promise<IRefinedIdea>;

	/**
	 * Cancel the current refinement session.
	 */
	cancelRefinement(): void;
}
