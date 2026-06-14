"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
/**
 * Tests for Configuration — defaults, validation, change events, scopes.
 * Source references:
 * - src/vs/platform/construct/common/constructTypes.ts — safeJsonParse
 */
// ---- Replicate production logic ----
function safeJsonParse(input, fallback) {
    try {
        return JSON.parse(input);
    }
    catch {
        return fallback;
    }
}
class ConfigurationService {
    values = new Map();
    schema = new Map();
    changeListeners = [];
    changeLog = [];
    constructor() {
        this.registerDefaults();
    }
    registerDefaults() {
        const defaults = [
            { key: 'construct.agent.model', type: 'string', defaultValue: 'gpt-4', scope: 'global', description: 'Default model' },
            { key: 'construct.agent.maxTokens', type: 'number', defaultValue: 4096, min: 1, max: 128000, scope: 'global', description: 'Max tokens' },
            { key: 'construct.terminal.restrictedMode', type: 'boolean', defaultValue: false, scope: 'workspace', description: 'Restricted mode' },
            { key: 'construct.terminal.commandTimeout', type: 'number', defaultValue: 60, min: 10, max: 300, scope: 'workspace', description: 'Command timeout' },
            { key: 'construct.security.workspaceGuard', type: 'boolean', defaultValue: true, scope: 'global', description: 'Workspace guard' },
            { key: 'construct.agent.offlineMode', type: 'boolean', defaultValue: false, scope: 'workspace', description: 'Offline mode' },
        ];
        for (const s of defaults) {
            this.schema.set(s.key, s);
            this.values.set(s.key, s.defaultValue);
        }
    }
    get(key) {
        return this.values.get(key);
    }
    set(key, value, scope = 'workspace') {
        const s = this.schema.get(key);
        if (!s) {
            return [`Unknown config key: ${key}`];
        }
        const errors = this.validateValue(key, value);
        if (errors.length > 0) {
            return errors;
        }
        const oldValue = this.values.get(key);
        this.values.set(key, value);
        const event = { key, oldValue, newValue: value, scope };
        this.changeLog.push(event);
        for (const listener of this.changeListeners) {
            listener(event);
        }
        return [];
    }
    validateValue(key, value) {
        const s = this.schema.get(key);
        if (!s) {
            return [`Unknown config key: ${key}`];
        }
        const errors = [];
        if (typeof value !== s.type) {
            errors.push(`Config "${key}" must be of type ${s.type}, got ${typeof value}`);
        }
        if (s.enum && !s.enum.includes(value)) {
            errors.push(`Config "${key}" must be one of: ${s.enum.join(', ')}`);
        }
        if (s.type === 'number' && typeof value === 'number') {
            if (s.min !== undefined && value < s.min) {
                errors.push(`Config "${key}" must be >= ${s.min}`);
            }
            if (s.max !== undefined && value > s.max) {
                errors.push(`Config "${key}" must be <= ${s.max}`);
            }
        }
        if (s.pattern && typeof value === 'string') {
            if (!new RegExp(s.pattern).test(value)) {
                errors.push(`Config "${key}" must match pattern: ${s.pattern}`);
            }
        }
        return errors;
    }
    onChange(listener) {
        this.changeListeners.push(listener);
        return () => {
            const idx = this.changeListeners.indexOf(listener);
            if (idx >= 0) {
                this.changeListeners.splice(idx, 1);
            }
        };
    }
    getChangeLog() { return [...this.changeLog]; }
    validateSchema() {
        const errors = [];
        for (const [key, value] of this.values) {
            errors.push(...this.validateValue(key, value));
        }
        return errors;
    }
    sanitizePath(value) {
        // Remove path traversal and normalize separators
        return value.replace(/\.\./g, '').replace(/\\/g, '/').replace(/\/+/g, '/');
    }
    mergeWithDefaults(userConfig) {
        const merged = {};
        // Start with defaults
        for (const [key, s] of this.schema) {
            merged[key] = s.defaultValue;
        }
        // Override with user values
        for (const [key, value] of Object.entries(userConfig)) {
            if (this.schema.has(key)) {
                merged[key] = value;
            }
        }
        return merged;
    }
    migrate(oldVersion, config) {
        const migrated = { ...config };
        // v1 to v2 migration: construct.agent.modelName → construct.agent.model
        if (oldVersion.startsWith('1.')) {
            if ('construct.agent.modelName' in migrated) {
                migrated['construct.agent.model'] = migrated['construct.agent.modelName'];
                delete migrated['construct.agent.modelName'];
            }
        }
        return migrated;
    }
}
// ---- Tests ----
suite('Configuration Tests', () => {
    suite('Defaults and Merging', () => {
        test('should load default configuration', () => {
            const config = new ConfigurationService();
            assert.strictEqual(config.get('construct.agent.model'), 'gpt-4');
            assert.strictEqual(config.get('construct.agent.maxTokens'), 4096);
            assert.strictEqual(config.get('construct.terminal.restrictedMode'), false);
            assert.strictEqual(config.get('construct.terminal.commandTimeout'), 60);
        });
        test('should merge user config with defaults', () => {
            const config = new ConfigurationService();
            const merged = config.mergeWithDefaults({
                'construct.agent.model': 'claude-3',
                'construct.terminal.commandTimeout': 120,
            });
            assert.strictEqual(merged['construct.agent.model'], 'claude-3', 'User value should override');
            assert.strictEqual(merged['construct.terminal.commandTimeout'], 120, 'User value should override');
            assert.strictEqual(merged['construct.agent.maxTokens'], 4096, 'Default should remain');
        });
    });
    suite('Validation', () => {
        test('should validate config schema', () => {
            const config = new ConfigurationService();
            const errors = config.validateSchema();
            assert.strictEqual(errors.length, 0, 'Default config should be valid');
        });
        test('should handle invalid config values', () => {
            const config = new ConfigurationService();
            // Wrong type
            const typeErrors = config.set('construct.agent.maxTokens', 'not-a-number');
            assert.ok(typeErrors.length > 0, 'Should reject wrong type');
            // Out of range
            const rangeErrors = config.set('construct.agent.maxTokens', 999999);
            assert.ok(rangeErrors.some(e => e.includes('must be <= 128000')));
            const minErrors = config.set('construct.agent.maxTokens', 0);
            assert.ok(minErrors.some(e => e.includes('must be >= 1')));
            // Unknown key
            const unknownErrors = config.set('construct.nonexistent.key', true);
            assert.ok(unknownErrors.some(e => e.includes('Unknown')));
        });
    });
    suite('Change Events', () => {
        test('should emit config change events', () => {
            const config = new ConfigurationService();
            const events = [];
            config.onChange(e => events.push(e));
            config.set('construct.agent.model', 'claude-3');
            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].key, 'construct.agent.model');
            assert.strictEqual(events[0].oldValue, 'gpt-4');
            assert.strictEqual(events[0].newValue, 'claude-3');
        });
        test('should support config scopes (workspace vs global)', () => {
            const config = new ConfigurationService();
            config.set('construct.terminal.restrictedMode', true, 'workspace');
            config.set('construct.agent.model', 'gpt-4o', 'global');
            const log = config.getChangeLog();
            assert.strictEqual(log[0].scope, 'workspace');
            assert.strictEqual(log[1].scope, 'global');
        });
    });
    suite('Special Cases', () => {
        test('should handle config migration between versions', () => {
            const config = new ConfigurationService();
            const oldConfig = {
                'construct.agent.modelName': 'gpt-3.5',
                'construct.agent.maxTokens': 2048,
            };
            const migrated = config.migrate('1.0.0', oldConfig);
            assert.strictEqual(migrated['construct.agent.model'], 'gpt-3.5', 'Should migrate modelName to model');
            assert.strictEqual(migrated['construct.agent.modelName'], undefined, 'Old key should be removed');
        });
        test('should sanitize config paths', () => {
            const config = new ConfigurationService();
            assert.ok(!config.sanitizePath('/workspace/../etc/passwd').includes('..'), 'Should remove .. from path');
            assert.strictEqual(config.sanitizePath('C:\\Users\\dev'), 'C:/Users/dev');
            assert.strictEqual(config.sanitizePath('/workspace//src'), '/workspace/src');
        });
        test('should handle missing config file gracefully', () => {
            // safeJsonParse with fallback handles corrupt/missing config
            const empty = safeJsonParse('', null);
            assert.strictEqual(empty, null);
            const corrupt = safeJsonParse('{bad json', {});
            assert.deepStrictEqual(corrupt, {});
            const valid = safeJsonParse('{"construct.agent.model":"gpt-4"}', {});
            assert.deepStrictEqual(valid, { 'construct.agent.model': 'gpt-4' });
        });
    });
});
//# sourceMappingURL=configuration.test.js.map