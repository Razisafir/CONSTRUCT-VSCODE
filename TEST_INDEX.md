# KOVIX Test Index

> Auto-generated test documentation for the KOVIX AI IDE construct system.
> Last updated: 2026-06-14

## Overview

- **Total test files**: 49
- **Framework**: Mocha (TDD interface)
- **Timeout**: 10,000ms per test
- **Compiler**: TypeScript → CommonJS (ES2022 target)
- **Test runner**: `npm run test-unit-construct`

## Test Categories

### Agent Core (2 files)
| File | Description |
|------|-------------|
| `agent/agentLoop.test.ts` | Agent loop execution, cancellation, and state machine |
| `agent/promptSanitizer.test.ts` | Prompt injection prevention and sanitization |

### Security (2 files)
| File | Description |
|------|-------------|
| `security/security.test.ts` | Core security validations, blocklist enforcement, symlink protection |
| `keymanager/secureKeyManager.test.ts` | PBKDF2 key derivation, key storage, and retrieval |

### Services (25 files)
| File | Description |
|------|-------------|
| `services/agentErrorRecovery.test.ts` | Error recovery workflows and retry logic |
| `services/agentLoop.test.ts` | Agent loop integration tests |
| `services/agentLoopE2E.test.ts` | End-to-end agent loop scenarios |
| `services/browserAutomation.test.ts` | Browser automation service |
| `services/cloudProvider.test.ts` | Cloud AI provider integration |
| `services/codebaseIndex.test.ts` | Codebase indexing and search |
| `services/constructAIService.test.ts` | AI service routing and fallback |
| `services/constructToolRegistry.test.ts` | Tool registration and execution |
| `services/diffApplier.test.ts` | Diff application and conflict resolution |
| `services/distributionDetector.test.ts` | Linux distribution detection |
| `services/executionMode.test.ts` | Execution mode configuration |
| `services/hookService.test.ts` | Agent hook lifecycle management |
| `services/ideaRefinementService.test.ts` | Idea refinement workflow |
| `services/kaliToolBridge.test.ts` | Kali tool bridge and command routing |
| `services/licenseService.test.ts` | License validation |
| `services/mcpConnectionPool.test.ts` | MCP connection pool management |
| `services/memoryOrchestrator.test.ts` | Memory system orchestration |
| `services/milestoneStateMachine.test.ts` | Milestone state machine transitions |
| `services/obsidianMemory.test.ts` | Obsidian vault integration |
| `services/ollamaIntegration.test.ts` | Ollama local model integration (14 pending — requires live server) |
| `services/ollamaProvider.test.ts` | Ollama provider implementation |
| `services/projectService.test.ts` | Project session management |
| `services/secretRedactor.test.ts` | Secret detection and redaction |
| `services/secureKeyManager.test.ts` | Secure key management service |
| `services/sessionService.test.ts` | Session lifecycle management |
| `services/skillService.test.ts` | Skill registration and lookup |
| `services/terminalExecutor.test.ts` | Terminal execution, blocklist, rate limiting |
| `services/terminalSecurity.test.ts` | Terminal security layer |
| `services/universalMemoryService.test.ts` | Universal memory service |
| `services/workspaceGuard.test.ts` | Workspace boundary enforcement |

### Infrastructure (10 files)
| File | Description |
|------|-------------|
| `accessibility/accessibilityI18n.test.ts` | WCAG compliance and i18n |
| `build/buildCi.test.ts` | CI/CD build verification |
| `config/configuration.test.ts` | Configuration schema and defaults |
| `diff/diffApplication.test.ts` | Diff application correctness |
| `ipc/ipcChannel.test.ts` | IPC channel communication |
| `mcp/mcpSystem.test.ts` | MCP system integration |
| `memory/memorySystem.test.ts` | Memory system integration |
| `notification/notificationTelemetryPlugin.test.ts` | Notification telemetry |
| `performance/perfStress.test.ts` | Performance and stress tests |
| `recovery/errorRecovery.test.ts` | Error recovery system |

### Project & UI (5 files)
| File | Description |
|------|-------------|
| `project/projectSession.test.ts` | Project session management |
| `service/serviceContract.test.ts` | Service contract validation |
| `tools/toolRegistry.test.ts` | Tool registry pure functions |
| `ui/uiViews.test.ts` | UI view rendering |
| `unit/pureLogic.test.ts` | Pure logic unit tests |

## Running Tests

```bash
# Compile and run all construct tests
npm run test-unit-construct

# Run specific test file
npx mocha --ui tdd --timeout 10000 test/unit/construct/out-test/services/terminalSecurity.test.js

# Run security tests only
npm run test-security

# Run with coverage
npm run test-coverage
```

## Test Configuration

- `tsconfig.json` — TypeScript config for test compilation (ES2022, CommonJS, strict mode)
- Output directory: `test/unit/construct/out-test/`
- Stubs directory: `test/unit/construct/_stubs/`

## Known Pending Tests

- `services/ollamaIntegration.test.ts` — 14 tests require a live Ollama server
