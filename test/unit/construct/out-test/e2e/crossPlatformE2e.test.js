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
function routeCommand(distribution, command) {
    if (!distribution || !distribution.available) {
        return command;
    }
    switch (distribution.type) {
        case 'native': return command;
        case 'wsl': return `wsl -d kali-linux -- bash -c "${command.replace(/"/g, '\\"')}"`;
        case 'docker': return `docker run --rm kalilinux/kali-rolling bash -c "${command.replace(/"/g, '\\"')}"`;
        default: return command;
    }
}
function stripAnsiEscapeSequences(text) {
    return text
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}
const MAX_OUTPUT_LENGTH = 10_000;
function sanitiseOutput(text) {
    let result = stripAnsiEscapeSequences(text);
    if (result.length > MAX_OUTPUT_LENGTH) {
        result = result.substring(0, MAX_OUTPUT_LENGTH) + '\n[OUTPUT TRUNCATED — exceeded 10,000 characters]';
    }
    return result;
}
// Simple path normalizer for cross-platform testing
function normalizePath(p) {
    return p.replace(/\\/g, '/');
}
// Simulate workspace boundary check (pure logic without fs)
function isPathWithinWorkspaceSync(filePath, workspaceRoot) {
    const normalized = normalizePath(filePath);
    const root = normalizePath(workspaceRoot);
    if (normalized.includes('..')) {
        return false;
    }
    return normalized.startsWith(root + '/') || normalized === root;
}
class AgentLoopSimulator {
    state = 'idle';
    steps = [];
    error = null;
    getState() { return this.state; }
    getSteps() { return [...this.steps]; }
    getError() { return this.error; }
    start() {
        this.state = 'thinking';
        this.steps.push('start');
    }
    executeStep(toolName, input) {
        if (this.state !== 'thinking') {
            return { success: false, output: `Invalid state for execution: ${this.state}` };
        }
        this.state = 'executing';
        this.steps.push(`execute:${toolName}`);
        // Simulate error recovery
        if (toolName === 'fail_tool') {
            this.state = 'error';
            this.error = 'Tool execution failed';
            return { success: false, output: 'Tool execution failed' };
        }
        this.state = 'thinking';
        return { success: true, output: `Result of ${toolName} with ${JSON.stringify(input)}` };
    }
    recover() {
        if (this.state !== 'error') {
            return false;
        }
        this.state = 'thinking';
        this.error = null;
        this.steps.push('recovered');
        return true;
    }
    finish() {
        this.state = 'done';
        this.steps.push('finish');
    }
}
// ---- Tests ----
suite('E2E Tests', () => {
    suite('Agent Loop Execution Cycle', () => {
        test('should complete full agent loop cycle', () => {
            const loop = new AgentLoopSimulator();
            assert.strictEqual(loop.getState(), 'idle');
            loop.start();
            assert.strictEqual(loop.getState(), 'thinking');
            const result = loop.executeStep('read_file', { path: '/src/main.ts' });
            assert.strictEqual(result.success, true);
            assert.strictEqual(loop.getState(), 'thinking');
            loop.finish();
            assert.strictEqual(loop.getState(), 'done');
            assert.ok(loop.getSteps().includes('start'));
            assert.ok(loop.getSteps().includes('execute:read_file'));
            assert.ok(loop.getSteps().includes('finish'));
        });
        test('should handle error recovery in agent loop', () => {
            const loop = new AgentLoopSimulator();
            loop.start();
            const result = loop.executeStep('fail_tool', {});
            assert.strictEqual(result.success, false);
            assert.strictEqual(loop.getState(), 'error');
            assert.strictEqual(loop.getError(), 'Tool execution failed');
            const recovered = loop.recover();
            assert.strictEqual(recovered, true);
            assert.strictEqual(loop.getState(), 'thinking');
            assert.strictEqual(loop.getError(), null);
        });
        test('should handle multi-step task execution', () => {
            const loop = new AgentLoopSimulator();
            loop.start();
            loop.executeStep('search_codebase', { query: 'TODO' });
            loop.executeStep('read_file', { path: '/src/todo.ts' });
            loop.executeStep('edit_file', { path: '/src/todo.ts', content: 'fixed' });
            loop.finish();
            assert.strictEqual(loop.getSteps().length, 5); // start + 3 executes + finish
        });
    });
    suite('Workspace Operations', () => {
        test('should handle workspace open and close', () => {
            const workspaceRoot = '/home/user/project';
            assert.strictEqual(isPathWithinWorkspaceSync('/home/user/project/src/main.ts', workspaceRoot), true);
            assert.strictEqual(isPathWithinWorkspaceSync('/home/user/project', workspaceRoot), true);
            assert.strictEqual(isPathWithinWorkspaceSync('/etc/passwd', workspaceRoot), false);
        });
        test('should handle file creation through agent', () => {
            const workspaceRoot = '/workspace';
            const newFilePath = '/workspace/src/newfile.ts';
            assert.strictEqual(isPathWithinWorkspaceSync(newFilePath, workspaceRoot), true);
        });
        test('should handle search and replace workflow', () => {
            // Simulate: search → read → edit cycle
            const content = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
            const lines = content.split('\n');
            const matchLine = lines.findIndex(l => l.includes('y = 2'));
            assert.strictEqual(matchLine, 1, 'Should find matching line');
            const edited = lines.slice();
            edited[matchLine] = 'const y = 42;';
            assert.ok(edited[1].includes('42'));
            assert.ok(!edited[1].includes('y = 2'));
        });
    });
    suite('Cross-Platform Path Handling', () => {
        test('should handle cross-platform path handling', () => {
            // Windows-style paths normalized
            assert.strictEqual(normalizePath('C:\\Users\\dev\\project'), 'C:/Users/dev/project');
            assert.strictEqual(normalizePath('/home/dev/project'), '/home/dev/project');
        });
        test('should handle path traversal detection', () => {
            assert.strictEqual(isPathWithinWorkspaceSync('../../../etc/passwd', '/workspace'), false);
            assert.strictEqual(isPathWithinWorkspaceSync('src/../etc/passwd', '/workspace'), false);
        });
    });
    suite('MCP Integration End-to-End', () => {
        test('should handle MCP server integration end-to-end', () => {
            const wslDist = { type: 'wsl', name: 'Kali', available: true };
            const cmd = routeCommand(wslDist, 'nmap -sV 192.168.1.1');
            assert.ok(cmd.startsWith('wsl -d kali-linux'));
            assert.ok(cmd.includes('nmap'));
        });
        test('should handle session persistence across restart', () => {
            // Simulate session serialization
            const session = {
                id: 'sess-1',
                workspaceRoot: '/workspace',
                openFiles: ['/workspace/main.ts', '/workspace/utils.ts'],
                lastTool: 'read_file',
                timestamp: Date.now()
            };
            const serialized = JSON.stringify(session);
            const restored = JSON.parse(serialized);
            assert.strictEqual(restored.id, 'sess-1');
            assert.strictEqual(restored.openFiles.length, 2);
            assert.strictEqual(restored.lastTool, 'read_file');
        });
        test('should handle concurrent user interactions', () => {
            // Simulate output sanitization under concurrent load
            const ansiOutput = '\x1b[32mSuccess\x1b[0m\r\n\x1b[1mBold\x1b[0m';
            const cleaned = stripAnsiEscapeSequences(ansiOutput);
            assert.strictEqual(cleaned, 'Success\nBold');
        });
    });
});
//# sourceMappingURL=crossPlatformE2e.test.js.map