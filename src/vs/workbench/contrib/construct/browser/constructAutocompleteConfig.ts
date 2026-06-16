// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Patch A configuration — Tab autocomplete settings.
 *
 *  Tier 1, item 1.1 of the KOVIX Technical Audit roadmap.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';

const autocompleteConfiguration: IConfigurationNode = {
	id: 'construct.autocomplete',
	order: 102,
	title: localize('constructAutocomplete', "Kovix -- Tab Autocomplete"),
	type: 'object',
	properties: {
		'construct.autocomplete.enabled': {
			type: 'boolean',
			default: true,
			description: localize('construct.autocomplete.enabled', "Enable Tab-to-accept inline code completions in the editor. When enabled, the active AI provider is queried as you type and suggestions appear as ghost text."),
			scope: 1 /* ConfigurationScope.APPLICATION */,
		},
		'construct.autocomplete.debounceMs': {
			type: 'number',
			default: 200,
			minimum: 50,
			maximum: 2000,
			description: localize('construct.autocomplete.debounceMs', "Milliseconds of idle time required before an autocomplete request is sent. Lower values feel more responsive but cost more API calls; higher values are cheaper but feel sluggish."),
			scope: 1 /* ConfigurationScope.APPLICATION */,
		},
		'construct.autocomplete.maxTokens': {
			type: 'number',
			default: 64,
			minimum: 16,
			maximum: 256,
			description: localize('construct.autocomplete.maxTokens', "Maximum number of tokens to generate per autocomplete suggestion. Smaller values are faster and cheaper; larger values produce longer multi-line completions."),
			scope: 1 /* ConfigurationScope.APPLICATION */,
		},
		'construct.autocomplete.temperature': {
			type: 'number',
			default: 0.2,
			minimum: 0,
			maximum: 1,
			description: localize('construct.autocomplete.temperature', "Sampling temperature for autocomplete. Low values (0.1-0.3) produce deterministic suggestions; high values (0.7-1.0) produce more varied but less predictable suggestions."),
			scope: 1 /* ConfigurationScope.APPLICATION */,
		},
	},
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(autocompleteConfiguration);
