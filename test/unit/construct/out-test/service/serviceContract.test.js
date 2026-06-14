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
class ServiceContainer {
    services = new Map();
    lifecycleEvents = [];
    listeners = [];
    register(id, factory) {
        if (this.services.has(id)) {
            throw new Error(`Service already registered: ${id}`);
        }
        const instance = factory();
        const descriptor = { id, instance, lifecycle: 'created' };
        this.services.set(id, descriptor);
        return descriptor;
    }
    get(id) {
        const descriptor = this.services.get(id);
        return descriptor ? descriptor.instance : undefined;
    }
    getDescriptor(id) {
        return this.services.get(id);
    }
    async initialize(id) {
        const descriptor = this.services.get(id);
        if (!descriptor) {
            throw new Error(`Service not found: ${id}`);
        }
        if (descriptor.lifecycle !== 'created') {
            throw new Error(`Service ${id} cannot be initialized from state ${descriptor.lifecycle}`);
        }
        this.transitionLifecycle(descriptor, 'initializing');
        this.transitionLifecycle(descriptor, 'ready');
    }
    async dispose(id) {
        const descriptor = this.services.get(id);
        if (!descriptor) {
            throw new Error(`Service not found: ${id}`);
        }
        if (descriptor.lifecycle !== 'ready') {
            throw new Error(`Service ${id} cannot be disposed from state ${descriptor.lifecycle}`);
        }
        this.transitionLifecycle(descriptor, 'disposing');
        this.transitionLifecycle(descriptor, 'disposed');
    }
    unregister(id) {
        return this.services.delete(id);
    }
    has(id) {
        return this.services.has(id);
    }
    listServices() {
        return Array.from(this.services.keys());
    }
    transitionLifecycle(descriptor, newState) {
        const oldState = descriptor.lifecycle;
        descriptor.lifecycle = newState;
        const event = {
            serviceId: descriptor.id,
            from: oldState,
            to: newState,
            timestamp: Date.now(),
        };
        this.lifecycleEvents.push(event);
        for (const listener of this.listeners) {
            listener(event);
        }
    }
    onLifecycleEvent(listener) {
        this.listeners.push(listener);
        return () => {
            const idx = this.listeners.indexOf(listener);
            if (idx >= 0) {
                this.listeners.splice(idx, 1);
            }
        };
    }
    getLifecycleEvents() { return [...this.lifecycleEvents]; }
}
function validateServiceContract(instance, requiredMethods) {
    const errors = [];
    if (!instance || typeof instance !== 'object') {
        errors.push('Service instance must be an object');
        return errors;
    }
    for (const method of requiredMethods) {
        if (typeof instance[method] !== 'function') {
            errors.push(`Missing method: ${method}`);
        }
    }
    return errors;
}
// ---- Tests ----
suite('Service Contract Tests', () => {
    suite('Service Initialization', () => {
        test('should initialize service with valid config', async () => {
            const container = new ServiceContainer();
            const descriptor = container.register('toolRegistry', () => ({
                _serviceBrand: undefined,
                listTools: () => ['read_file', 'write_file'],
                execute: async (name) => ({ success: true, output: `Executed ${name}` }),
            }));
            assert.strictEqual(descriptor.lifecycle, 'created');
            await container.initialize('toolRegistry');
            assert.strictEqual(container.getDescriptor('toolRegistry').lifecycle, 'ready');
        });
        test('should reject invalid service configuration', () => {
            const container = new ServiceContainer();
            container.register('svc1', () => ({ _serviceBrand: undefined }));
            // Duplicate registration should fail
            assert.throws(() => container.register('svc1', () => ({ _serviceBrand: undefined })), /already registered/);
        });
    });
    suite('Service Lifecycle', () => {
        test('should handle service startup lifecycle', async () => {
            const container = new ServiceContainer();
            const events = [];
            container.onLifecycleEvent(e => events.push(e));
            container.register('svc', () => ({}));
            await container.initialize('svc');
            assert.strictEqual(events.length, 2); // created→initializing, initializing→ready
            assert.strictEqual(events[0].to, 'initializing');
            assert.strictEqual(events[1].to, 'ready');
        });
        test('should handle service shutdown lifecycle', async () => {
            const container = new ServiceContainer();
            const events = [];
            container.onLifecycleEvent(e => events.push(e));
            container.register('svc', () => ({}));
            await container.initialize('svc');
            await container.dispose('svc');
            const lifecycleTransitions = events.filter(e => e.serviceId === 'svc');
            assert.strictEqual(lifecycleTransitions.length, 4); // init(2) + dispose(2)
            assert.strictEqual(lifecycleTransitions[2].to, 'disposing');
            assert.strictEqual(lifecycleTransitions[3].to, 'disposed');
        });
        test('should emit lifecycle events correctly', () => {
            const container = new ServiceContainer();
            const events = [];
            container.onLifecycleEvent(e => events.push(e));
            container.register('svc-a', () => ({}));
            container.register('svc-b', () => ({}));
            assert.strictEqual(events.length, 0, 'Registration alone should not emit events');
        });
    });
    suite('Interface Contracts', () => {
        test('should enforce interface contracts on service methods', () => {
            const toolRegistry = {
                _serviceBrand: undefined,
                listTools: () => ['read_file'],
                execute: async (name) => ({ success: true, output: name }),
            };
            const errors = validateServiceContract(toolRegistry, ['listTools', 'execute']);
            assert.strictEqual(errors.length, 0);
        });
        test('should validate service method parameters', () => {
            const badService = {
                _serviceBrand: undefined,
                listTools: 'not a function',
            };
            const errors = validateServiceContract(badService, ['listTools', 'execute']);
            assert.strictEqual(errors.length, 2, 'Should report missing/non-function methods');
        });
        test('should handle service dependency injection', () => {
            const container = new ServiceContainer();
            // Register a dependency
            container.register('configService', () => ({
                get: (key) => key === 'model' ? 'gpt-4' : undefined,
            }));
            // Register a service that depends on the first
            container.register('agentService', () => {
                const config = container.get('configService');
                return {
                    model: config?.get('model') ?? 'default',
                };
            });
            const agent = container.get('agentService');
            assert.strictEqual(agent.model, 'gpt-4', 'DI should resolve dependency');
        });
    });
    suite('Concurrency and Error Propagation', () => {
        test('should handle concurrent service access', async () => {
            const container = new ServiceContainer();
            container.register('svc', () => ({
                counter: 0,
                increment() { this.counter++; },
            }));
            const svc = container.get('svc');
            // Simulate concurrent access
            for (let i = 0; i < 100; i++) {
                svc.increment();
            }
            assert.strictEqual(svc.counter, 100);
        });
        test('should propagate errors through service boundaries', async () => {
            const container = new ServiceContainer();
            container.register('svc', () => ({}));
            // Try to initialize already-initialized service
            await container.initialize('svc');
            await assert.rejects(async () => await container.initialize('svc'), /cannot be initialized/);
            // Try to dispose from wrong state
            container.register('svc2', () => ({}));
            await assert.rejects(async () => await container.dispose('svc2'), /cannot be disposed/);
        });
    });
});
//# sourceMappingURL=serviceContract.test.js.map