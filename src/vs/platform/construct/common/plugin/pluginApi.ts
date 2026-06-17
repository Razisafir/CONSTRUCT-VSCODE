// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Tier 3, item 3.3 — Plugin API interface definitions.
 *
 *  Defines the public API surface for community extensions to add tools,
 *  providers, and MCP servers to KOVIX.
 *
 *  STATUS: Architecture stub. Interface definitions only — no runtime.
 *  The actual plugin loader and registry is future work.
 *
 *  Estimated effort to complete: 7-10 days
 *--------------------------------------------------------------------------------------------*/

/**
 * A Kovix plugin. Plugins can extend the agent with custom tools, add new AI
 * providers, register MCP servers, and hook into the agent lifecycle.
 */
export interface IKovixPlugin {
	/** Unique plugin ID (e.g. 'com.example.myplugin') */
	id: string;
	/** Display name */
	name: string;
	/** Version (semver) */
	version: string;
	/** Author */
	author: string;
	/** Description */
	description: string;
	/** Minimum Kovix version required */
	minKovixVersion?: string;
	/** Activation events — when should this plugin be loaded? */
	activationEvents: IKovixActivationEvent[];
	/** Plugin contributions */
	contributes?: IKovixPluginContributes;
}

/**
 * When should a plugin be activated?
 */
export interface IKovixActivationEvent {
	type: 'onStartup' | 'onCommand' | 'onLanguage' | 'onFilePattern' | 'onTool';
	/** For onCommand: the command ID. For onLanguage: the language ID. Etc. */
	value?: string;
}

/**
 * What does this plugin contribute to Kovix?
 */
export interface IKovixPluginContributes {
	/** Custom agent tools */
	tools?: IKovixToolContribution[];
	/** Custom AI providers */
	providers?: IKovixProviderContribution[];
	/** MCP server registrations */
	mcpServers?: IKovixMcpServerContribution[];
	/** Commands */
	commands?: IKovixCommandContribution[];
	/** Configuration schema */
	configuration?: IKovixConfigurationContribution[];
}

export interface IKovixToolContribution {
	id: string;
	name: string;
	description: string;
	category: 'file' | 'terminal' | 'search' | 'network' | 'system' | 'security' | 'design' | 'behavior';
	modifiesFiles: boolean;
	requiresNetwork: boolean;
	/** Handler function — see IKovixToolHandler */
	handlerId: string;
}

export interface IKovixProviderContribution {
	id: string;
	name: string;
	providerType: 'ollama' | 'xenova' | 'cloud' | 'custom';
	/** Factory function ID for creating the provider instance */
	factoryId: string;
}

export interface IKovixMcpServerContribution {
	id: string;
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
}

export interface IKovixCommandContribution {
	id: string;
	title: string;
	category?: string;
	keybinding?: string;
	icon?: string;
}

export interface IKovixConfigurationContribution {
	id: string;
	title: string;
	properties: Record<string, {
		type: 'string' | 'number' | 'boolean' | 'array' | 'object';
		default?: unknown;
		description: string;
		enum?: string[];
	}>;
}

/**
 * Plugin manifest — what the plugin's package.json should look like.
 */
export interface IKovixPluginManifest extends IKovixPlugin {
	/** Main entry point (relative to plugin root) */
	main: string;
	/** Whether the plugin is enabled */
	enabled: boolean;
}

/**
 * Plugin activation context — passed to the plugin's activate() function.
 */
export interface IKovixPluginContext {
	/** Plugin-specific storage path */
	storagePath: string;
	/** Logger scoped to this plugin */
	log: (level: 'info' | 'warn' | 'error', message: string) => void;
	/** Access to the KOVIX service registry */
	services: IKovixPluginServices;
}

export interface IKovixPluginServices {
	/** Register a tool handler */
	registerToolHandler(handlerId: string, handler: IKovixToolHandler): void;
	/** Show a notification */
	showInformation(message: string): void;
	showWarning(message: string): void;
	showError(message: string): void;
}

export interface IKovixToolHandler {
	(input: unknown): Promise<{ success: boolean; output: string; metadata?: Record<string, unknown> }>;
}

/**
 * The plugin activate function signature.
 */
export type KovixPluginActivateFunction = (context: IKovixPluginContext) => Promise<void> | void;

/**
 * The plugin deactivate function signature.
 */
export type KovixPluginDeactivateFunction = () => Promise<void> | void;
