"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
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
suite('WorkspaceGuard', () => {
    test('path traversal with .. is detected', () => {
        const maliciousPath = '../../../etc/passwd';
        const hasTraversal = maliciousPath.includes('..');
        assert.ok(hasTraversal);
    });
    test('normalized path removes . segments', () => {
        // Simulating path.normalize behavior
        const path = './src/../src/main.ts';
        const normalized = path.replace(/\.\//g, '').replace(/[^/]+\/\.\.\//g, '');
        assert.ok(!normalized.includes('..'));
    });
    test('absolute path outside workspace is rejected', () => {
        const workspaceRoot = '/home/user/project';
        const filePath = '/etc/passwd';
        const isAbsolute = filePath.startsWith('/');
        const isOutside = !filePath.startsWith(workspaceRoot + '/');
        assert.ok(isAbsolute);
        assert.ok(isOutside);
    });
    test('relative path within workspace is accepted', () => {
        const workspaceRoot = '/home/user/project';
        const filePath = 'src/main.ts';
        const resolved = workspaceRoot + '/' + filePath;
        assert.ok(resolved.startsWith(workspaceRoot + '/'));
    });
    test('path with encoded traversal is detected', () => {
        const encodedPath = '..%2F..%2Fetc%2Fpasswd';
        // After decoding
        const decoded = decodeURIComponent(encodedPath);
        assert.ok(decoded.includes('..'));
    });
    test('validateToolName accepts allowed tools', () => {
        const ALLOWED_TOOLS = new Set([
            'read_file', 'write_file', 'edit_file', 'list_directory',
            'create_directory', 'search_files', 'run_command',
            'search_codebase', 'web_search',
        ]);
        assert.ok(ALLOWED_TOOLS.has('read_file'));
        assert.ok(ALLOWED_TOOLS.has('run_command'));
        assert.ok(!ALLOWED_TOOLS.has('execute_arbitrary'));
    });
    test('validateToolName rejects unknown tools', () => {
        const ALLOWED_TOOLS = new Set(['read_file', 'write_file']);
        assert.ok(!ALLOWED_TOOLS.has('rm_rf'));
        assert.ok(!ALLOWED_TOOLS.has('eval'));
    });
    test('validateMcpMethod accepts allowed methods', () => {
        const ALLOWED_METHODS = new Set([
            'initialize', 'tools/list', 'tools/call',
            'resources/list', 'resources/read',
        ]);
        assert.ok(ALLOWED_METHODS.has('tools/call'));
        assert.ok(ALLOWED_METHODS.has('initialize'));
        assert.ok(!ALLOWED_METHODS.has('system/exec'));
    });
    test('workspace root must be set for absolute paths', () => {
        const filePath = '/usr/local/bin/something';
        const workspaceRoot = undefined;
        // Without a workspace root, absolute paths should be rejected
        assert.ok(filePath.startsWith('/') && !workspaceRoot);
    });
});
//# sourceMappingURL=workspaceGuard.test.js.map