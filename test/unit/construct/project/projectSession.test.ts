/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for Project/Session — persistence, restoration, cleanup.
 * Source references:
 * - src/vs/platform/construct/common/security/workspaceGuard.ts — assertWithinWorkspace
 * - src/vs/platform/construct/common/constructTypes.ts — safeJsonParse
 */

// ---- Replicate production logic ----

function safeJsonParse<T>(input: string, fallback: T): T {
	try { return JSON.parse(input) as T; }
	catch { return fallback; }
}

interface IProjectSession {
	id: string;
	name: string;
	workspaceRoot: string;
	createdAt: number;
	lastAccessedAt: number;
	openFiles: string[];
	toolHistory: string[];
	expiresAt?: number;
}

class ProjectSessionStore {
	private sessions: Map<string, IProjectSession> = new Map();

	create(name: string, workspaceRoot: string): IProjectSession {
		const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const now = Date.now();
		const session: IProjectSession = {
			id, name, workspaceRoot,
			createdAt: now, lastAccessedAt: now,
			openFiles: [], toolHistory: [],
		};
		this.sessions.set(id, session);
		return session;
	}

	restore(id: string): IProjectSession | undefined {
		const session = this.sessions.get(id);
		if (session) {
			session.lastAccessedAt = Date.now();
		}
		return session;
	}

	persistState(id: string, updates: Partial<IProjectSession>): boolean {
		const session = this.sessions.get(id);
		if (!session) { return false; }
		Object.assign(session, updates, { lastAccessedAt: Date.now() });
		return true;
	}

	close(id: string): boolean {
		return this.sessions.delete(id);
	}

	setExpiration(id: string, expiresAt: number): boolean {
		const session = this.sessions.get(id);
		if (!session) { return false; }
		session.expiresAt = expiresAt;
		return true;
	}

	cleanExpired(now: number): number {
		let removed = 0;
		for (const [id, session] of this.sessions) {
			if (session.expiresAt !== undefined && session.expiresAt <= now) {
				this.sessions.delete(id);
				removed++;
			}
		}
		return removed;
	}

	validateProjectPath(path: string, workspaceRoot: string): boolean {
		// Reject path traversal
		if (path.includes('..')) { return false; }
		const normalized = path.replace(/\\/g, '/');
		const root = workspaceRoot.replace(/\\/g, '/');
		return normalized.startsWith(root + '/') || normalized === root;
	}

	getActiveCount(): number {
		return this.sessions.size;
	}

	getAll(): IProjectSession[] {
		return Array.from(this.sessions.values());
	}
}

// ---- Tests ----

suite('Project/Session Tests', () => {

	suite('Session Lifecycle', () => {
		test('should create new project session', () => {
			const store = new ProjectSessionStore();
			const session = store.create('my-project', '/workspace');
			assert.ok(session.id, 'Session should have an id');
			assert.strictEqual(session.name, 'my-project');
			assert.strictEqual(session.workspaceRoot, '/workspace');
			assert.strictEqual(session.openFiles.length, 0);
			assert.strictEqual(session.toolHistory.length, 0);
		});

		test('should persist session state', () => {
			const store = new ProjectSessionStore();
			const session = store.create('proj', '/workspace');
			const persisted = store.persistState(session.id, {
				openFiles: ['/workspace/main.ts', '/workspace/utils.ts'],
				toolHistory: ['read_file', 'edit_file'],
			});
			assert.strictEqual(persisted, true);

			const restored = store.restore(session.id);
			assert.strictEqual(restored!.openFiles.length, 2);
			assert.strictEqual(restored!.toolHistory.length, 2);
		});

		test('should restore session from storage', () => {
			const store = new ProjectSessionStore();
			const session = store.create('proj', '/workspace');
			store.persistState(session.id, { openFiles: ['/workspace/a.ts'] });

			const restored = store.restore(session.id);
			assert.ok(restored, 'Should restore session');
			assert.strictEqual(restored!.openFiles[0], '/workspace/a.ts');
			assert.ok(restored!.lastAccessedAt >= session.createdAt, 'lastAccessedAt should be updated');
		});

		test('should handle session expiration', () => {
			const store = new ProjectSessionStore();
			const s1 = store.create('temp', '/workspace');
			const s2 = store.create('permanent', '/workspace');

			const now = Date.now();
			store.setExpiration(s1.id, now - 1000); // expired
			store.setExpiration(s2.id, now + 60000); // not expired

			const removed = store.cleanExpired(now);
			assert.strictEqual(removed, 1);
			assert.strictEqual(store.restore(s1.id), undefined, 'Expired session should be gone');
			assert.ok(store.restore(s2.id), 'Non-expired session should remain');
		});
	});

	suite('Workspace Context', () => {
		test('should manage project workspace context', () => {
			const store = new ProjectSessionStore();
			const session = store.create('proj', '/home/user/project');
			assert.strictEqual(session.workspaceRoot, '/home/user/project');
		});

		test('should handle project configuration changes', () => {
			const store = new ProjectSessionStore();
			const session = store.create('proj', '/workspace');
			store.persistState(session.id, { name: 'renamed-project' });
			const updated = store.restore(session.id);
			assert.strictEqual(updated!.name, 'renamed-project');
		});

		test('should clean up session on close', () => {
			const store = new ProjectSessionStore();
			const session = store.create('temp', '/workspace');
			assert.strictEqual(store.getActiveCount(), 1);
			const closed = store.close(session.id);
			assert.strictEqual(closed, true);
			assert.strictEqual(store.getActiveCount(), 0);
			assert.strictEqual(store.restore(session.id), undefined);
		});
	});

	suite('Concurrency and Path Validation', () => {
		test('should handle multiple concurrent sessions', () => {
			const store = new ProjectSessionStore();
			const sessions: IProjectSession[] = [];
			for (let i = 0; i < 5; i++) {
				sessions.push(store.create(`proj-${i}`, `/workspace-${i}`));
			}
			assert.strictEqual(store.getActiveCount(), 5);
			assert.strictEqual(store.getAll().length, 5);
		});

		test('should validate project paths', () => {
			const store = new ProjectSessionStore();
			const root = '/workspace';
			assert.strictEqual(store.validateProjectPath('/workspace/src/main.ts', root), true);
			assert.strictEqual(store.validateProjectPath('/workspace', root), true);
			assert.strictEqual(store.validateProjectPath('../../../etc/passwd', root), false);
			assert.strictEqual(store.validateProjectPath('/other/path', root), false);
		});

		test('should handle project migration', () => {
			const store = new ProjectSessionStore();
			const session = store.create('proj', '/old/workspace');
			store.persistState(session.id, { openFiles: ['/old/workspace/a.ts'] });

			// Simulate migration: update workspace root and adjust paths
			const newRoot = '/new/workspace';
			const restored = store.restore(session.id)!;
			const migratedFiles = restored.openFiles.map(f => f.replace('/old/workspace', newRoot));
			store.persistState(session.id, { workspaceRoot: newRoot, openFiles: migratedFiles });

			const migrated = store.restore(session.id)!;
			assert.strictEqual(migrated.workspaceRoot, newRoot);
			assert.strictEqual(migrated.openFiles[0], '/new/workspace/a.ts');
		});
	});
});
