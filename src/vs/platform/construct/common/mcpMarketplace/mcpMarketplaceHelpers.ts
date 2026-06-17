// Copyright (c) 2025 Razisafir. All rights reserved.
// Tier 2, item 2.7 — MCP marketplace 1-click install helpers. Architecture stub.

export interface IMcpMarketplaceEntry {
	id: string;
	name: string;
	description: string;
	author: string;
	homepage?: string;
	repository?: string;
	installMethod: 'npx' | 'pipx' | 'docker' | 'binary' | 'manual';
	command: string;
	args: string[];
	envSchema?: Record<string, { description: string; required: boolean; default?: string }>;
	tools: string[];
	categories: string[];
	official: boolean;
	verified: boolean;
	stars?: number;
	installs?: number;
	license?: string;
}

export interface IMcpInstallResult {
	success: boolean;
	serverId: string;
	message: string;
	config?: { name: string; command: string; args: string[]; env?: Record<string, string> };
}

export function generateMcpConfig(entry: IMcpMarketplaceEntry, envValues?: Record<string, string>): { name: string; command: string; args: string[]; env?: Record<string, string> } {
	const config: { name: string; command: string; args: string[]; env?: Record<string, string> } = {
		name: entry.id, command: entry.command, args: entry.args,
	};
	if (entry.envSchema) {
		const env: Record<string, string> = {};
		for (const [key, schema] of Object.entries(entry.envSchema)) {
			if (envValues && envValues[key]) { env[key] = envValues[key]; }
			else if (schema.default) { env[key] = schema.default; }
			else if (schema.required) { env[key] = `<${key}_REQUIRED>`; }
		}
		if (Object.keys(env).length > 0) { config.env = env; }
	}
	return config;
}

export function validateEnvVars(entry: IMcpMarketplaceEntry, provided: Record<string, string>): { valid: boolean; missing: string[] } {
	const missing: string[] = [];
	if (entry.envSchema) {
		for (const [key, schema] of Object.entries(entry.envSchema)) {
			if (schema.required && !provided[key] && !schema.default) { missing.push(key); }
		}
	}
	return { valid: missing.length === 0, missing };
}

export function searchMarketplace(entries: IMcpMarketplaceEntry[], query: string): IMcpMarketplaceEntry[] {
	const q = query.toLowerCase().trim();
	if (!q) { return entries; }
	return entries.filter(e =>
		e.name.toLowerCase().includes(q) ||
		e.description.toLowerCase().includes(q) ||
		e.tools.some(t => t.toLowerCase().includes(q)) ||
		e.categories.some(c => c.toLowerCase().includes(q))
	);
}

export function filterByCategory(entries: IMcpMarketplaceEntry[], category: string | 'all'): IMcpMarketplaceEntry[] {
	if (category === 'all') { return entries; }
	return entries.filter(e => e.categories.includes(category));
}

export function sortMarketplaceEntries(entries: IMcpMarketplaceEntry[], sortBy: 'official' | 'stars' | 'installs' | 'name' = 'official'): IMcpMarketplaceEntry[] {
	const sorted = [...entries];
	switch (sortBy) {
		case 'official':
			sorted.sort((a, b) => {
				if (a.official !== b.official) { return a.official ? -1 : 1; }
				if (a.verified !== b.verified) { return a.verified ? -1 : 1; }
				return (b.stars ?? 0) - (a.stars ?? 0);
			});
			break;
		case 'stars': sorted.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0)); break;
		case 'installs': sorted.sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0)); break;
		case 'name': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
	}
	return sorted;
}

export const DEFAULT_MARKETPLACE_CATALOG: readonly IMcpMarketplaceEntry[] = [
	{
		id: 'agent-reach', name: 'Agent Reach',
		description: 'Internet research toolkit. Search YouTube, GitHub, Reddit, read webpages.',
		author: 'Kovix', installMethod: 'npx', command: 'npx', args: ['-y', '@agent-reach/mcp-server'],
		tools: ['agent_reach__read_webpage', 'agent_reach__search_youtube', 'agent_reach__search_github'],
		categories: ['research', 'web', 'search'], official: true, verified: true, license: 'MIT',
	},
	{
		id: 'ui-ux-pro-max', name: 'UI-UX Pro Max',
		description: 'Design intelligence engine. 67 UI styles, 161 color palettes.',
		author: 'Kovix', installMethod: 'manual', command: 'python3', args: ['.kovix/skills/ui-ux-pro-max/scripts/search.py'],
		tools: ['uiux_pro_max__search_style', 'uiux_pro_max__generate_design_system'],
		categories: ['design', 'frontend'], official: true, verified: true, license: 'MIT',
	},
	{
		id: 'ponytail', name: 'Ponytail',
		description: 'Lazy senior developer code review ruleset.',
		author: 'Kovix', installMethod: 'manual', command: 'node', args: ['.kovix/skills/ponytail/server.js'],
		tools: ['ponytail_review_code', 'ponytail_audit_repo'],
		categories: ['code-review', 'quality'], official: true, verified: true, license: 'MIT',
	},
];
