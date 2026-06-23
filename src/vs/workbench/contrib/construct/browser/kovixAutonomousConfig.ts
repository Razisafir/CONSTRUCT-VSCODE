/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';

/**
 * Kovix Autonomous Mode configuration.
 *
 * These settings control the "Idea → App" autonomous wizard and the
 * milestone-gated execution flow. They are surfaced in the Autonomous
 * tab of the Agent Settings pane.
 */
const autonomousConfiguration: IConfigurationNode = {
	id: 'kovix.autonomous',
	order: 110,
	title: localize('kovix.autonomous', "Kovix — Autonomous Mode"),
	type: 'object',
	properties: {
		'kovix.autonomous.autoApprovePlan': {
			type: 'boolean',
			default: false,
			description: localize('kovix.autonomous.autoApprovePlan', "When ON, the agent skips the 'Approve plan?' gate and starts executing immediately. Faster, less control."),
		},
		'kovix.autonomous.milestoneGates': {
			type: 'boolean',
			default: true,
			description: localize('kovix.autonomous.milestoneGates', "When ON, the agent pauses at logical milestones (e.g. 'scaffold done', 'MVP works') for you to review."),
		},
		'kovix.autonomous.runTests': {
			type: 'boolean',
			default: true,
			description: localize('kovix.autonomous.runTests', "When ON, the agent runs the project's test suite after each milestone and stops if tests fail."),
		},
		'kovix.autonomous.gitCommitPerStep': {
			type: 'boolean',
			default: true,
			description: localize('kovix.autonomous.gitCommitPerStep', "When ON, the agent commits after each plan step on a dedicated branch. Easy to roll back."),
		},
		'kovix.autonomous.maxRounds': {
			type: 'number',
			default: 50,
			minimum: 1,
			maximum: 500,
			description: localize('kovix.autonomous.maxRounds', "Hard ceiling on agent-loop iterations per task. Prevents runaway costs. 50 is a sensible default."),
		},
		'kovix.autonomous.ponytailEnforce': {
			type: 'boolean',
			default: true,
			description: localize('kovix.autonomous.ponytailEnforce', "When ON, Ponytail (YAGNI → stdlib → native → deps → one-line → minimum) is enforced during autonomous builds to prevent over-engineering."),
		},
		'construct.autonomous.ponytailMode': {
			// Phase 1.5 — ponytail discipline is a STANDING DEFAULT, not opt-in.
			// 'full' is the recommended baseline given the ADHD-driven scope-creep
			// pattern documented in the agent loop's own system prompt. Users who
			// explicitly want bigger architectures for a task can switch to 'lite'
			// (only flag obvious over-engineering) or 'off' (disable entirely).
			type: 'string',
			enum: ['full', 'lite', 'off'],
			enumDescriptions: [
			    localize('construct.autonomous.ponytailMode.full', "Full YAGNI ladder enforced — stdlib before deps, native before custom, one line before fifty. Recommended default."),
			    localize('construct.autonomous.ponytailMode.lite', "Only flag obvious over-engineering (unused abstractions, speculative config layers)."),
			    localize('construct.autonomous.ponytailMode.off', "Disable ponytail discipline entirely. Use only when the task explicitly requires a bigger architecture."),
			],
			default: 'full',
			description: localize('construct.autonomous.ponytailMode', "Ponytail discipline level applied to ALL agent code generation, not just autonomous builds. 'full' is the recommended default — stdlib before deps, native before custom, one line before fifty. Switch to 'lite' or 'off' only when a task explicitly requires a bigger architecture."),
		},
		'kovix.autonomous.parallelSwarm': {
			type: 'boolean',
			default: false,
			description: localize('kovix.autonomous.parallelSwarm', "When ON, the agent spawns parallel sub-agents (architect, coder, reviewer) for each milestone. Faster on multi-core, but uses more tokens."),
		},
		'kovix.autonomous.swarmSize': {
			type: 'number',
			default: 3,
			minimum: 1,
			maximum: 8,
			description: localize('kovix.autonomous.swarmSize', "Number of parallel sub-agents to spawn when parallelSwarm is ON. 3 = architect + coder + reviewer."),
		},
	},
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(autonomousConfiguration);
