/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.
/*---------------------------------------------------------------------------------------------
 *  Kovix Settings Migration — one-time migration of legacy `construct.*`
 *  identifiers to `kovix.*` in user settings.json and keybindings.json.
 *
 *  Triggered by the Phase 1.3 rename (see PHASE1_RENAME_REPORT.txt). Without
 *  this, any user who saved `construct.agent.maxRounds: 15` in their
 *  ~/.kovix/User/settings.json prior to upgrade would have that setting
 *  silently dropped on the next launch, because the configuration registry
 *  now registers it under `kovix.agent.maxRounds`. Same risk for keybindings
 *  that reference `construct.focusPanel` etc.
 *
 *  Migration rules:
 *    1. For each key in settings.json starting with `construct.`, copy the
 *       value to `kovix.{suffix}` and delete the old key. If a `kovix.*`
 *       key with the same suffix already exists, the user has already set
 *       it under the new name — keep the new value, drop the legacy one.
 *    2. For each entry in keybindings.json whose `command` starts with
 *       `construct.`, rewrite to `kovix.{suffix}`.
 *    3. Write a backup of the original files to `*.pre-kovix-migration.bak`
 *       before any modification, so the user can roll back manually.
 *    4. Run only once — track completion via a global state key
 *       `kovix.migration.constructToKovix.v1`. Re-running on every launch
 *       would be wasteful and would re-write the backup file.
 *
 *  This is a Konix-specific concern: it lives in the construct contrib
 *  folder because the directory rename (Phase 1.4) is deferred per the
 *  recovery prompt's "lower priority" guidance. When the directory is
 *  eventually renamed to kovix/, this file moves with it.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

const MIGRATION_FLAG_KEY = 'kovix.migration.constructToKovix.v1';

/**
 * One-time migration of legacy `construct.*` identifiers to `kovix.*` in
 * the user's settings.json and keybindings.json files. See file header for
 * the full rationale.
 */
export class KovixSettingsMigrationContribution extends Disposable implements IWorkbenchContribution {
        static readonly ID = 'workbench.contrib.kovixSettingsMigration';

        constructor(
                @IEnvironmentService private readonly environmentService: IEnvironmentService,
                @IFileService private readonly fileService: IFileService,
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
        ) {
                super();

                // Defer to the next tick so we don't block workbench restoration.
                // The migration is best-effort — if it fails, we log and move on;
                // we do NOT throw, because a thrown error here would crash the
                // workbench on launch for users with malformed settings.
                queueMicrotask(() => this.runMigration().catch(err => {
                        this.logService.error('[KovixMigration] Unexpected error:', err);
                }));
        }

        private async runMigration(): Promise<void> {
                // Idempotency guard — only run once per profile.
                if (this.storageService.getBoolean(MIGRATION_FLAG_KEY, StorageScope.APPLICATION, false)) {
                        return;
                }

                const userHome = this.environmentService.userRoamingDataHome;
                if (!userHome) {
                        this.logService.info('[KovixMigration] No userRoamingDataHome — skipping migration (likely a fresh profile with no legacy settings).');
                        this.storageService.store(MIGRATION_FLAG_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
                        return;
                }

                const settingsUri = joinPath(userHome, 'settings.json');
                const keybindingsUri = joinPath(userHome, 'keybindings.json');

                let migratedSettings = 0;
                let migratedKeybindings = 0;

                // 1. Migrate settings.json
                try {
                        migratedSettings = await this.migrateSettingsFile(settingsUri);
                } catch (err) {
                        this.logService.warn(`[KovixMigration] settings.json migration failed:`, err);
                }

                // 2. Migrate keybindings.json
                try {
                        migratedKeybindings = await this.migrateKeybindingsFile(keybindingsUri);
                } catch (err) {
                        this.logService.warn(`[KovixMigration] keybindings.json migration failed:`, err);
                }

                if (migratedSettings > 0 || migratedKeybindings > 0) {
                        this.logService.info(
                                `[KovixMigration] Migrated ${migratedSettings} settings keys and ${migratedKeybindings} keybinding commands from construct.* to kovix.*. ` +
                                `Backups written as *.pre-kovix-migration.bak in ${userHome.fsPath}.`
                        );
                } else {
                        this.logService.info('[KovixMigration] No construct.* keys or commands found in user settings — no migration needed.');
                }

                // Mark as done regardless of whether anything was migrated, so we don't re-scan on every launch.
                this.storageService.store(MIGRATION_FLAG_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
        }

        /**
         * Migrate a settings.json file. Returns the count of keys migrated.
         * Writes a backup before modifying. No-op if file does not exist.
         */
        private async migrateSettingsFile(settingsUri: URI): Promise<number> {
                const exists = await this.fileService.exists(settingsUri);
                if (!exists) {
                        return 0;
                }
                const content = (await this.fileService.readFile(settingsUri)).value.toString();
                // Strip JSON comments (VS Code settings.json allows // and /* */ comments).
                const stripped = this.stripJsonComments(content);
                const parsed = JSON.parse(stripped) as Record<string, unknown>;
                if (!parsed || typeof parsed !== 'object') {
                        return 0;
                }

                const constructKeys = Object.keys(parsed).filter(k => k.startsWith('construct.'));
                if (constructKeys.length === 0) {
                        return 0;
                }

                // Write backup (preserves original text, including comments).
                const backupUri = settingsUri.with({ path: settingsUri.path + '.pre-kovix-migration.bak' });
                await this.fileService.writeFile(backupUri, VSBuffer.fromString(content));

                let migrated = 0;
                for (const oldKey of constructKeys) {
                        const newKey = 'kovix.' + oldKey.slice('construct.'.length);
                        if (newKey in parsed) {
                                // User already has a value under the new name — keep new, drop legacy.
                                this.logService.info(`[KovixMigration] settings: dropping legacy ${oldKey} (kovix.* already present)`);
                                delete parsed[oldKey];
                        } else {
                                parsed[newKey] = parsed[oldKey];
                                delete parsed[oldKey];
                                this.logService.info(`[KovixMigration] settings: ${oldKey} -> ${newKey}`);
                                migrated++;
                        }
                }

                // Write migrated file (4-space indent matches VS Code convention).
                // We lose comments on rewrite — this is acceptable because the backup preserves them.
                const newContent = JSON.stringify(parsed, null, '\t') + '\n';
                await this.fileService.writeFile(settingsUri, VSBuffer.fromString(newContent));
                return migrated;
        }

        /**
         * Migrate a keybindings.json file. Returns the count of commands migrated.
         * Writes a backup before modifying. No-op if file does not exist.
         */
        private async migrateKeybindingsFile(keybindingsUri: URI): Promise<number> {
                const exists = await this.fileService.exists(keybindingsUri);
                if (!exists) {
                        return 0;
                }
                const content = (await this.fileService.readFile(keybindingsUri)).value.toString();
                const stripped = this.stripJsonComments(content);
                const parsed = JSON.parse(stripped) as Array<{ command?: string; [k: string]: unknown }>;
                if (!Array.isArray(parsed)) {
                        return 0;
                }

                let migrated = 0;
                let anyChanged = false;
                for (const entry of parsed) {
                        if (entry && typeof entry === 'object' && typeof entry.command === 'string' && entry.command.startsWith('construct.')) {
                                const oldCmd = entry.command;
                                entry.command = 'kovix.' + oldCmd.slice('construct.'.length);
                                this.logService.info(`[KovixMigration] keybinding: ${oldCmd} -> ${entry.command}`);
                                migrated++;
                                anyChanged = true;
                        }
                }

                if (!anyChanged) {
                        return 0;
                }

                // Write backup
                const backupUri = keybindingsUri.with({ path: keybindingsUri.path + '.pre-kovix-migration.bak' });
                await this.fileService.writeFile(backupUri, VSBuffer.fromString(content));

                const newContent = JSON.stringify(parsed, null, '\t') + '\n';
                await this.fileService.writeFile(keybindingsUri, VSBuffer.fromString(newContent));
                return migrated;
        }

        /**
         * Minimal JSON comment stripper — handles double-slash line comments and
         * slash-star block comments. VS Code's settings.json and keybindings.json
         * both allow comments, but the built-in JSON.parse does not. We avoid
         * pulling in the full jsonc-parser for this one-shot migration.
         *
         * Limitations: does not handle comments inside string literals. That's
         * acceptable here because user settings rarely contain comment markers
         * inside string values, and if they do, the migration will simply log a
         * warning and skip the file (the backup preserves the original).
         */
        private stripJsonComments(text: string): string {
                let result = '';
                let i = 0;
                let inString = false;
                while (i < text.length) {
                        const ch = text[i];
                        const next = text[i + 1];
                        if (inString) {
                                result += ch;
                                if (ch === '\\' && i + 1 < text.length) {
                                        result += next;
                                        i += 2;
                                        continue;
                                }
                                if (ch === '"') {
                                        inString = false;
                                }
                                i++;
                                continue;
                        }
                        if (ch === '"') {
                                inString = true;
                                result += ch;
                                i++;
                                continue;
                        }
                        if (ch === '/' && next === '/') {
                                // Skip to end of line
                                while (i < text.length && text[i] !== '\n') {
                                        i++;
                                }
                                continue;
                        }
                        if (ch === '/' && next === '*') {
                                i += 2;
                                while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                                        i++;
                                }
                                i += 2;
                                continue;
                        }
                        result += ch;
                        i++;
                }
                return result;
        }
}
