/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ISecretStorageService } from '../../../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkspaceTrustManagementService } from '../../../../../../platform/workspace/common/workspaceTrust.js';
import {
        IMCPServerDefinition,
        MCPTransportType,
        MCP_CONFIG_KEY,
        MCP_CREDENTIALS_PREFIX,
        MCP_MARKETPLACE_RATINGS_KEY,
        MCP_INSTALLED_MARKETPLACE_KEY
} from '../../../../../../platform/construct/common/mcp/mcpTypes.js';

/** Cline-compatible .claude-mcp/settings.json format */
export interface IClineMcpSettings {
        mcpServers: Record<string, {
                command?: string;
                args?: string[];
                env?: Record<string, string>;
                url?: string;
        }>;
}

interface ISerializedServer {
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        transport: string;
        version?: string;
        description?: string;
        categories: string[];
        installPath?: string;
        isBuiltin?: boolean;
        secretEnvKeys?: string[];
        /** SEC-7 (H2 follow-up): persisted alongside the server definition. */
        userApproved?: boolean;
}

export class MCPServerRegistry extends Disposable {
        private servers = new Map<string, IMCPServerDefinition>();
        private marketplaceRatings = new Map<string, number>();
        private installedMarketplaceItems = new Set<string>();
        /** Track which credential keys we've stored so we can clean them up */
        private credentialKeys = new Map<string, string[]>();

        private readonly _onDidChangeServers = this._register(new Emitter<void>());
        readonly onDidChangeServers: Event<void> = this._onDidChangeServers.event;

        constructor(
                @IConfigurationService private readonly configurationService: IConfigurationService,
                @ISecretStorageService private readonly secretStorageService: ISecretStorageService,
                @IStorageService private readonly storageService: IStorageService,
                @ILogService private readonly logService: ILogService,
                @IWorkspaceTrustManagementService private readonly workspaceTrustService: IWorkspaceTrustManagementService
        ) {
                super();
                this.loadServers();
                this.loadMarketplaceData();
        }

        // --- Loading ----------------------------------------------------------

        private loadServers(): void {
                try {
                        // SEC-9 (K2-C2 fix): inspect the configuration at multiple
                        // scopes so we can distinguish Application-scoped server
                        // defs (trusted) from workspace-scoped defs (untrusted by
                        // default). The `inspect()` API returns an object whose
                        // `.overrides` / `.user` / `.workspace` / `.workspaceFolder`
                        // fields tell us where each value came from.
                        //
                        // Defense layers (per the audit's K2-C2 fix spec):
                        //   (a) kovix.mcp.servers is now registered with
                        //       restricted:true (constructApiConfig.ts). VS Code
                        //       Workspace Trust will refuse to read workspace-
                        //       scoped values for restricted settings when the
                        //       workspace is untrusted. This is the PRIMARY gate.
                        //   (b) Here in loadServers(), we ALSO check
                        //       isWorkspaceTrusted() explicitly — defense-in-depth
                        //       in case the restricted:true gate is bypassed by a
                        //       future VS Code API change or by a manual edit to
                        //       the workspace storage DB.
                        //   (c) Even in a TRUSTED workspace, we strip isBuiltin
                        //       and userApproved from any server def that came
                        //       from workspace scope. Only Application scope may
                        //       set these flags. This closes the PoC where a
                        //       malicious (but user-trusted) workspace ships
                        //       {"isBuiltin":true,"userApproved":true} and
                        //       auto-spawns on workspace open.
                        const isTrusted = this.workspaceTrustService.isWorkspaceTrusted();
                        const inspectResult = this.configurationService.inspect<ISerializedServer[]>(MCP_CONFIG_KEY);

                        // Merge Application-scoped (user) + workspace-scoped
                        // (if trusted). We intentionally do NOT merge workspace
                        // values when the workspace is untrusted — even if the
                        // restricted:true gate somehow leaked them through.
                        //
                        // Note: inspect<T>() returns IConfigurationValue<Readonly<T>>
                        // where the *Value fields (userValue, workspaceValue, ...)
                        // are the raw T values, while the bare-name fields (user,
                        // workspace, ...) are wrapped in IInspectValue<T>. We use
                        // the *Value fields here for direct array access.
                        const userScoped: readonly ISerializedServer[] = inspectResult.userValue ?? inspectResult.applicationValue ?? [];
                        const workspaceScoped: readonly ISerializedServer[] = (isTrusted ? (inspectResult.workspaceValue ?? []) : []);
                        const workspaceFolderScoped: readonly ISerializedServer[] = (isTrusted ? (inspectResult.workspaceFolderValue ?? []) : []);

                        if (!isTrusted && ((inspectResult.workspaceValue?.length ?? 0) > 0 || (inspectResult.workspaceFolderValue?.length ?? 0) > 0)) {
                                this.logService.warn(
                                        `[MCP Registry] Workspace is untrusted — ignoring ${(inspectResult.workspaceValue?.length ?? 0) + (inspectResult.workspaceFolderValue?.length ?? 0)} workspace-scoped MCP server definition(s). ` +
                                        `Trust the workspace (Manage → Trust Workspace And Install Extensions) to load them.`
                                );
                        }

                        const merged: readonly ISerializedServer[] = [
                                ...userScoped,
                                ...workspaceScoped,
                                ...workspaceFolderScoped
                        ];

                        for (const serialized of merged) {
                                // SEC-9 (K2-C2 fix): strip isBuiltin and userApproved
                                // from any def that originated from workspace scope.
                                // Only Application-scoped config may set them. This
                                // prevents a trusted-but-malicious workspace from
                                // auto-spawning by claiming isBuiltin:true.
                                const fromWorkspaceScope = workspaceScoped.includes(serialized) || workspaceFolderScoped.includes(serialized);
                                const effectiveIsBuiltin = fromWorkspaceScope ? false : (serialized.isBuiltin ?? false);
                                const effectiveUserApproved = fromWorkspaceScope ? false : (serialized.userApproved ?? false);

                                if (fromWorkspaceScope && ((serialized.isBuiltin ?? false) || (serialized.userApproved ?? false))) {
                                        this.logService.warn(
                                                `[MCP Registry] Stripped isBuiltin/userApproved from workspace-scoped server "${serialized.name}" — only Application-scoped config may set these flags.`
                                        );
                                }

                                const server: IMCPServerDefinition = {
                                        name: serialized.name,
                                        command: serialized.command,
                                        args: serialized.args ?? [],
                                        env: serialized.env ?? {},
                                        transport: serialized.transport as MCPTransportType,
                                        version: serialized.version,
                                        description: serialized.description,
                                        categories: serialized.categories ?? [],
                                        installPath: serialized.installPath,
                                        isBuiltin: effectiveIsBuiltin,
                                        secretEnvKeys: serialized.secretEnvKeys,
                                        // Built-ins are always pre-approved. Workspace-scoped
                                        // servers are NEVER pre-approved (effectiveUserApproved
                                        // is false for them, even if the workspace JSON claims
                                        // otherwise). User must explicitly approve via the UI.
                                        userApproved: effectiveIsBuiltin ? true : effectiveUserApproved
                                };
                                this.servers.set(server.name, server);
                        }
                        this.logService.info(`[MCP Registry] Loaded ${this.servers.size} servers (workspace trusted: ${isTrusted})`);
                } catch (error) {
                        this.logService.error('[MCP Registry] Failed to load servers:', error);
                }
        }

        private loadMarketplaceData(): void {
                try {
                        const ratingsRaw = this.storageService.get(MCP_MARKETPLACE_RATINGS_KEY, StorageScope.APPLICATION) as string | undefined;
                        if (ratingsRaw) {
                                const ratings: Record<string, number> = JSON.parse(ratingsRaw);
                                this.marketplaceRatings = new Map(Object.entries(ratings));
                        }

                        const installedRaw = this.storageService.get(MCP_INSTALLED_MARKETPLACE_KEY, StorageScope.APPLICATION) as string | undefined;
                        if (installedRaw) {
                                const installed: string[] = JSON.parse(installedRaw);
                                this.installedMarketplaceItems = new Set(installed);
                        }
                } catch (error) {
                        this.logService.error('[MCP Registry] Failed to load marketplace data:', error);
                }
        }

        // --- Server CRUD ------------------------------------------------------

        async addServer(def: IMCPServerDefinition): Promise<void> {
                if (!def.name || !def.command) {
                        throw new Error('Server definition must have name and command');
                }

                // Store credentials in SecretStorage, NEVER plaintext
                const envPlain: Record<string, string> = {};
                const secretKeys: string[] = [];

                for (const [key, value] of Object.entries(def.env)) {
                        if (this.looksLikeSecret(key, value)) {
                                await this.secretStorageService.set(`${MCP_CREDENTIALS_PREFIX}${def.name}.${key}`, value);
                                secretKeys.push(key);
                        } else {
                                envPlain[key] = value;
                        }
                }

                this.credentialKeys.set(def.name, secretKeys);
                this.servers.set(def.name, def);
                await this.saveServers();
                this._onDidChangeServers.fire();

                this.logService.info(`[MCP Registry] Added server ${def.name}`);
        }

        async removeServer(name: string): Promise<void> {
                // Clean up credentials from SecretStorage
                const secretKeys = this.credentialKeys.get(name) ?? [];
                for (const key of secretKeys) {
                        await this.secretStorageService.delete(`${MCP_CREDENTIALS_PREFIX}${name}.${key}`);
                }
                this.credentialKeys.delete(name);

                this.servers.delete(name);
                await this.saveServers();
                this._onDidChangeServers.fire();

                this.logService.info(`[MCP Registry] Removed server ${name}`);
        }

        async getServer(name: string): Promise<IMCPServerDefinition | undefined> {
                const server = this.servers.get(name);
                if (!server) { return undefined; }

                // Merge credentials from SecretStorage
                const env = { ...server.env };
                const secretKeys = this.credentialKeys.get(name) ?? [];
                for (const key of secretKeys) {
                        const value = await this.secretStorageService.get(`${MCP_CREDENTIALS_PREFIX}${name}.${key}`);
                        if (value) {
                                env[key] = value;
                        }
                }

                return { ...server, env };
        }

        getAllServers(): IMCPServerDefinition[] {
                return Array.from(this.servers.values());
        }

        hasServer(name: string): boolean {
                return this.servers.has(name);
        }

        private async saveServers(): Promise<void> {
                const serialized: ISerializedServer[] = Array.from(this.servers.values()).map(s => ({
                        name: s.name,
                        command: s.command,
                        args: s.args,
                        env: s.env,
                        transport: s.transport,
                        version: s.version,
                        description: s.description,
                        categories: s.categories,
                        installPath: s.installPath,
                        isBuiltin: s.isBuiltin,
                        secretEnvKeys: this.credentialKeys.get(s.name) ?? [],
                        // SEC-7 (H2 follow-up): persist approval flag so the user
                        // doesn't have to re-approve on every Kovix restart.
                        userApproved: s.userApproved ?? s.isBuiltin ?? false
                }));

                await this.configurationService.updateValue(MCP_CONFIG_KEY, serialized);
        }

        /**
         * SEC-7 (H2 follow-up): Mark a server as user-approved. The approval is
         * persisted in the server configuration (kovix.mcp.servers) so it
         * survives restarts. Once approved, MCPConnectionPool's consent gate
         * will let the server spawn.
         *
         * Built-in servers are pre-approved (no-op, but doesn't throw). Throws
         * if the server is not registered.
         */
        async approveServer(name: string): Promise<void> {
                const existing = this.servers.get(name);
                if (!existing) {
                        throw new Error(`Cannot approve unknown MCP server: ${name}`);
                }
                if (existing.isBuiltin) {
                        // Built-ins are always pre-approved; nothing to do.
                        this.logService.info(`[MCP Registry] Approve called on built-in server ${name} (no-op)`);
                        return;
                }
                if (existing.userApproved) {
                        this.logService.info(`[MCP Registry] Server ${name} already approved (no-op)`);
                        return;
                }
                // Update the in-memory definition (immutable replace).
                this.servers.set(name, { ...existing, userApproved: true });
                await this.saveServers();
                this._onDidChangeServers.fire();
                this.logService.info(`[MCP Registry] Server ${name} approved by user`);
        }

        /** Detect likely secrets by key name patterns. */
        private looksLikeSecret(key: string, value: string): boolean {
                const secretPatterns = [
                        /api[_-]?key/i,
                        /token/i,
                        /secret/i,
                        /password/i,
                        /auth/i,
                        /credential/i,
                        /private/i
                ];
                return secretPatterns.some(p => p.test(key)) ||
                        (value.length > 20 && !value.includes(' '));
        }

        // --- Cline Compatibility ----------------------------------------------

        /** Export in .claude-mcp/settings.json format. */
        toClineFormat(): IClineMcpSettings {
                const mcpServers: IClineMcpSettings['mcpServers'] = {};
                for (const [name, config] of this.servers) {
                        mcpServers[name] = {};
                        if (config.command) { mcpServers[name].command = config.command; }
                        if (config.args) { mcpServers[name].args = config.args; }
                        if (config.env) { mcpServers[name].env = config.env; }
                        if (config.transport === MCPTransportType.SSE) { mcpServers[name].url = config.command; }
                }
                return { mcpServers };
        }

        /** Import from Cline-compatible format. */
        async fromClineFormat(settings: IClineMcpSettings): Promise<void> {
                for (const [name, serverConfig] of Object.entries(settings.mcpServers)) {
                        const def: IMCPServerDefinition = {
                                name,
                                command: serverConfig.command ?? serverConfig.url ?? '',
                                args: serverConfig.args ?? [],
                                env: serverConfig.env ?? {},
                                transport: serverConfig.url ? MCPTransportType.SSE : MCPTransportType.Stdio,
                                categories: [],
                                isBuiltin: false
                        };
                        await this.addServer(def);
                }
        }

        // --- Marketplace Data -------------------------------------------------

        async setRating(itemId: string, rating: number): Promise<void> {
                this.marketplaceRatings.set(itemId, Math.max(1, Math.min(5, rating)));
                await this.saveMarketplaceData();
        }

        getRating(itemId: string): number {
                return this.marketplaceRatings.get(itemId) ?? 0;
        }

        async markInstalled(itemId: string): Promise<void> {
                this.installedMarketplaceItems.add(itemId);
                await this.saveMarketplaceData();
        }

        async markUninstalled(itemId: string): Promise<void> {
                this.installedMarketplaceItems.delete(itemId);
                await this.saveMarketplaceData();
        }

        isInstalled(itemId: string): boolean {
                return this.installedMarketplaceItems.has(itemId);
        }

        private async saveMarketplaceData(): Promise<void> {
                this.storageService.store(
                        MCP_MARKETPLACE_RATINGS_KEY,
                        JSON.stringify(Object.fromEntries(this.marketplaceRatings)),
                        StorageScope.APPLICATION,
                        StorageTarget.USER
                );
                this.storageService.store(
                        MCP_INSTALLED_MARKETPLACE_KEY,
                        JSON.stringify(Array.from(this.installedMarketplaceItems)),
                        StorageScope.APPLICATION,
                        StorageTarget.USER
                );
        }

        // --- Lifecycle --------------------------------------------------------

        override dispose(): void {
                this.servers.clear();
                super.dispose();
        }
}
