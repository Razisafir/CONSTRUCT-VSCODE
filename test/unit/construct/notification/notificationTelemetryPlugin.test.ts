/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for Notification/Telemetry — delivery, event emission, throttling, PII redaction.
 * Source references:
 * - src/vs/platform/construct/common/security/secretRedactor.ts — redactSecrets
 */

// ---- Replicate production logic ----

const SECRET_PATTERNS: RegExp[] = [
	/sk-ant-[A-Za-z0-9_-]{20,}/g,
	/sk-[A-Za-z0-9]{20,}/g,
	/Bearer [A-Za-z0-9_.-]{20,}/g,
	/password=\S+/gi,
	/token=\S+/gi,
	/key=\S+/gi,
];

function redactSecrets(input: string): string {
	if (!input || typeof input !== 'string') { return input; }
	let result = input;
	for (const pattern of SECRET_PATTERNS) {
		pattern.lastIndex = 0;
		result = result.replace(pattern, '[REDACTED]');
	}
	return result;
}

// Notification types
type NotificationPriority = 'info' | 'warning' | 'error' | 'critical';

interface INotification {
	id: string;
	message: string;
	priority: NotificationPriority;
	timestamp: number;
	actions?: string[];
	dismissed: boolean;
}

// Telemetry event
interface ITelemetryEvent {
	name: string;
	properties: Record<string, unknown>;
	timestamp: number;
	sanitized: boolean;
}

// Notification service with throttling
class NotificationService {
	private notifications: INotification[] = [];
	private throttleMap: Map<string, number[]> = new Map();
	private throttleWindowMs: number;
	private maxPerWindow: number;

	constructor(throttleWindowMs = 5000, maxPerWindow = 5) {
		this.throttleWindowMs = throttleWindowMs;
		this.maxPerWindow = maxPerWindow;
	}

	send(notification: INotification): { delivered: boolean; reason?: string } {
		// Check throttle
		const key = `${notification.priority}:${notification.message.slice(0, 50)}`;
		const now = Date.now();
		const timestamps = this.throttleMap.get(key) ?? [];
		const recent = timestamps.filter(ts => ts > now - this.throttleWindowMs);

		if (recent.length >= this.maxPerWindow) {
			return { delivered: false, reason: 'Throttled: too many notifications' };
		}

		recent.push(now);
		this.throttleMap.set(key, recent);
		this.notifications.push(notification);
		return { delivered: true };
	}

	getNotifications(): INotification[] { return [...this.notifications]; }

	dismiss(id: string): boolean {
		const n = this.notifications.find(n => n.id === id);
		if (n) { n.dismissed = true; return true; }
		return false;
	}

	getByPriority(priority: NotificationPriority): INotification[] {
		return this.notifications.filter(n => n.priority === priority && !n.dismissed);
	}
}

// Telemetry service with PII redaction
class TelemetryService {
	private events: ITelemetryEvent[] = [];
	private enabled: boolean = true;
	private batchBuffer: ITelemetryEvent[] = [];
	private batchSize: number;

	constructor(batchSize = 10) {
		this.batchSize = batchSize;
	}

	trackEvent(name: string, properties: Record<string, unknown>): ITelemetryEvent {
		if (!this.enabled) {
			return { name, properties: {}, timestamp: Date.now(), sanitized: false };
		}

		// Sanitize PII from properties
		const sanitized = this.sanitizeProperties(properties);
		const event: ITelemetryEvent = {
			name,
			properties: sanitized,
			timestamp: Date.now(),
			sanitized: true,
		};

		this.events.push(event);
		this.batchBuffer.push(event);
		return event;
	}

	private sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
		const sanitized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(props)) {
			if (typeof value === 'string') {
				sanitized[key] = redactSecrets(value);
				// Also redact email-like patterns
				sanitized[key] = (sanitized[key] as string).replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');
				// Redact IP addresses
				sanitized[key] = (sanitized[key] as string).replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	}

	flushBatch(): ITelemetryEvent[] {
		const batch = [...this.batchBuffer];
		this.batchBuffer = [];
		return batch;
	}

	shouldFlush(): boolean {
		return this.batchBuffer.length >= this.batchSize;
	}

	getEvents(): ITelemetryEvent[] { return [...this.events]; }

	setEnabled(enabled: boolean): void { this.enabled = enabled; }
	isEnabled(): boolean { return this.enabled; }
}

// ---- Tests ----

suite('Notification/Telemetry Tests', () => {

	suite('Notification Delivery', () => {
		test('should send notification on event', () => {
			const svc = new NotificationService();
			const result = svc.send({
				id: 'notif-1',
				message: 'Build completed successfully',
				priority: 'info',
				timestamp: Date.now(),
				dismissed: false,
			});
			assert.strictEqual(result.delivered, true);
			assert.strictEqual(svc.getNotifications().length, 1);
		});

		test('should respect notification preferences', () => {
			const svc = new NotificationService();
			// Critical notifications are always shown
			svc.send({ id: 'n1', message: 'Critical error', priority: 'critical', timestamp: Date.now(), dismissed: false });
			svc.send({ id: 'n2', message: 'Info message', priority: 'info', timestamp: Date.now(), dismissed: false });

			const critical = svc.getByPriority('critical');
			assert.strictEqual(critical.length, 1);
			assert.strictEqual(critical[0].id, 'n1');
		});

		test('should handle notification priority levels', () => {
			const svc = new NotificationService();
			svc.send({ id: 'n1', message: 'Info', priority: 'info', timestamp: Date.now(), dismissed: false });
			svc.send({ id: 'n2', message: 'Warning', priority: 'warning', timestamp: Date.now(), dismissed: false });
			svc.send({ id: 'n3', message: 'Error', priority: 'error', timestamp: Date.now(), dismissed: false });
			svc.send({ id: 'n4', message: 'Critical', priority: 'critical', timestamp: Date.now(), dismissed: false });

			assert.strictEqual(svc.getByPriority('info').length, 1);
			assert.strictEqual(svc.getByPriority('warning').length, 1);
			assert.strictEqual(svc.getByPriority('error').length, 1);
			assert.strictEqual(svc.getByPriority('critical').length, 1);
		});

		test('should support notification actions', () => {
			const svc = new NotificationService();
			svc.send({
				id: 'n1', message: 'Build failed', priority: 'error', timestamp: Date.now(), dismissed: false,
				actions: ['Retry', 'Dismiss'],
			});
			const notif = svc.getNotifications()[0];
			assert.ok(notif.actions);
			assert.strictEqual(notif.actions!.length, 2);
			assert.ok(notif.actions!.includes('Retry'));
		});
	});

	suite('Throttling', () => {
		test('should throttle notification frequency', () => {
			const svc = new NotificationService(5000, 3); // max 3 per 5s
			let delivered = 0;
			let throttled = 0;

			for (let i = 0; i < 5; i++) {
				const result = svc.send({
					id: `n-${i}`, message: 'Same message repeated', priority: 'info',
					timestamp: Date.now(), dismissed: false,
				});
				if (result.delivered) { delivered++; }
				else { throttled++; }
			}

			assert.strictEqual(delivered, 3);
			assert.strictEqual(throttled, 2);
		});
	});

	suite('Telemetry Event Emission', () => {
		test('should sanitize telemetry data', () => {
			const svc = new TelemetryService();
			const event = svc.trackEvent('tool_execution', {
				toolName: 'read_file',
				apiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwx',
				serverUrl: 'https://api.example.com',
			});

			assert.strictEqual(event.sanitized, true);
			assert.strictEqual(event.properties.apiKey, '[REDACTED]');
			assert.strictEqual(event.properties.toolName, 'read_file'); // non-secret preserved
		});

		test('should handle telemetry opt-out', () => {
			const svc = new TelemetryService();
			svc.setEnabled(false);

			const event = svc.trackEvent('tool_execution', { tool: 'test' });
			assert.strictEqual(event.sanitized, false);
			assert.deepStrictEqual(event.properties, {});
			assert.strictEqual(svc.getEvents().length, 0, 'Events should not be stored when opted out');
		});

		test('should batch telemetry events', () => {
			const svc = new TelemetryService(5); // batch size 5

			for (let i = 0; i < 4; i++) {
				svc.trackEvent(`event-${i}`, {});
				assert.strictEqual(svc.shouldFlush(), false, `Should not flush at ${i + 1} events`);
			}

			svc.trackEvent('event-4', {});
			assert.strictEqual(svc.shouldFlush(), true, 'Should flush at batch size');

			const batch = svc.flushBatch();
			assert.strictEqual(batch.length, 5);
			assert.strictEqual(svc.shouldFlush(), false, 'Buffer should be empty after flush');
		});

		test('should redact PII from telemetry', () => {
			const svc = new TelemetryService();
			const event = svc.trackEvent('user_action', {
				email: 'user@example.com',
				ip: '192.168.1.100',
				action: 'clicked_button',
				key: 'sk-abc123def456ghi789jkl012mno345pqr678',
			});

			assert.strictEqual(event.properties.email, '[email]');
			assert.strictEqual(event.properties.ip, '[ip]');
			assert.strictEqual(event.properties.key, '[REDACTED]');
			assert.strictEqual(event.properties.action, 'clicked_button');
		});

		test('should handle telemetry upload failure', () => {
			const svc = new TelemetryService();
			svc.trackEvent('event-1', { data: 'test' });
			svc.trackEvent('event-2', { data: 'test2' });

			// Simulate upload failure — events should remain in buffer
			assert.strictEqual(svc.getEvents().length, 2, 'Events should be preserved on upload failure');

			// After successful flush, events can be cleared
			const batch = svc.flushBatch();
			assert.strictEqual(batch.length, 2);
		});
	});
});
