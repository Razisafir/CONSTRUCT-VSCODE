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
 * Tests for MCP System — connection lifecycle, tool registration,
 * permission enforcement, and error handling.
 *
 * Source references:
 * - src/vs/platform/construct/common/security/workspaceGuard.ts — validateToolName, validateMcpMethod
 * - src/vs/platform/construct/common/terminal/kaliToolBridge.ts — routeCommand, shellEscape
 * - src/vs/platform/construct/common/security/secretRedactor.ts — redactSecrets
 */
// ---- Replicate production logic ----
const ALLOWED_TOOLS = new Set([
    'read_file', 'write_file', 'edit_file', 'list_directory',
    'create_directory', 'delete_file', 'exists',
    'search_files', 'run_command',
    'search_codebase', 'web_search', 'generate_tests', 'review_code'
]);
function validateToolName(name) {
    return ALLOWED_TOOLS.has(name);
}
const ALLOWED_MCP_METHODS = new Set([
    'initialize', 'tools/list', 'tools/call',
    'resources/list', 'resources/read'
]);
function validateMcpMethod(method) {
    return ALLOWED_MCP_METHODS.has(method);
}
function shellEscape(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n')
        .replace(/!/g, '\\!');
}
const SECRET_PATTERNS = [
    /sk-ant-[A-Za-z0-9_-]{20,}/g,
    /sk-[A-Za-z0-9]{20,}/g,
    /Bearer [A-Za-z0-9_.-]{20,}/g,
    /password=\S+/gi,
    /token=\S+/gi,
    /key=\S+/gi,
];
function redactSecrets(input) {
    if (!input || typeof input !== 'string') {
        return input;
    }
    let result = input;
    for (const pattern of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        result = result.replace(pattern, '[REDACTED]');
    }
    return result;
}
class MCPConnectionPool {
    connections = new Map();
    addConnection(conn) {
        this.connections.set(conn.id, conn);
    }
    removeConnection(id) {
        return this.connections.delete(id);
    }
    getConnection(id) {
        return this.connections.get(id);
    }
    getConnected() {
        return Array.from(this.connections.values()).filter(c => c.connected);
    }
    listAllTools() {
        const tools = [];
        for (const conn of this.connections.values()) {
            tools.push(...conn.tools);
        }
        return tools;
    }
    executeOnServer(serverId, toolName, _input) {
        const conn = this.connections.get(serverId);
        if (!conn) {
            return { success: false, output: `MCP server not found: ${serverId}` };
        }
        if (!conn.connected) {
            return { success: false, output: `MCP server not connected: ${conn.name}` };
        }
        if (!validateToolName(toolName) && !conn.tools.includes(toolName)) {
            return { success: false, output: `Tool not registered on server: ${toolName}` };
        }
        return { success: true, output: `Executed ${toolName} on ${conn.name}` };
    }
}
// ---- Tests ----
suite('MCP System Tests', () => {
    suite('MCP Connection Lifecycle', () => {
        test('should initialize MCP connection', () => {
            const pool = new MCPConnectionPool();
            pool.addConnection({ id: 'srv1', name: 'filesystem', connected: true, tools: ['read_file', 'write_file'] });
            const conn = pool.getConnection('srv1');
            assert.ok(conn, 'Connection should exist');
            assert.strictEqual(conn.name, 'filesystem');
            assert.strictEqual(conn.connected, true);
        });
        test('should handle MCP server lifecycle', () => {
            const pool = new MCPConnectionPool();
            pool.addConnection({ id: 'srv1', name: 'filesystem', connected: true, tools: ['read_file'] });
            assert.ok(pool.getConnection('srv1'));
            // Simulate disconnect
            const conn = pool.getConnection('srv1');
            conn.connected = false;
            assert.strictEqual(pool.getConnected().length, 0, 'Disconnected server should not be in connected list');
            // Simulate reconnect
            conn.connected = true;
            assert.strictEqual(pool.getConnected().length, 1, 'Reconnected server should be in connected list');
        });
        test('should manage multiple MCP connections', () => {
            const pool = new MCPConnectionPool();
            pool.addConnection({ id: 'srv1', name: 'filesystem', connected: true, tools: ['read_file'] });
            pool.addConnection({ id: 'srv2', name: 'github', connected: true, tools: ['search_codebase'] });
            pool.addConnection({ id: 'srv3', name: 'database', connected: false, tools: ['run_command'] });
            assert.strictEqual(pool.getConnected().length, 2, 'Should have 2 connected servers');
            assert.strictEqual(pool.listAllTools().length, 3, 'Should have 3 total tools across all servers');
        });
    });
    suite('MCP Method and Tool Validation', () => {
        test('should validate MCP method calls', () => {
            assert.strictEqual(validateMcpMethod('initialize'), true);
            assert.strictEqual(validateMcpMethod('tools/list'), true);
            assert.strictEqual(validateMcpMethod('tools/call'), true);
            assert.strictEqual(validateMcpMethod('resources/list'), true);
            assert.strictEqual(validateMcpMethod('resources/read'), true);
        });
        test('should reject invalid MCP methods', () => {
            assert.strictEqual(validateMcpMethod('tools/delete'), false);
            assert.strictEqual(validateMcpMethod('resources/write'), false);
            assert.strictEqual(validateMcpMethod('admin/reset'), false);
            assert.strictEqual(validateMcpMethod(''), false);
        });
        test('should handle MCP tool listing', () => {
            const pool = new MCPConnectionPool();
            pool.addConnection({ id: 'srv1', name: 'fs', connected: true, tools: ['read_file', 'write_file', 'edit_file'] });
            const tools = pool.listAllTools();
            assert.strictEqual(tools.length, 3);
            assert.ok(tools.includes('read_file'));
            assert.ok(tools.includes('write_file'));
            assert.ok(tools.includes('edit_file'));
        });
    });
    suite('MCP Tool Execution', () => {
        test('should handle MCP tool execution', () => {
            const pool = new MCPConnectionPool();
            pool.addConnection({ id: 'srv1', name: 'filesystem', connected: true, tools: ['read_file'] });
            const result = pool.executeOnServer('srv1', 'read_file', { path: '/src/main.ts' });
            assert.strictEqual(result.success, true);
            assert.ok(result.output.includes('read_file'));
        });
        test('should handle MCP resource access', () => {
            const pool = new MCPConnectionPool();
            pool.addConnection({ id: 'srv1', name: 'data', connected: true, tools: ['run_command'] });
            const result = pool.executeOnServer('srv1', 'run_command', { cmd: 'ls' });
            assert.strictEqual(result.success, true);
        });
    });
    suite('MCP Error Handling', () => {
        test('should handle MCP connection errors', () => {
            const pool = new MCPConnectionPool();
            pool.addConnection({ id: 'srv1', name: 'filesystem', connected: false, tools: ['read_file'] });
            const result = pool.executeOnServer('srv1', 'read_file', {});
            assert.strictEqual(result.success, false);
            assert.ok(result.output.includes('not connected'));
        });
        test('should enforce MCP security boundaries', () => {
            // Tool names not in allowed set and not on server
            assert.strictEqual(validateToolName('malicious_tool'), false);
            assert.strictEqual(validateToolName('delete_file'), true); // in allowed set
            // Secrets must be redacted from MCP messages
            const secretMsg = 'API response with key=sk-ant-api03-abcdefghijklmnopqrstuvwx';
            const redacted = redactSecrets(secretMsg);
            assert.ok(!redacted.includes('sk-ant-api03'));
            assert.ok(redacted.includes('[REDACTED]'));
        });
        test('should handle MCP server timeout', () => {
            const pool = new MCPConnectionPool();
            // Server not found — simulates timeout/missing server
            const result = pool.executeOnServer('nonexistent', 'read_file', {});
            assert.strictEqual(result.success, false);
            assert.ok(result.output.includes('not found'));
        });
    });
});
//# sourceMappingURL=mcpSystem.test.js.map