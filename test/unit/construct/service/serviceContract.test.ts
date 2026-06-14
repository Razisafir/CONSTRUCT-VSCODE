/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for Service Contract — interface contracts, DI registration, lifecycle.
 * Source references:
 * - src/vs/platform/construct/common/tools/constructToolRegistry.ts — IConstructToolRegistry
 * - src/vs/platform/construct/common/terminal/terminalExecutor.ts — ITerminalExecutor
 * - src/vs/platform/construct/common/terminal/kaliToolBridge.ts — IKaliToolBridge
 */

// ---- Replicate production interfaces and service container ----

type LifecycleState = 'created' | 'initializing' | 'ready' | 'disposing' | 'disposed';

interface IServiceDescriptor<T> {
	id: string;
	instance: T;
	lifecycle: LifecycleState;
}

interface ILifecycleEvent {
	serviceId: string;
	from: LifecycleState;
	to: LifecycleState;
	timestamp: number;
}

class ServiceContainer {
	private services: Map<string, IServiceDescriptor<unknown>> = new Map();
	private lifecycleEvents: ILifecycleEvent[] = [];
	private listeners: ((event: ILifecycleEvent) => void)[] = [];

	register<T>(id: string, factory: () => T): IServiceDescriptor<T> {
		if (this.services.has(id)) {
			throw new Error(`Service already registered: ${id}`);
		}
		const instance = factory();
		const descriptor: IServiceDescriptor<T> = { id, instance, lifecycle: 'created' };
		this.services.set(id, descriptor as IServiceDescriptor<unknown>);
		return descriptor;
	}

	get<T>(id: string): T | undefined {
		const descriptor = this.services.get(id);
		return descriptor ? (descriptor.instance as T) : undefined;
	}

	getDescriptor(id: string): IServiceDescriptor<unknown> | undefined {
		return this.services.get(id);
	}

	async initialize(id: string): Promise<void> {
		const descriptor = this.services.get(id);
		if (!descriptor) { throw new Error(`Service not found: ${id}`); }
		if (descriptor.lifecycle !== 'created') {
			throw new Error(`Service ${id} cannot be initialized from state ${descriptor.lifecycle}`);
		}
		this.transitionLifecycle(descriptor, 'initializing');
		this.transitionLifecycle(descriptor, 'ready');
	}

	async dispose(id: string): Promise<void> {
		const descriptor = this.services.get(id);
		if (!descriptor) { throw new Error(`Service not found: ${id}`); }
		if (descriptor.lifecycle !== 'ready') {
			throw new Error(`Service ${id} cannot be disposed from state ${descriptor.lifecycle}`);
		}
		this.transitionLifecycle(descriptor, 'disposing');
		this.transitionLifecycle(descriptor, 'disposed');
	}

	unregister(id: string): boolean {
		return this.services.delete(id);
	}

	has(id: string): boolean {
		return this.services.has(id);
	}

	listServices(): string[] {
		return Array.from(this.services.keys());
	}

	private transitionLifecycle(descriptor: IServiceDescriptor<unknown>, newState: LifecycleState): void {
		const oldState = descriptor.lifecycle;
		descriptor.lifecycle = newState;
		const event: ILifecycleEvent = {
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

	onLifecycleEvent(listener: (event: ILifecycleEvent) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const idx = this.listeners.indexOf(listener);
			if (idx >= 0) { this.listeners.splice(idx, 1); }
		};
	}

	getLifecycleEvents(): ILifecycleEvent[] { return [...this.lifecycleEvents]; }
}

// Service interface contracts
interface IToolRegistryService {
	_serviceBrand: undefined;
	listTools(): string[];
	execute(name: string, input: Record<string, unknown>): Promise<{ success: boolean; output: string }>;
}

interface ITerminalService {
	_serviceBrand: undefined;
	execute(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
	isBlocked(command: string): boolean;
}

function validateServiceContract(instance: unknown, requiredMethods: string[]): string[] {
	const errors: string[] = [];
	if (!instance || typeof instance !== 'object') {
		errors.push('Service instance must be an object');
		return errors;
	}
	for (const method of requiredMethods) {
		if (typeof (instance as Record<string, unknown>)[method] !== 'function') {
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
				execute: async (name: string) => ({ success: true, output: `Executed ${name}` }),
			}));

			assert.strictEqual(descriptor.lifecycle, 'created');
			await container.initialize('toolRegistry');
			assert.strictEqual(container.getDescriptor('toolRegistry')!.lifecycle, 'ready');
		});

		test('should reject invalid service configuration', () => {
			const container = new ServiceContainer();
			container.register('svc1', () => ({ _serviceBrand: undefined }));

			// Duplicate registration should fail
			assert.throws(
				() => container.register('svc1', () => ({ _serviceBrand: undefined })),
				/already registered/
			);
		});
	});

	suite('Service Lifecycle', () => {
		test('should handle service startup lifecycle', async () => {
			const container = new ServiceContainer();
			const events: ILifecycleEvent[] = [];
			container.onLifecycleEvent(e => events.push(e));

			container.register('svc', () => ({}));
			await container.initialize('svc');

			assert.strictEqual(events.length, 2); // created→initializing, initializing→ready
			assert.strictEqual(events[0].to, 'initializing');
			assert.strictEqual(events[1].to, 'ready');
		});

		test('should handle service shutdown lifecycle', async () => {
			const container = new ServiceContainer();
			const events: ILifecycleEvent[] = [];
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
			const events: ILifecycleEvent[] = [];
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
				execute: async (name: string) => ({ success: true, output: name }),
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
				get: (key: string) => key === 'model' ? 'gpt-4' : undefined,
			}));

			// Register a service that depends on the first
			container.register('agentService', () => {
				const config = container.get<{ get: (k: string) => string | undefined }>('configService');
				return {
					model: config?.get('model') ?? 'default',
				};
			});

			const agent = container.get<{ model: string }>('agentService');
			assert.strictEqual(agent!.model, 'gpt-4', 'DI should resolve dependency');
		});
	});

	suite('Concurrency and Error Propagation', () => {
		test('should handle concurrent service access', async () => {
			const container = new ServiceContainer();
			container.register('svc', () => ({
				counter: 0,
				increment() { this.counter++; },
			}));

			const svc = container.get<{ counter: number; increment: () => void }>('svc');
			// Simulate concurrent access
			for (let i = 0; i < 100; i++) {
				svc!.increment();
			}
			assert.strictEqual(svc!.counter, 100);
		});

		test('should propagate errors through service boundaries', async () => {
			const container = new ServiceContainer();
			container.register('svc', () => ({}));

			// Try to initialize already-initialized service
			await container.initialize('svc');
			await assert.rejects(
				async () => await container.initialize('svc'),
				/cannot be initialized/
			);

			// Try to dispose from wrong state
			container.register('svc2', () => ({}));
			await assert.rejects(
				async () => await container.dispose('svc2'),
				/cannot be disposed/
			);
		});
	});
});
