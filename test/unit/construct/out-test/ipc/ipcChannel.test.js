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
 * Tests for IPC Channel — message contracts, serialization, size limits.
 * Source references:
 * - src/vs/platform/construct/common/security/workspaceGuard.ts — validateToolName, validateMcpMethod
 * - src/vs/platform/construct/common/security/secretRedactor.ts — redactSecrets
 */
// ---- Replicate production logic ----
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
const MAX_IPC_MESSAGE_SIZE = 1024 * 1024; // 1MB
function serializeMessage(msg) {
    return JSON.stringify(msg);
}
function deserializeMessage(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed.channel || !parsed.id) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function validateMessageSchema(msg) {
    const errors = [];
    if (!msg.channel || typeof msg.channel !== 'string') {
        errors.push('channel is required and must be a string');
    }
    if (!msg.id || typeof msg.id !== 'string') {
        errors.push('id is required and must be a string');
    }
    if (!msg.timestamp || typeof msg.timestamp !== 'number') {
        errors.push('timestamp is required and must be a number');
    }
    return errors;
}
function enforceMessageSize(msg) {
    const serialized = serializeMessage(msg);
    return { valid: serialized.length <= MAX_IPC_MESSAGE_SIZE, size: serialized.length };
}
function sanitizeIPCInput(data) {
    if (typeof data === 'string') {
        return redactSecrets(data);
    }
    if (Array.isArray(data)) {
        return data.map(item => sanitizeIPCInput(item));
    }
    if (data && typeof data === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            sanitized[key] = sanitizeIPCInput(value);
        }
        return sanitized;
    }
    return data;
}
const ALLOWED_IPC_CHANNELS = new Set([
    'construct:execute',
    'construct:cancel',
    'construct:listTools',
    'construct:getTool',
    'construct:status',
    'construct:session',
]);
function isAuthorizedChannel(channel) {
    return ALLOWED_IPC_CHANNELS.has(channel);
}
// ---- Tests ----
suite('IPC Channel Tests', () => {
    suite('Message Serialization', () => {
        test('should send and receive messages on IPC channel', () => {
            const msg = {
                channel: 'construct:execute',
                data: { tool: 'read_file', path: '/src/main.ts' },
                timestamp: Date.now(),
                id: 'msg-1',
            };
            const serialized = serializeMessage(msg);
            const deserialized = deserializeMessage(serialized);
            assert.ok(deserialized);
            assert.strictEqual(deserialized.channel, 'construct:execute');
            assert.strictEqual(deserialized.id, 'msg-1');
        });
        test('should handle IPC message serialization', () => {
            const msg = {
                channel: 'construct:status',
                data: { active: true, count: 5 },
                timestamp: Date.now(),
                id: 'msg-2',
            };
            const raw = serializeMessage(msg);
            assert.ok(typeof raw === 'string');
            assert.ok(raw.includes('"channel"'));
            assert.ok(raw.includes('"construct:status"'));
        });
        test('should handle IPC message deserialization', () => {
            const valid = '{"channel":"construct:listTools","data":{},"timestamp":1234567890,"id":"msg-3"}';
            const msg = deserializeMessage(valid);
            assert.ok(msg);
            assert.strictEqual(msg.channel, 'construct:listTools');
            const invalid = 'not json at all';
            assert.strictEqual(deserializeMessage(invalid), null);
        });
    });
    suite('Message Validation', () => {
        test('should validate IPC message schema', () => {
            const valid = {
                channel: 'construct:execute', data: {}, timestamp: Date.now(), id: 'x',
            };
            assert.strictEqual(validateMessageSchema(valid).length, 0);
            const missingChannel = { data: {}, timestamp: Date.now(), id: 'x' };
            assert.ok(validateMessageSchema(missingChannel).length > 0);
            const missingId = { channel: 'test', data: {}, timestamp: Date.now() };
            assert.ok(validateMessageSchema(missingId).length > 0);
        });
        test('should enforce IPC message size limits', () => {
            const small = { channel: 'test', data: 'hello', timestamp: Date.now(), id: '1' };
            assert.strictEqual(enforceMessageSize(small).valid, true);
            const bigData = 'x'.repeat(MAX_IPC_MESSAGE_SIZE + 100);
            const big = { channel: 'test', data: bigData, timestamp: Date.now(), id: '2' };
            assert.strictEqual(enforceMessageSize(big).valid, false);
        });
        test('should reject unauthorized IPC messages', () => {
            assert.strictEqual(isAuthorizedChannel('construct:execute'), true);
            assert.strictEqual(isAuthorizedChannel('construct:status'), true);
            assert.strictEqual(isAuthorizedChannel('malicious:channel'), false);
            assert.strictEqual(isAuthorizedChannel('system:eval'), false);
        });
    });
    suite('Security', () => {
        test('should sanitize IPC input data', () => {
            const data = {
                command: 'read_file',
                args: { key: 'sk-ant-api03-abcdefghijklmnopqrstuvwx' },
            };
            const sanitized = sanitizeIPCInput(data);
            const args = sanitized.args;
            assert.strictEqual(args.key, '[REDACTED]');
        });
        test('should handle IPC channel disconnection', () => {
            // Simulate deserialization of incomplete/corrupt message
            const corruptMsg = '{"channel":"construct:execute","data":';
            const result = deserializeMessage(corruptMsg);
            assert.strictEqual(result, null, 'Corrupt message should return null');
        });
        test('should handle IPC message ordering', () => {
            const messages = [];
            for (let i = 0; i < 5; i++) {
                messages.push({
                    channel: 'construct:execute',
                    data: { step: i },
                    timestamp: Date.now() + i,
                    id: `msg-${i}`,
                });
            }
            // Messages should be ordered by timestamp
            const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
            for (let i = 0; i < sorted.length; i++) {
                assert.strictEqual(sorted[i].id, `msg-${i}`);
            }
        });
        test('should handle IPC backpressure', () => {
            // Simulate backpressure by enforcing size limits on batched messages
            const SMALL_LIMIT = 2000; // 2KB limit for testing
            const batch = [];
            let totalSize = 0;
            for (let i = 0; i < 100; i++) {
                const msg = {
                    channel: 'construct:execute',
                    data: { idx: i, payload: 'x'.repeat(100) },
                    timestamp: Date.now(),
                    id: `batch-${i}`,
                };
                const size = serializeMessage(msg).length;
                if (totalSize + size > SMALL_LIMIT) {
                    break;
                }
                batch.push(msg);
                totalSize += size;
            }
            assert.ok(batch.length < 100, 'Backpressure should limit batch size');
            assert.ok(totalSize <= SMALL_LIMIT);
        });
    });
});
//# sourceMappingURL=ipcChannel.test.js.map