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
exports.assertWithinWorkspace = assertWithinWorkspace;
exports.validateToolName = validateToolName;
exports.validateMcpMethod = validateMcpMethod;
exports.sanitizeErrorForAgent = sanitizeErrorForAgent;
// Use VS Code's browser-safe path utilities — Node 'path' is NOT available in the renderer
const path = __importStar(require("../../../../base/common/path.js"));
const fs_1 = require("fs");
/**
 * SEC-CWE59: Detect whether the current platform has a case-insensitive filesystem.
 * macOS (darwin) and Windows are case-insensitive; Linux is case-sensitive.
 * Used for case-normalisation during path comparison to prevent
 * bypass via different casing (e.g., /Workspace vs /WORKSPACE).
 */
const IS_CASE_INSENSITIVE_FS = (typeof process !== 'undefined' && process.platform)
    ? process.platform === 'darwin' || process.platform === 'win32'
    : false;
/**
 * Assert that a path is within the workspace boundary.
 * Throws an error if the resolved absolute path escapes the workspace root.
 * Used for IPC input validation to prevent path traversal attacks.
 *
 * FIX: Previous implementation only checked for '..' in the path string,
 * which allowed absolute paths like /etc/passwd to pass through.
 * Now properly resolves and compares against workspace root.
 */
function assertWithinWorkspace(filePath, workspaceRoot) {
    // Reject path traversal attempts (e.g., ../../../etc/passwd)
    const normalized = path.normalize(filePath);
    if (normalized.includes('..')) {
        throw new Error(`Path traversal not allowed: "${filePath}"`);
    }
    // If a workspace root is provided, enforce boundary
    if (workspaceRoot) {
        let root;
        if (typeof workspaceRoot === 'string') {
            root = path.resolve(workspaceRoot);
        }
        else {
            // IWorkspaceContextService — extract first workspace folder
            const folders = workspaceRoot.getWorkspace().folders;
            if (folders.length === 0) {
                // No workspace open — only allow relative paths within CWD
                if (path.isAbsolute(filePath)) {
                    throw new Error(`No workspace open. Absolute paths are not allowed: "${filePath}"`);
                }
                return;
            }
            root = path.resolve(folders[0].uri.fsPath);
        }
        // Resolve relative paths against the workspace root (not CWD)
        // This ensures 'src/utils/math.ts' resolves to '<root>/src/utils/math.ts'
        const resolved = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(root, filePath);
        // Resolve symlinks to prevent bypass via symlink chains
        let realPath;
        let realRoot;
        try {
            realPath = (0, fs_1.realpathSync)(resolved);
        }
        catch {
            // File doesn't exist yet (e.g. write operation) — check parent directory instead
            try {
                realPath = (0, fs_1.realpathSync)(path.dirname(resolved));
            }
            catch {
                // Parent doesn't exist either — fall back to resolved path
                realPath = resolved;
            }
        }
        try {
            realRoot = (0, fs_1.realpathSync)(root);
        }
        catch {
            realRoot = root;
        }
        // SEC-CWE59: Case-insensitive comparison on macOS/Windows to prevent
        // casing-based bypass (e.g., /WORKSPACE/foo when root is /Workspace)
        const comparePath = IS_CASE_INSENSITIVE_FS ? realPath.toLowerCase() : realPath;
        const compareRoot = IS_CASE_INSENSITIVE_FS ? realRoot.toLowerCase() : realRoot;
        if (!comparePath.startsWith(compareRoot + path.sep) && comparePath !== compareRoot) {
            throw new Error(`Path traversal detected: ${filePath} resolves outside workspace`);
        }
    }
    else {
        // No workspace root provided — reject absolute paths as a safety measure
        if (path.isAbsolute(filePath)) {
            throw new Error(`Absolute paths require a workspace context: "${filePath}"`);
        }
    }
}
/**
 * Validate that a tool name is in the allowed set.
 * Used for IPC input validation to prevent arbitrary tool execution.
 */
function validateToolName(name) {
    const ALLOWED_TOOLS = new Set([
        'read_file', 'write_file', 'edit_file', 'list_directory',
        'create_directory', 'delete_file', 'exists',
        'search_files', 'run_command',
        'search_codebase', 'web_search', 'generate_tests', 'review_code'
    ]);
    return ALLOWED_TOOLS.has(name);
}
/**
 * Validate that an MCP method name is in the allowed set.
 */
function validateMcpMethod(method) {
    const ALLOWED_METHODS = new Set([
        'initialize', 'tools/list', 'tools/call',
        'resources/list', 'resources/read'
    ]);
    return ALLOWED_METHODS.has(method);
}
/**
 * SEC-P5: Sanitize error messages before returning them to the agent.
 * Removes file system paths (which may contain usernames, project names, etc.)
 * to prevent information leakage in error messages sent to LLM providers.
 */
function sanitizeErrorForAgent(error, operation) {
    const msg = error instanceof Error ? error.message : String(error);
    return msg
        .replace(/\/[^\s]+/g, '[path]')
        .replace(/[A-Z]:\\[^\s]+/gi, '[path]');
}
//# sourceMappingURL=workspaceGuard.js.map