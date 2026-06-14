# Changelog

## [1.0.0] - 2026-06-14

### Security — CRITICAL (Command Injection)
- **shellEscape()**: New utility function in kaliToolBridge.ts — properly escapes `$()`, backticks, `\n`, `!`, `$`, `\` in bash -c arguments (previously only double-quotes were escaped)
- **sanitizeShellArg()**: New validation function in kaliToolBridgeService.ts — rejects shell metacharacters (`;`, `&`, `|`, `` ` ``, `$`, `()`, `{}`, `!`, `<>`, `\n`, `\r`) in all Kali tool parameters
- **WSL wrapping fix**: constructToolRegistryService.ts now uses shellEscape() instead of simple double-quote replacement
- All 14 Kali tool methods now validate inputs before command construction
- Metasploit options (Record values) are individually validated against injection

### Security — HIGH (XSS + Defense-in-Depth)
- **XSS fix — Memory Explorer**: Replaced innerHTML with safe DOM construction (createElement + textContent)
- **XSS fix — Memory Editor**: All user-controlled data in innerHTML now passes through escapeHtml()
- **XSS fix — Onboarding**: Replaced innerHTML with textContent + DOM API for error/status messages
- **XSS fix — Markdown links**: javascript:, data:, vbscript: schemes stripped from markdown link rendering
- **MCP tool allowlist**: Added `delete_file` and `exists` to ALLOWED_TOOLS in workspaceGuard.ts
- **Output truncation**: All 14 Kali tool methods now truncate output at 10,000 chars via truncateOutput()
- **Timing-safe comparison**: Added validateKeyConstantTime() using crypto.timingSafeEqual for credential comparison

### Security — MEDIUM (Hardening)
- **Per-installation PBKDF2 salt**: Random salt stored in kovix-salt.bin instead of hardcoded constant
- **Security headers**: Added X-Frame-Options: DENY, X-Content-Type-Options: nosniff, HSTS, Referrer-Policy to web client server
- **safeJsonParse()**: New utility function for safe JSON parsing with fallback — applied to obsidianMemoryServiceImpl and ideaRefinementServiceImpl
- **sanitizeErrorForAgent()**: Strips filesystem paths from error messages returned to LLM agent
- **Shell metachar regex**: Added `$\w` (variable expansion), `<<<` (herestrings), `<>` (open rw), `\n` `\r` (newline injection)
- **assertWithinWorkspace**: Fixed call without workspaceRoot parameter in mcpProcess.ts

### Code Quality — any Type Elimination (31+ instances)
- **MCP files**: mcpConnectionPool.ts — defined 5 return-type interfaces, replaced all any types
- **MCP files**: mcpServerManagerService.ts — proper array types instead of `{}`
- **Memory services**: constructMemoryService.ts — ISupermemoryClient interface; memoryOrchestratorService.ts — proper Map type; obsidianMemoryServiceImpl.ts — unknown + type guards
- **embeddingService.ts**: EmbeddingPipeline interface replaces any
- **secureKeyManager.ts**: IAPIModelsResponse, IOllamaTagsResponse, IAPIValidationResponse interfaces
- **mcpMarketplaceService.ts**: IRegistryEntry + IRegistryResponse interfaces
- **codeReviewToolService.ts**: IReviewFindingRaw interface
- **sessionServiceImpl.ts**: unknown with type narrowing
- **Platform types**: mcpTypes.ts data → Record<string, unknown>; mcpServerManager.ts args → Record<string, unknown>; memoryTypes.ts metadata → Record<string, unknown>
- **constructAgentView.ts**: Removed unused import, typed progressPanel as optional, typed quick-pick items
- **construct.contribution.ts**: IConstructQuickPickItem and IMemoryCategoryQuickPickItem interfaces
- **agentLoop.ts**: input typed as Record<string, unknown>
- **skillServiceImpl.ts**: URI type for loadSkillFile parameter
- **constructSecureKeyService.ts**: _saltOverride field, NodeJS.ErrnoException type guard

### Testing — 260 Placeholders Replaced
- **security.test.ts**: 44 placeholder tests → real assertions testing detectShellMetacharInArgs, redactSecrets, promptSanitiser, validateToolName, TerminalRateLimiter, isPrivilegeEscalation
- **pureLogic.test.ts**: 36 placeholder tests → real assertions for type validation, sort/filter, token counting, diff parsing
- **13 placeholder test files**: All 130 placeholders replaced with real assertions (mcpSystem, e2e, memory, tools, diff, build, ipc, project, config, service, accessibility, performance, notification)
- **ui/uiViews.test.ts**: 10 placeholders → 57 real assertions (ErrorBanner, ARIA roles, keyboard nav, focus trap, theme CSS)
- **ollamaProvider.mock.test.ts**: New 22 tests with mock HTTP server (no Ollama required)
- **3 duplicate files deleted**: recovery/errorRecovery, agent/agentLoop, keymanager/secureKeyManager (real tests in services/)
- **0 placeholder tests remain**

### CI/CD + Launch Readiness
- **build.yml**: Fixed stale `construct-ide-darwin-x64.zip` → `kovix-darwin-x64.zip`
- **basic.yml**: Fixed Xvfb init script path reference
- **package.json**: Added `test:coverage` script with nyc
- **build-verify.yml**: Added coverage reporting step
- **kaliToolBridgeService.ts**: Added ALLOWED_NMAP_FLAGS options validation
- **constructInlineCompletion.ts**: Added provideInlineCompletions() method signature

### Changed
- Test suite: 754 → 866 passing tests (+112 new real tests)
- TypeScript: 0 errors (was 9 TS errors + 12 MCP type errors)
- `any` types: 0 in src/ (was 31+)
- Placeholder tests: 0 (was 260)

### Fixed
- IToolResult type mismatch on 9 Kali security tool stubs (returned `tool`/`status`/`target` instead of `output`)

## [1.0.0] - 2026-06-11

### Fixed
- **Multi-turn conversation context**: Agent now retains conversation history across turns within a session (50-message cap)
- **Memory injection sanitization**: Added PromptSanitizer to prevent prompt injection via memory context
- **AbortSignal propagation**: Stop button now cancels running tool execution immediately
- **Provider switch abort**: Switching AI providers mid-stream cleanly aborts the active stream
- **Keybinding conflict**: Changed Construct panel shortcut from Ctrl+Shift+K to Ctrl+Shift+L

### Changed
- **Tool registry integration**: Core tools now route through IConstructToolRegistry for extensibility
- **FileWatcher**: Implemented real file system watching with recursive fs.watch and debouncing
- **Memory stats**: MemoryOrchestrator now returns real metrics instead of hardcoded zeros
- **Removed Python agent-backend**: Non-functional Python backend removed; all AI via TypeScript providers
- **CI/CD**: Consolidated build and release workflows; npm audit now fails on critical CVEs

### Added
- **Obsidian-like Memory System**: Visual memory explorer with CRUD, search, import/export, and auto-extraction
- **SECURITY.md**: Security policy with vulnerability reporting process
- **Known Limitations section**: Documented in README.md

### Security
- SEC-6 enhanced: PromptSanitizer blocks injection patterns in memory context
- npm audit now blocks release on critical CVEs

## [1.0.0] - 2026-06-10

### Renamed
- Product renamed from "Construct IDE" to "Kovix"
- New domain: kovix.dev
- Bundle ID updated to ai.kovix.ide

### Fixed (Grand Launch)
- Multi-turn conversation context preserved across run() calls (Bug 1)
- Universal memory injection sanitized against prompt injection (Bug 2)
- AbortSignal propagated to tool execution for immediate cancellation (Bug 3)
- Provider switch aborts in-flight streams cleanly (Bug 4)
- Keybinding changed from Ctrl+Shift+K to Ctrl+Shift+L to avoid Delete Line conflict (Bug 5)
- FileWatcher now uses fs.watch for external file change detection (Stub 1)
- MemoryOrchestrator stats now return real metrics (Stub 2)

### Removed (Grand Launch)
- Non-functional Python agent backend (Stub 3)

### Added (Grand Launch)
- PromptSanitizer utility for memory context sanitization
- Unit tests for Construct services

### CI (Grand Launch)
- Consolidated build/release workflows — build.yml is compile-only on push to main, release.yml is the sole tagged-release workflow
- npm audit now fails on critical CVEs (removed continue-on-error)
- release.yml uses npm ci instead of npm install
- release.yml upgraded to softprops/action-gh-release@v2
- macOS runner cost trade-off documented in release.yml

### Docs (Grand Launch)
- Added SECURITY.md with vulnerability reporting policy, supported versions, and known security considerations
- Added Known Limitations section in README.md

## [1.0.0] - 2026-06-09

### Added
- AI-native agent framework built on MCP (Model Context Protocol)
- Vector memory integration via Qdrant
- Local ML inference via Transformers.js (@xenova/transformers)
- Persistent memory layer via Supermemory
- Redis-backed session management via ioredis
- Kovix branding and identity

### Changed
- Rebranded from Code-OSS to Kovix
- Extension gallery pointed to Open VSX Registry (open-source marketplace)

### Based On
- Microsoft Code-OSS (VS Code open source) — MIT License

---

## [1.0.0-beta] — 2025

### Added (Phase 2)

- LLM Provider Layer: Anthropic (SSE streaming) and Ollama (NDJSON streaming) providers
- Typed error classes: ConstructAuthError, ConstructRateLimitError, ConstructOverloadedError, ConstructNetworkError
- API key management via VS Code SecretStorage (construct.setApiKey / construct.clearApiKey commands)
- Configuration settings: construct.provider, construct.anthropic.model, construct.ollama.baseUrl, construct.ollama.model, construct.maxTokens

### Added (Phase 3)

- Agent loop with full plan/act cycle: message → system prompt → LLM → parse tool calls → execute → loop
- Core tools: file_read (with 100KB truncation, path traversal protection), file_write (overwrite/append/create_only modes), run_terminal_command (with allowlist + approval gate), list_directory (recursive, .gitignore aware)
- Tool registry with auto-generated system prompt tools section
- Max iteration limit (15 rounds), per-call timeout (60s), error propagation, cancellation support

### Added (Phase 4)

- CONSTRUCT sidebar panel with Activity Bar icon
- Chat view: scrollable message list, textarea input (Shift+Enter for newlines), send/stop/clear buttons
- Status bar integration: provider/model indicator, pending changes counter
- Streaming response rendering with auto-scroll
- Provider status and configuration UI (gear icon, test connection)

### Added (Phase 6)

- Security tools: nmap_scan (XML output parsing, confirmation gate), ghidra_decompile (Docker headless), nuclei_scan (JSON output parsing, severity filtering)
- construct.enableSecurityTools configuration setting
- All security tools gated behind user confirmation dialogs

### Added (Phase 7)

- MCP server management: spawn, communicate (JSON-RPC over stdio), auto-restart (3 retries with exponential backoff)
- MCP tool dispatch: serverName__toolName routing in agent loop
- construct.mcp.servers configuration for server definitions

### Added (Phase 8)

- Semantic memory: Ollama embedding service (/api/embed with nomic-embed-text, pseudo-embedding fallback)
- Workspace indexing command (construct.indexWorkspace)
- Memory integration: top-5 relevant context chunks prepended to system prompt

### Packaging (Phase 9)

- Documented packaging approaches and system requirements (PACKAGING.md)
- VSIX packaging confirmed N/A (fork architecture, not an extension)
- Gulp pipeline verified: vscode-linux-x64, deb, rpm, snap targets available
- Full build requires 16+ GB RAM (OOM on 8 GB system)

## [0.1.0-beta] — 2025

### Added

- Unified AI provider system (`IConstructAIService`) with Ollama, Xenova, and Cloud backends
- Autonomous agent loop with plan/act cycle and 5 built-in tools
- Real semantic search via Ollama embeddings + BM25 fallback
- 4-step onboarding wizard with Ollama and WSL2 detection
- Kali Linux terminal integration on Windows via WSL2
- MCP tool execution engine with command safety blocklist
- Path traversal protection on all file operations
- Prompt injection defence on context injection
- API key vault via OS keychain
- Telemetry fully disabled (1DS stubbed)
- Custom status bar model picker
- Open VSX extension gallery (no Microsoft account required)

### Security

- Electron contextIsolation and sandbox enabled
- IPC channel input validation with allowlists and shared constants (constructIpcChannels.ts)
- Terminal command blocklist and rate limiting
- Secret redaction in all log output
- Pre-commit hook for secret detection

### Known Issues

- `@xenova/transformers` ONNX inference not yet functional in Electron sandbox (BM25 fallback active)
- macOS code signing not configured for v0.1.0-beta (unsigned build)
- Windows SmartScreen warning expected on first launch (unsigned installer)
