// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ExecutionMode, DEFAULT_EXECUTION_MODE_CONFIGS } from '../../../../platform/construct/common/agent/executionMode.js';
import { IMilestone } from '../../../../platform/construct/common/agent/milestoneStateMachine.js';

/**
 * Quick-pick item extended with execution mode metadata.
 */
interface IExecutionModePickItem extends IQuickPickItem {
        /** The execution mode represented by this pick item. */
        readonly mode: ExecutionMode;
}

/**
 * Quick-pick item extended with milestone metadata.
 */
interface IMilestonePickItem extends IQuickPickItem {
        /** The milestone ID represented by this pick item. */
        readonly milestoneId: string;
}

/**
 * F-009 FIX: Return type of showStopModePicker.
 *
 * Before this fix, the picker returned only ExecutionMode and silently
 * discarded the user's milestone selection in Selective mode. The
 * milestone picker UI was functionally inert — the user clicked
 * checkboxes but nothing remembered their choice.
 */
export interface IStopModeSelection {
        /** The selected execution mode. */
        readonly mode: ExecutionMode;
        /**
         * IDs of milestones the user chose to pause at (Selective mode only).
         * Undefined for non-Selective modes. Empty array means "pause at
         * none" (effectively automatic within Selective mode).
         */
        readonly selectedMilestoneIds?: string[];
}

/**
 * Show the stop mode picker and return the selected execution mode.
 * Optionally shows a second picker for milestone selection in Selective mode.
 * @param quickInputService The quick input service for showing pickers.
 * @param milestones The milestones available for selective mode.
 * @returns The selection (mode + optional milestone IDs), or undefined if cancelled.
 */
export async function showStopModePicker(
        quickInputService: IQuickInputService,
        milestones?: IMilestone[],
): Promise<IStopModeSelection | undefined> {
        const configs = Object.values(DEFAULT_EXECUTION_MODE_CONFIGS);

        const items: IExecutionModePickItem[] = configs.map(config => ({
                label: `${config.icon} ${config.label}`,
                description: config.description,
                detail: config.pausesAtMilestones ? 'Pauses between milestones' : 'Runs without pausing',
                mode: config.mode,
        }));

        const pick = await quickInputService.pick(items, {
                placeHolder: 'Select execution mode...',
                title: 'Stop Mode',
        });

        if (!pick) {
                return undefined;
        }

        const selectedMode = (pick as IExecutionModePickItem).mode;

        // If Selective mode and milestones are available, show milestone picker.
        // F-009 FIX: Actually CAPTURE the user's selection and return it. Previously
        // the picker was shown but the result was discarded (see the old comment
        // that admitted 'the picker is informational here').
        let selectedMilestoneIds: string[] | undefined;
        if (selectedMode === ExecutionMode.Selective && milestones && milestones.length > 0) {
                const milestoneItems: IMilestonePickItem[] = milestones.map(m => ({
                        label: `${m.isMajor ? '\u2B50' : '\uD83D\uDFE2'} ${m.name}`,
                        description: m.description,
                        detail: `Steps: ${m.stepIndices.length} | ${m.isMajor ? 'Major' : 'Minor'} milestone`,
                        picked: m.isMajor, // Default: pause at major milestones
                        milestoneId: m.id,
                }));

                const pickedMilestones = await quickInputService.pick(milestoneItems, {
                        placeHolder: 'Select milestones to pause at...',
                        title: 'Select Pause Points',
                        canPickMany: true,
                });

                // User pressed Escape — cancel the whole flow.
                if (pickedMilestones === undefined) {
                        return undefined;
                }

                // Extract the milestone IDs from the picked items.
                selectedMilestoneIds = (pickedMilestones as IMilestonePickItem[])
                        .map(item => item.milestoneId);
        }

        return { mode: selectedMode, selectedMilestoneIds };
}
