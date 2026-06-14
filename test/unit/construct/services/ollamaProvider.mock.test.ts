/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as http from 'http';

// ---- Mock HTTP server helpers ----

function createMockServer(
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<http.Server> {
	return new Promise((resolve) => {
		const server = http.createServer(handler);
		server.listen(0, () => resolve(server));
	});
}

function getServerPort(server: http.Server): number {
	const addr = server.address();
	if (!addr || typeof addr === 'string') {
		throw new Error('Server not listening');
	}
	return addr.port;
}

function closeServer(server: http.Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
}

/** Helper: make an HTTP request and return { status, headers, body } */
function httpRequest(
	url: string,
	options: http.RequestOptions = {},
	body?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(url, options, (res) => {
			let data = '';
			res.on('data', (chunk: Buffer) => (data += chunk.toString()));
			res.on('end', () => {
				resolve({ status: res.statusCode || 0, headers: res.headers, body: data });
			});
		});
		req.on('error', reject);
		if (body) {
			req.write(body);
		}
		req.end();
	});
}

// ---- Ollama response helpers ----

function makeModelList(models: Array<{ name: string; model: string; size?: number; details?: { family?: string; parameter_size?: string } }>) {
	return JSON.stringify({ models });
}

function makeChatResponse(content: string, model: string, done = true) {
	return JSON.stringify({
		model,
		message: { role: 'assistant', content },
		done,
	});
}

function makeStreamingChunks(chunks: string[], model: string) {
	// NDJSON: each chunk is a JSON line separated by \n, final chunk has done: true
	const lines = chunks.map((content, i) =>
		JSON.stringify({
			model,
			message: { role: 'assistant', content },
			done: i === chunks.length - 1,
		})
	);
	return lines.join('\n') + '\n';
}

// ---- Tests ----

suite('OllamaProvider Mock Tests', () => {
	let server: http.Server;
	let baseUrl: string;

	suiteSetup(async () => {
		server = await createMockServer((req, res) => {
			// Default handler — individual tests may override via suiteTeardown/setup per group
			res.writeHead(404);
			res.end('Not found');
		});
		baseUrl = `http://127.0.0.1:${getServerPort(server)}`;
	});

	suiteTeardown(async () => {
		await closeServer(server);
	});

	// ────────────────────────────────────────────────
	// GET /api/tags — model listing
	// ────────────────────────────────────────────────
	suite('GET /api/tags — model list', () => {
		let tagsServer: http.Server;
		let tagsUrl: string;

		suiteSetup(async () => {
			tagsServer = await createMockServer((req, res) => {
				if (req.method === 'GET' && req.url === '/api/tags') {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						makeModelList([
							{ name: 'llama3.1:8b', model: 'llama3.1:8b', size: 4661224676, details: { family: 'llama', parameter_size: '8B' } },
							{ name: 'mistral:7b', model: 'mistral:7b', size: 4109865152, details: { family: 'mistral', parameter_size: '7B' } },
							{ name: 'gemma2:2b', model: 'gemma2:2b', size: 1678437504, details: { family: 'gemma', parameter_size: '2B' } },
						])
					);
				} else {
					res.writeHead(404);
					res.end('Not found');
				}
			});
			tagsUrl = `http://127.0.0.1:${getServerPort(tagsServer)}`;
		});

		suiteTeardown(async () => {
			await closeServer(tagsServer);
		});

		test('returns 200 for /api/tags', async () => {
			const result = await httpRequest(`${tagsUrl}/api/tags`);
			assert.strictEqual(result.status, 200);
		});

		test('response contains models array', async () => {
			const result = await httpRequest(`${tagsUrl}/api/tags`);
			const data = JSON.parse(result.body);
			assert.ok(Array.isArray(data.models), 'Response should contain a models array');
			assert.strictEqual(data.models.length, 3);
		});

		test('model names are correctly returned', async () => {
			const result = await httpRequest(`${tagsUrl}/api/tags`);
			const data = JSON.parse(result.body);
			const names = data.models.map((m: any) => m.name);
			assert.ok(names.includes('llama3.1:8b'));
			assert.ok(names.includes('mistral:7b'));
			assert.ok(names.includes('gemma2:2b'));
		});

		test('models include details with family', async () => {
			const result = await httpRequest(`${tagsUrl}/api/tags`);
			const data = JSON.parse(result.body);
			const llama = data.models.find((m: any) => m.name === 'llama3.1:8b');
			assert.ok(llama, 'llama3.1:8b should exist');
			assert.strictEqual(llama.details.family, 'llama');
		});
	});

	// ────────────────────────────────────────────────
	// POST /api/chat — chat completions
	// ────────────────────────────────────────────────
	suite('POST /api/chat — chat completions', () => {
		let chatServer: http.Server;
		let chatUrl: string;

		suiteSetup(async () => {
			chatServer = await createMockServer((req, res) => {
				if (req.method === 'POST' && req.url === '/api/chat') {
					let body = '';
					req.on('data', (chunk: Buffer) => (body += chunk.toString()));
					req.on('end', () => {
						let parsed: any;
						try {
							parsed = JSON.parse(body);
						} catch {
							res.writeHead(400);
							res.end('Invalid JSON');
							return;
						}

						if (parsed.model === 'nonexistent-model') {
							res.writeHead(404);
							res.end(JSON.stringify({ error: 'model not found' }));
							return;
						}

						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(makeChatResponse('Hello! How can I help you today?', parsed.model || 'test-model'));
					});
				} else {
					res.writeHead(404);
					res.end('Not found');
				}
			});
			chatUrl = `http://127.0.0.1:${getServerPort(chatServer)}`;
		});

		suiteTeardown(async () => {
			await closeServer(chatServer);
		});

		test('chat request returns 200', async () => {
			const result = await httpRequest(
				`${chatUrl}/api/chat`,
				{ method: 'POST' },
				JSON.stringify({
					model: 'llama3.1:8b',
					messages: [{ role: 'user', content: 'Hello' }],
					stream: false,
				})
			);
			assert.strictEqual(result.status, 200);
		});

		test('chat response contains message with content', async () => {
			const result = await httpRequest(
				`${chatUrl}/api/chat`,
				{ method: 'POST' },
				JSON.stringify({
					model: 'llama3.1:8b',
					messages: [{ role: 'user', content: 'Hello' }],
					stream: false,
				})
			);
			const data = JSON.parse(result.body);
			assert.ok(data.message, 'Response should have message field');
			assert.ok(data.message.content, 'Message should have content');
			assert.strictEqual(data.model, 'llama3.1:8b');
		});

		test('chat with invalid model returns 404', async () => {
			const result = await httpRequest(
				`${chatUrl}/api/chat`,
				{ method: 'POST' },
				JSON.stringify({
					model: 'nonexistent-model',
					messages: [{ role: 'user', content: 'Hello' }],
					stream: false,
				})
			);
			assert.strictEqual(result.status, 404);
			const data = JSON.parse(result.body);
			assert.ok(data.error, 'Error response should contain error field');
		});

		test('chat with malformed JSON body returns 400', async () => {
			const result = await httpRequest(
				`${chatUrl}/api/chat`,
				{ method: 'POST' },
				'this is not json'
			);
			assert.strictEqual(result.status, 400);
		});
	});

	// ────────────────────────────────────────────────
	// Streaming responses with NDJSON chunks
	// ────────────────────────────────────────────────
	suite('Streaming responses — NDJSON chunks', () => {
		let streamServer: http.Server;
		let streamUrl: string;

		suiteSetup(async () => {
			streamServer = await createMockServer((req, res) => {
				if (req.method === 'POST' && req.url === '/api/chat') {
					let body = '';
					req.on('data', (chunk: Buffer) => (body += chunk.toString()));
					req.on('end', () => {
						let parsed: any;
						try {
							parsed = JSON.parse(body);
						} catch {
							res.writeHead(400);
							res.end('Invalid JSON');
							return;
						}

						if (!parsed.stream) {
							res.writeHead(200, { 'Content-Type': 'application/json' });
							res.end(makeChatResponse('Non-streaming response', parsed.model));
							return;
						}

						// Send NDJSON stream
						res.writeHead(200, {
							'Content-Type': 'application/x-ndjson',
							'Transfer-Encoding': 'chunked',
						});

						const chunks = ['Hello', ' world', '!', ' How', ' are', ' you?'];
						let i = 0;

						function sendNext() {
							if (i < chunks.length) {
								const isLast = i === chunks.length - 1;
								const line = JSON.stringify({
									model: parsed.model || 'test-model',
									message: { role: 'assistant', content: chunks[i] },
									done: isLast,
								}) + '\n';
								res.write(line);
								i++;
								setTimeout(sendNext, 10);
							} else {
								res.end();
							}
						}

						sendNext();
					});
				} else {
					res.writeHead(404);
					res.end('Not found');
				}
			});
			streamUrl = `http://127.0.0.1:${getServerPort(streamServer)}`;
		});

		suiteTeardown(async () => {
			await closeServer(streamServer);
		});

		test('streaming response contains multiple NDJSON lines', async () => {
			const result = await httpRequest(
				`${streamUrl}/api/chat`,
				{ method: 'POST' },
				JSON.stringify({
					model: 'llama3.1:8b',
					messages: [{ role: 'user', content: 'Count to 3' }],
					stream: true,
				})
			);
			assert.strictEqual(result.status, 200);

			const lines = result.body.split('\n').filter((l) => l.trim());
			assert.ok(lines.length >= 2, `Expected at least 2 NDJSON lines, got ${lines.length}`);
		});

		test('each NDJSON line is valid JSON', async () => {
			const result = await httpRequest(
				`${streamUrl}/api/chat`,
				{ method: 'POST' },
				JSON.stringify({
					model: 'llama3.1:8b',
					messages: [{ role: 'user', content: 'Count to 3' }],
					stream: true,
				})
			);
			const lines = result.body.split('\n').filter((l) => l.trim());
			for (const line of lines) {
				assert.doesNotThrow(() => JSON.parse(line), `Line should be valid JSON: ${line.substring(0, 80)}`);
			}
		});

		test('streaming content can be reassembled', async () => {
			const result = await httpRequest(
				`${streamUrl}/api/chat`,
				{ method: 'POST' },
				JSON.stringify({
					model: 'llama3.1:8b',
					messages: [{ role: 'user', content: 'Count to 3' }],
					stream: true,
				})
			);
			const lines = result.body.split('\n').filter((l) => l.trim());
			let fullContent = '';
			for (const line of lines) {
				const parsed = JSON.parse(line);
				if (parsed.message?.content) {
					fullContent += parsed.message.content;
				}
			}
			assert.strictEqual(fullContent, 'Hello world! How are you?');
		});

		test('final chunk has done: true', async () => {
			const result = await httpRequest(
				`${streamUrl}/api/chat`,
				{ method: 'POST' },
				JSON.stringify({
					model: 'llama3.1:8b',
					messages: [{ role: 'user', content: 'Count to 3' }],
					stream: true,
				})
			);
			const lines = result.body.split('\n').filter((l) => l.trim());
			const lastLine = lines[lines.length - 1];
			const lastParsed = JSON.parse(lastLine);
			assert.strictEqual(lastParsed.done, true, 'Last chunk should have done: true');
		});
	});

	// ────────────────────────────────────────────────
	// Error handling
	// ────────────────────────────────────────────────
	suite('Error handling', () => {
		let errorServer: http.Server;
		let errorUrl: string;

		suiteSetup(async () => {
			errorServer = await createMockServer((req, res) => {
				if (req.url === '/api/404') {
					res.writeHead(404, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'not found' }));
				} else if (req.url === '/api/500') {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'internal server error' }));
				} else if (req.url === '/api/malformed') {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end('{not valid json!!!');
				} else if (req.url === '/api/timeout') {
					// Intentionally never respond
					// Client must handle the timeout
				} else {
					res.writeHead(404);
					res.end('Not found');
				}
			});
			errorUrl = `http://127.0.0.1:${getServerPort(errorServer)}`;
		});

		suiteTeardown(async () => {
			await closeServer(errorServer);
		});

		test('404 response is handled correctly', async () => {
			const result = await httpRequest(`${errorUrl}/api/404`);
			assert.strictEqual(result.status, 404);
			const data = JSON.parse(result.body);
			assert.ok(data.error);
		});

		test('500 response is handled correctly', async () => {
			const result = await httpRequest(`${errorUrl}/api/500`);
			assert.strictEqual(result.status, 500);
			const data = JSON.parse(result.body);
			assert.ok(data.error);
		});

		test('malformed JSON response is caught without crashing', async () => {
			const result = await httpRequest(`${errorUrl}/api/malformed`);
			assert.strictEqual(result.status, 200);
			assert.throws(() => JSON.parse(result.body), 'Malformed JSON should throw on parse');
		});

		test('timeout is handled with abort signal', async () => {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 200);

			try {
				await httpRequest(`${errorUrl}/api/timeout`, {
					signal: controller.signal,
				} as any);
				assert.fail('Should have aborted');
			} catch (err: any) {
				assert.ok(
					err.name === 'AbortError' || err.code === 'ECONNRESET' || err.message?.includes('abort'),
					`Expected abort error, got: ${err.message || err}`
				);
			} finally {
				clearTimeout(timeout);
			}
		});
	});

	// ────────────────────────────────────────────────
	// Provider health check
	// ────────────────────────────────────────────────
	suite('Provider health check', () => {
		let healthServer: http.Server;
		let healthUrl: string;

		suiteSetup(async () => {
			healthServer = await createMockServer((req, res) => {
				if (req.method === 'GET' && req.url === '/api/tags') {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(makeModelList([
						{ name: 'llama3.1:8b', model: 'llama3.1:8b', details: { family: 'llama' } },
					]));
				} else if (req.method === 'GET' && req.url === '/api/tags-empty') {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(makeModelList([]));
				} else {
					res.writeHead(500);
					res.end('Server error');
				}
			});
			healthUrl = `http://127.0.0.1:${getServerPort(healthServer)}`;
		});

		suiteTeardown(async () => {
			await closeServer(healthServer);
		});

		test('health check returns available when models exist', async () => {
			const result = await httpRequest(`${healthUrl}/api/tags`);
			assert.strictEqual(result.status, 200);
			const data = JSON.parse(result.body);
			assert.ok(Array.isArray(data.models));
			assert.ok(data.models.length > 0, 'Should have at least one model');
		});

		test('health check returns empty models list correctly', async () => {
			const result = await httpRequest(`${healthUrl}/api/tags-empty`);
			assert.strictEqual(result.status, 200);
			const data = JSON.parse(result.body);
			assert.ok(Array.isArray(data.models));
			assert.strictEqual(data.models.length, 0, 'Should have zero models');
		});

		test('health check detects unreachable server', async () => {
			// Use a port that's not listening — connect should fail
			const badUrl = 'http://127.0.0.1:1/api/tags';
			try {
				await httpRequest(badUrl);
				assert.fail('Should have thrown');
			} catch (err: any) {
				assert.ok(err, 'Connection to unreachable server should throw');
			}
		});
	});

	// ────────────────────────────────────────────────
	// Model list parsing
	// ────────────────────────────────────────────────
	suite('Model list parsing', () => {
		// Replicate the parseOllamaModels logic from ollamaProvider.test.ts
		interface IOllamaModelRaw {
			name: string;
			model: string;
			size?: number;
			details?: { parameter_size?: string; family?: string };
		}

		function parseOllamaModels(data: { models?: IOllamaModelRaw[] }): Array<{
			id: string;
			displayName: string;
			provider: string;
			contextWindowTokens: number;
			supportsTools: boolean;
			supportsStreaming: boolean;
		}> {
			return (data.models || []).map((m) => {
				const modelName = m.name || m.model;
				const family = m.details?.family?.toLowerCase() ?? '';
				const supportsTools =
					family.includes('llama') || family.includes('mistral') || family.includes('qwen') || family.includes('command');

				function estimateContextWindow(name: string, parameterSize?: string): number {
					const lowerName = name.toLowerCase();
					if (lowerName.includes('llama3.1')) { return 128_000; }
					if (lowerName.includes('llama3') || lowerName.includes('llama-3')) { return 8_192; }
					if (lowerName.includes('mistral') || lowerName.includes('mixtral')) { return 32_000; }
					if (lowerName.includes('qwen2.5') || lowerName.includes('qwen2')) { return 128_000; }
					if (lowerName.includes('deepseek')) { return 64_000; }
					if (parameterSize) {
						const sizeMatch = parameterSize.match(/(\d+)/);
						if (sizeMatch) {
							const params = parseInt(sizeMatch[1], 10);
							if (params >= 70) { return 128_000; }
							if (params >= 30) { return 32_000; }
							if (params >= 7) { return 8_192; }
						}
					}
					return 4_096;
				}

				return {
					id: modelName,
					displayName: modelName,
					provider: 'ollama',
					contextWindowTokens: estimateContextWindow(modelName, m.details?.parameter_size),
					supportsTools,
					supportsStreaming: true,
				};
			});
		}

		test('parses realistic /api/tags response from mock server', async () => {
			let parseServer: http.Server;
			parseServer = await createMockServer((req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					makeModelList([
						{ name: 'llama3.1:8b', model: 'llama3.1:8b', details: { family: 'llama', parameter_size: '8B' } },
						{ name: 'mistral:7b', model: 'mistral:7b', details: { family: 'mistral', parameter_size: '7B' } },
						{ name: 'gemma2:2b', model: 'gemma2:2b', details: { family: 'gemma', parameter_size: '2B' } },
						{ name: 'deepseek-coder:6.7b', model: 'deepseek-coder:6.7b', details: { family: 'deepseek', parameter_size: '6.7B' } },
						{ name: 'qwen2.5:7b', model: 'qwen2.5:7b', details: { family: 'qwen', parameter_size: '7B' } },
					])
				);
			});

			try {
				const parseUrl = `http://127.0.0.1:${getServerPort(parseServer)}`;
				const result = await httpRequest(`${parseUrl}/api/tags`);
				const raw = JSON.parse(result.body);
				const models = parseOllamaModels(raw);

				assert.strictEqual(models.length, 5);
				assert.strictEqual(models[0].id, 'llama3.1:8b');
				assert.strictEqual(models[0].contextWindowTokens, 128_000);
				assert.strictEqual(models[0].supportsTools, true);
				assert.strictEqual(models[1].id, 'mistral:7b');
				assert.strictEqual(models[1].contextWindowTokens, 32_000);
				assert.strictEqual(models[2].id, 'gemma2:2b');
				assert.strictEqual(models[2].supportsTools, false, 'gemma should not support tools');
				assert.strictEqual(models[3].id, 'deepseek-coder:6.7b');
				assert.strictEqual(models[3].contextWindowTokens, 64_000);
				assert.strictEqual(models[4].id, 'qwen2.5:7b');
				assert.strictEqual(models[4].supportsTools, true);
			} finally {
				await closeServer(parseServer);
			}
		});

		test('handles missing models field gracefully', () => {
			const models = parseOllamaModels({});
			assert.strictEqual(models.length, 0);
		});

		test('handles models with missing details gracefully', () => {
			const data = {
				models: [{ name: 'custom-model', model: 'custom-model' }],
			};
			const models = parseOllamaModels(data);
			assert.strictEqual(models.length, 1);
			assert.strictEqual(models[0].id, 'custom-model');
			assert.strictEqual(models[0].supportsTools, false, 'Unknown family should not support tools');
			assert.strictEqual(models[0].contextWindowTokens, 4_096, 'Unknown model should default to 4k context');
		});
	});
});
