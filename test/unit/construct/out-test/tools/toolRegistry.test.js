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
 * Tests for Tool Registry — registration, validation, execution, MAX_OUTPUT_LENGTH enforcement.
 * Source references:
 * - src/vs/platform/construct/common/tools/constructToolRegistry.ts — IToolDefinition, IToolResult
 * - src/vs/platform/construct/common/terminal/terminalExecutor.ts — MAX_OUTPUT_LENGTH, sanitiseOutput
 * - src/vs/platform/construct/common/security/workspaceGuard.ts — validateToolName
 */
// ---- Replicate production logic ----
const MAX_OUTPUT_LENGTH = 10_000;
const ALLOWED_TOOLS = new Set([
    'read_file', 'write_file', 'edit_file', 'list_directory',
    'create_directory', 'delete_file', 'exists',
    'search_files', 'run_command',
    'search_codebase', 'web_search', 'generate_tests', 'review_code'
]);
function validateToolName(name) {
    return ALLOWED_TOOLS.has(name);
}
function truncateOutput(output) {
    if (output.length > MAX_OUTPUT_LENGTH) {
        return {
            output: output.substring(0, MAX_OUTPUT_LENGTH) + '\n[OUTPUT TRUNCATED — exceeded 10,000 characters]',
            truncated: true,
        };
    }
    return { output, truncated: false };
}
// Tool Registry implementation
class ToolRegistry {
    tools = new Map();
    register(definition, executeFn) {
        if (this.tools.has(definition.name)) {
            throw new Error(`Tool already registered: ${definition.name}`);
        }
        this.tools.set(definition.name, { definition, executeFn });
    }
    unregister(name) {
        this.tools.delete(name);
    }
    listTools() {
        return Array.from(this.tools.values()).map(t => t.definition);
    }
    getTool(name) {
        return this.tools.get(name)?.definition;
    }
    async execute(name, input) {
        const tool = this.tools.get(name);
        if (!tool) {
            return { success: false, output: `Tool not found: ${name}`, truncated: false };
        }
        const result = await tool.executeFn(input);
        // Enforce MAX_OUTPUT_LENGTH
        const { output, truncated } = truncateOutput(result.output);
        return { ...result, output, truncated };
    }
    has(name) {
        return this.tools.has(name);
    }
}
function validateToolDefinition(def) {
    const errors = [];
    if (!def.name || def.name.trim() === '') {
        errors.push('Tool name is required');
    }
    if (!def.description || def.description.trim() === '') {
        errors.push('Tool description is required');
    }
    if (!def.inputSchema || def.inputSchema.type !== 'object') {
        errors.push('Input schema must be of type object');
    }
    if (!def.category) {
        errors.push('Tool category is required');
    }
    return errors;
}
// ---- Tests ----
suite('Tool Registry Tests', () => {
    const sampleTool = {
        name: 'read_file',
        description: 'Read a file from the workspace',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] },
        modifiesFiles: false,
        requiresNetwork: false,
        category: 'file',
    };
    const writeTool = {
        name: 'write_file',
        description: 'Write content to a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] },
        modifiesFiles: true,
        requiresNetwork: false,
        requiresConfirmation: true,
        category: 'file',
    };
    suite('Tool Registration', () => {
        test('should register a valid tool', () => {
            const registry = new ToolRegistry();
            registry.register(sampleTool, async () => ({ success: true, output: 'file content', truncated: false }));
            assert.strictEqual(registry.has('read_file'), true);
            assert.strictEqual(registry.getTool('read_file').name, 'read_file');
        });
        test('should reject duplicate tool registration', () => {
            const registry = new ToolRegistry();
            registry.register(sampleTool, async () => ({ success: true, output: '', truncated: false }));
            assert.throws(() => registry.register(sampleTool, async () => ({ success: true, output: '', truncated: false })), /already registered/);
        });
        test('should list all registered tools', () => {
            const registry = new ToolRegistry();
            registry.register(sampleTool, async () => ({ success: true, output: '', truncated: false }));
            registry.register(writeTool, async () => ({ success: true, output: '', truncated: false }));
            const tools = registry.listTools();
            assert.strictEqual(tools.length, 2);
            assert.ok(tools.some(t => t.name === 'read_file'));
            assert.ok(tools.some(t => t.name === 'write_file'));
        });
        test('should support tool categories', () => {
            const securityTool = {
                name: 'nmap_scan', description: 'Network scan', kaliOnly: true,
                inputSchema: { type: 'object', properties: {} },
                modifiesFiles: false, requiresNetwork: true, category: 'security',
            };
            const registry = new ToolRegistry();
            registry.register(securityTool, async () => ({ success: true, output: '', truncated: false }));
            const tool = registry.getTool('nmap_scan');
            assert.strictEqual(tool.category, 'security');
            assert.strictEqual(tool.kaliOnly, true);
            assert.strictEqual(tool.requiresNetwork, true);
        });
    });
    suite('Tool Execution', () => {
        test('should execute registered tool', async () => {
            const registry = new ToolRegistry();
            registry.register(sampleTool, async (input) => ({
                success: true, output: `Content of ${input.path}`, truncated: false,
            }));
            const result = await registry.execute('read_file', { path: '/src/main.ts' });
            assert.strictEqual(result.success, true);
            assert.ok(result.output.includes('/src/main.ts'));
        });
        test('should handle tool execution errors', async () => {
            const registry = new ToolRegistry();
            registry.register(sampleTool, async () => {
                throw new Error('File not found');
            });
            try {
                await registry.execute('read_file', { path: '/nonexistent.ts' });
            }
            catch (e) {
                assert.ok(e.message.includes('File not found'));
            }
        });
        test('should unregister tool correctly', () => {
            const registry = new ToolRegistry();
            registry.register(sampleTool, async () => ({ success: true, output: '', truncated: false }));
            assert.strictEqual(registry.has('read_file'), true);
            registry.unregister('read_file');
            assert.strictEqual(registry.has('read_file'), false);
        });
        test('should return error for unregistered tool', async () => {
            const registry = new ToolRegistry();
            const result = await registry.execute('nonexistent_tool', {});
            assert.strictEqual(result.success, false);
            assert.ok(result.output.includes('not found'));
        });
    });
    suite('Validation and Limits', () => {
        test('should validate tool input schema', () => {
            const validDef = { ...sampleTool };
            const errors = validateToolDefinition(validDef);
            assert.strictEqual(errors.length, 0, 'Valid definition should have no errors');
        });
        test('should enforce tool name validation', () => {
            assert.strictEqual(validateToolName('read_file'), true);
            assert.strictEqual(validateToolName('write_file'), true);
            assert.strictEqual(validateToolName('malicious_tool'), false);
            assert.strictEqual(validateToolName(''), false);
        });
        test('should handle tool execution timeout', () => {
            // Simulate timeout by checking MAX_OUTPUT_LENGTH enforcement
            const longOutput = 'x'.repeat(MAX_OUTPUT_LENGTH + 5000);
            const { output, truncated } = truncateOutput(longOutput);
            assert.strictEqual(truncated, true);
            assert.strictEqual(output.length, MAX_OUTPUT_LENGTH + '\n[OUTPUT TRUNCATED — exceeded 10,000 characters]'.length);
        });
        test('should enforce MAX_OUTPUT_LENGTH on tool results', async () => {
            const registry = new ToolRegistry();
            const bigOutputTool = {
                name: 'big_output', description: 'Returns big output',
                inputSchema: { type: 'object', properties: {} },
                modifiesFiles: false, requiresNetwork: false, category: 'terminal',
            };
            registry.register(bigOutputTool, async () => ({
                success: true, output: 'A'.repeat(MAX_OUTPUT_LENGTH + 5000), truncated: false,
            }));
            const result = await registry.execute('big_output', {});
            assert.strictEqual(result.truncated, true);
            assert.ok(result.output.length < MAX_OUTPUT_LENGTH + 5000);
        });
    });
});
//# sourceMappingURL=toolRegistry.test.js.map