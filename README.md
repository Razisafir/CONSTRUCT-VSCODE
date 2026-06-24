<div align="center">

# Kovix

**AI-native development environment — Claude Code, in your IDE, with its own OS.**

[![Version](https://img.shields.io/badge/version-v1.8.0--pre-blue.svg)](https://github.com/Razisafir/KOVIX/releases)
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](./LICENSE.txt)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Razisafir/KOVIX/releases)
[![Build](https://github.com/Razisafir/KOVIX/actions/workflows/ci.yml/badge.svg)](https://github.com/Razisafir/KOVIX/actions)

</div>

---

## Download

Grab the latest release for your platform from [GitHub Releases](https://github.com/Razisafir/KOVIX/releases/latest). Asset names follow the pattern `KovixSetup-x64-v<version>.exe` / `kovix-darwin-x64.zip` / `kovix_<version>_amd64.deb` (plus `.rpm` and `.tar.gz` variants on Linux):

| Platform | Download | Size |
|---|---|---|
| Windows (x64, system installer) | `KovixSetup-x64-v1.7.1.exe` | ~170 MB |
| macOS (Intel) | `kovix-darwin-x64.zip` | ~95 MB |
| macOS (Apple Silicon) | build from source — see [INSTALL.md](./INSTALL.md) | — |
| Linux (Debian/Ubuntu) | `kovix_1.7.1_amd64.deb` | ~150 MB |
| Linux (Fedora/RHEL) | `kovix-1.7.1.x86_64.rpm` | ~150 MB |
| Linux (universal) | `kovix-1.7.1.tar.gz` | ~140 MB |

Every release ships a `checksums.txt` alongside the assets — verify the download before installing:

```bash
sha256sum -c checksums.txt --ignore-missing
```

---

## What is Kovix?

Kovix is an AI-native development environment built on a VS Code fork. The headline feature is an autonomous coding agent that lives in a right-side panel — like Cursor's composer or Claude Code, but embedded in the IDE rather than the terminal. The agent has its own "OS": it can read and write files, execute terminal commands, search the codebase semantically, browse the web, call MCP servers, and spawn sub-agents — all with human approval before applying changes.

**v1.8.0 (in development)** adds the Kovix Consolidation pass: verification-gap fix (Plan→Approve→Execute→**Verify**→Complete with `Verifying` / `VerificationFailed` states), cost governor + credit system + execution sanity interfaces ported from the phase-28-launch lineage (interfaces registered, runtime wiring tracked in #140/#141/#142), and the construct→kovix identifier rename. Multi-agent swarm is **not** in v1.x (see [`docs/DECISIONS-v1.8.0.md`](./docs/DECISIONS-v1.8.0.md) for the full reasoning).

**v1.7.1 ships the Teal Identity release** — the entire workbench (editor, activity bar, sidebar, status bar, command palette, dialogs) is re-themed around a single signature palette: teal `#14B8A6` accents on a blue-black `#0B1115` canvas. The theme is auto-applied on first launch — no manual theme selection needed.

### Why Kovix instead of Cursor or Claude Code?

- **Multi-provider, user-owned keys** — Use NVIDIA NIM, OpenRouter, OpenAI, Anthropic, Gemini, Mistral, Groq, Together, DeepSeek, LM Studio, Ollama, or any OpenAI-compatible endpoint. Your keys, your choice, your cost.
- **Per-agent model selection** — Each agent mode (architect, coder, reviewer, debugger, etc.) can use a different model. Run a strong model for planning and a cheap fast model for execution.
- **Runs locally** — Works with Ollama or LM Studio. Your code and keys never leave your machine if you don't want them to. (Note: the in-process ONNX provider via Transformers.js requires an internet connection on first model load — model weights and WASM binaries are fetched from the HuggingFace Hub. For fully offline use, prefer Ollama.)
- **No telemetry, no Microsoft account, no subscription** — All Microsoft telemetry stripped out. Open VSX gallery replaces the proprietary marketplace.
- **Right-side agent panel** — Matches Google Antigravity's layout. The agent sits beside your code, not on top of it.

## Quick Start

1. **Download and install Kovix** from [Releases](https://github.com/Razisafir/KOVIX/releases/latest)
2. **Launch Kovix** — the setup wizard walks you through provider configuration
3. **Pick a model:**
   - **Local (free, offline):** Install [Ollama](https://ollama.ai) and run `ollama pull qwen2.5-coder:7b`
   - **NVIDIA NIM (free tier, fast):** Get a key at [build.nvidia.com](https://build.nvidia.com) → Kovix Settings → NVIDIA NIM → paste `nvapi-...`
   - **OpenRouter (one key, all models):** Get a key at [openrouter.ai](https://openrouter.ai) → Kovix Settings → OpenRouter → paste `sk-or-...`
   - **Any other OpenAI-compatible provider:** Anthropic, OpenAI, Gemini, Mistral, Groq, Together, DeepSeek, LM Studio, LiteLLM, custom
4. **Open the agent panel:** `Ctrl+Shift+K` (or `Ctrl+Alt+B` to toggle the auxiliary bar)
5. **Ask the agent to do something:** "Read the file at src/index.ts and refactor it to use async/await"

## Supported LLM Providers

Kovix v1.7.0 supports 13 first-class providers, all configured via the **Kovix: Manage API Keys** command (`Ctrl+Shift+P` → "Manage API Keys"):

| Provider | Endpoint | Auth | Notes |
|---|---|---|---|
| **Anthropic** | `api.anthropic.com` | `sk-ant-...` | Native Anthropic Messages API |
| **OpenAI** | `api.openai.com` | `sk-...` | GPT-4o, o1, etc. |
| **NVIDIA NIM** | `integrate.api.nvidia.com/v1` | `nvapi-...` | Llama, Nemotron, Mistral, Qwen, DeepSeek — 121+ models |
| **OpenRouter** | `openrouter.ai/api/v1` | `sk-or-...` | Multi-model router — one key for all major models |
| **LM Studio** | `localhost:1234/v1` | none | Local, OpenAI-compatible |
| **Together AI** | `api.together.xyz/v1` | Bearer | Hosted Llama, Qwen, etc. |
| **Groq** | `api.groq.com/openai/v1` | `gsk_...` | Ultra-fast Llama/Mixtral inference |
| **Mistral AI** | `api.mistral.ai/v1` | Bearer | Mistral Large, Codestral, Mixtral |
| **Google Gemini** | `generativelanguage.googleapis.com/v1beta/openai` | Bearer | Gemini 1.5/2.0 Pro/Flash (OpenAI-compat mode) |
| **DeepSeek** | `api.deepseek.com/v1` | Bearer | DeepSeek Chat, Coder, R1 |
| **Ollama** | `localhost:11434` | none | Local, native Ollama API |
| **LiteLLM** | user-defined | optional | Local proxy for unified routing |
| **Custom** | user-defined | optional | Any OpenAI-compatible endpoint |

All API keys are stored in the OS keychain (macOS Keychain / Windows Credential Manager / Linux libsecret). No plaintext keys in config files.

## Agent Modes & Multi-Agent Swarms

Kovix v1.7.0 ships **agent modes** (inspired by Roo Code's custom modes pattern). Each mode defines a role, a set of tools, and optionally a specific model. Switch modes from the Command Palette (`Ctrl+Shift+P` → "Switch Agent Mode") or create your own.

### Built-in Modes

| Mode | Icon | Purpose | Tools | Can Spawn Sub-Agents? |
|---|---|---|---|---|
| **General** | spark | All-purpose assistant (default) | all | no |
| **Architect** | library | Plans multi-file changes, hands off to Coder | search, planning, memory | yes |
| **Coder** | code | Executes plans by editing files + running commands | file, terminal, search, diff | yes |
| **Reviewer** | eye | Reviews pending diffs for bugs/security/style | search, memory | no |
| **Debugger** | bug | Reproduces issues, reads stack traces, bisects | file, terminal, search | no |
| **Ask** | comment-discussion | Pure Q&A — no file modifications | search, memory | no |

### Per-Mode Model Selection

Each mode can override the global model. Run a strong model (Claude Sonnet, GPT-4o) for the Architect mode and a cheap fast model (Llama 3.1 8B, Haiku) for the Coder mode — best of both worlds.

> **Note on multi-agent / sub-agent swarms (v1.8.0):** The `parallelSwarm` and `swarmSize` settings exist in Kovix v1.x but are **no-ops** — multi-agent execution is deferred to v2.0 pending a design decision between the pool-model and role-handoff-model implementations on recovery branches. See [`docs/DECISIONS-v1.8.0.md`](./docs/DECISIONS-v1.8.0.md) for the full reasoning. Single-agent mode (one agent per session, with idea→plan→execute→verify→complete) is fully implemented and is what v1.x ships.

### Custom Modes

Create unlimited custom modes via **Kovix: Create Custom Agent Mode**. Each mode stores:
- Slug (unique ID)
- Display name
- Role definition (system prompt prefix)
- Tool groups (file, terminal, search, browser, mcp, memory, git, diff, planning, sub-agent)
- Model preference (provider + model)
- Sub-agent capability

Modes persist to `.kovix/modes.json` and sync across windows.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+K` | Open the Kovix Agent panel |
| `Ctrl+Alt+B` | Toggle the right-side auxiliary bar (where the agent lives) |
| `Ctrl+Shift+I` | Show inline agent |
| `Ctrl+Enter` | Send message |
| `Ctrl+Shift+Enter` | Accept all pending diffs |
| `Ctrl+Shift+Escape` | Reject all pending diffs |
| `Ctrl+Shift+P` | Command palette (run any Kovix command) |

## Commands

All Kovix commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

### Provider & Model
| Command | Description |
|---|---|
| `construct.manageApiKeys` | Manage API keys for all providers (opens provider picker) |
| `construct.switchProvider` | Switch between Ollama / Xenova / Cloud |
| `construct.selectModel` | Select the active model from a dropdown |
| `construct.switchAgentMode` | Switch active agent mode (general/architect/coder/reviewer/debugger/ask) |
| `construct.openApiSettings` | Open Kovix API settings |

### Agent Modes & Swarm (v1.7.0)
| Command | Description |
|---|---|
| `construct.createAgentMode` | Create a custom agent mode with its own model + tools |
| `construct.spawnSubAgent` | Spawn a sub-agent with a specific mode + task |

### Chat & Memory
| Command | Description |
|---|---|
| `construct.focusPanel` | Open the Kovix Agent panel |
| `construct.newChat` | Start a new chat session |
| `construct.indexWorkspace` | Index workspace for semantic search |
| `construct.openMemoryPanel` | Open the Memory panel |
| `construct.searchMemories` | Search stored memories |
| `construct.addMemory` | Add a manual memory entry |
| `construct.undoTask` | Undo last agent task |
| `construct.showInlineAgent` | Show inline agent |

### Connection Tests
| Command | Description |
|---|---|
| `construct.testCloudConnection` | Test cloud AI connection |
| `construct.testMemoryConnection` | Test memory service connection |

## Configuration

Kovix stores settings in `.kovix/settings.json` (workspace-scoped) and the OS keychain (for API keys):

```json
{
  "construct.api.activeProvider": "nvidia",
  "construct.api.nvidia.endpoint": "https://integrate.api.nvidia.com/v1",
  "construct.cloud.model": "meta/llama-3.1-70b-instruct",
  "construct.ideaRefinement.enabled": true,
  "construct.memory.enabled": true,
  "construct.embedding.model": "nomic-embed-text",
  "construct.mcp.servers": []
}
```

| Field | Description |
|---|---|
| `construct.api.activeProvider` | Active LLM provider (see table above) |
| `construct.cloud.model` | Active model ID for the cloud provider |
| `construct.ideaRefinement.enabled` | Whether to run idea refinement before planning |
| `construct.memory.enabled` | Enable vector memory (Qdrant + BM25 fallback) |
| `construct.embedding.model` | Embedding model for semantic search |
| `construct.mcp.servers` | Array of MCP server configurations |

## MCP (Model Context Protocol) Servers

Kovix supports MCP, allowing you to connect external tool servers that extend the agent's capabilities. Configure servers in settings:

```json
{
  "construct.mcp.servers": [
    {
      "name": "agent-reach",
      "command": "npx",
      "args": ["-y", "@agent-reach/mcp-server"]
    }
  ]
}
```

Tools from MCP servers are dispatched as `serverName__toolName`. The agent auto-discovers available tools when the server connects.

## Semantic Memory

Kovix indexes your workspace for semantic search:

1. **Indexing** — Run `Kovix: Index Workspace`. Files are chunked and embedded using Ollama's `nomic-embed-text` (or pseudo-embeddings as fallback).
2. **Storage** — Embeddings in local Qdrant. BM25 keyword indexing as fallback.
3. **Retrieval** — Relevant code chunks are auto-injected into agent conversations.

## Internet Research (Agent Reach)

Kovix integrates **Agent Reach**, giving the agent web research capabilities — YouTube, GitHub, Reddit, Bilibili, X, Xiaohongshu, Exa semantic search, RSS, and arbitrary webpages. No API keys required for most channels.

Install via the setup wizard or add the MCP server manually. Run `agent_reach__doctor` to check which channels are operational.

## Design Intelligence (UI-UX Pro Max)

Bundled at `.kovix/skills/ui-ux-pro-max/`. Provides 67 UI styles, 161 color palettes, 57 font pairings, 99 UX guidelines, and 25 chart types across 16+ tech stacks. Ask the agent "design a SaaS dashboard" and it'll generate a complete design system.

## Behavioral Rules (Ponytail)

Ponytail makes the agent adopt a "lazy senior developer" mindset: YAGNI → stdlib → native platform → installed deps → one line → minimum code. Three intensity levels (Lite / Full / Ultra) plus Off. Cycle modes from the status bar `[PONYTAIL]` badge or via slash commands in chat.

## Security Tooling

Kovix integrates professional security tools with mandatory safety gates (explicit user confirmation required before execution):

| Tool | Description | Requires |
|---|---|---|
| `nmap_scan` | Network scanning with XML output parsing | `nmap` |
| `ghidra_decompile` | Binary decompilation via Docker headless Ghidra | Docker + `ghidra-headless` |
| `nuclei_scan` | Template-based vulnerability scanning | `nuclei` |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                            Kovix                              │
├────────────┬─────────────┬─────────────┬────────────────────┤
│  Editor    │  File       │ Terminal    │  Right-side        │
│ (VS Code   │  Explorer   │ (Kali/WSL2) │  Agent Panel       │
│  fork)     │             │             │  (auxiliary bar)   │
├────────────┴─────────────┴─────────────┴────────────────────┤
│                   IConstructAIService                        │
│         (auto-selects best available provider)               │
├─────────┬──────────┬──────────┬─────────────────────────────┤
│ Ollama  │  Xenova  │  Cloud   │  (per-mode override)        │
│Provider │ Provider │ Provider │                             │
├─────────┴──────────┴──────────┴─────────────────────────────┤
│  Agent Modes (general/architect/coder/reviewer/debugger/ask) │
│  + Sub-Agent Swarm (OpenAI Swarm handoff pattern)            │
├──────────────────────────────────────────────────────────────┤
│          Tool Registry (Built-in + MCP + Security)           │
├────────────┬──────────────┬─────────────────────────────────┤
│ Agent Tools│ Security     │  MCP Server Tools               │
│ read/write │ nmap/        │  server__tool                   │
│ run/search │ ghidra/      │  (user-configured)              │
│ memory/diff│ nuclei       │                                 │
├────────────┴──────────────┴─────────────────────────────────┤
│        Semantic Memory (Qdrant vectors + BM25 fallback)      │
│        + Working / Episodic / Semantic / Procedural layers   │
└──────────────────────────────────────────────────────────────┘
```

## Built on Code-OSS

Kovix is built on [Microsoft's Code-OSS](https://github.com/microsoft/vscode), the open-source foundation of VS Code, used under the [MIT License](https://opensource.org/licenses/MIT).

## Prerequisites

- **Node.js 20+** and **npm 10+** (for building from source)
- **Git**
- For local AI: [Ollama](https://ollama.ai) (recommended) or [LM Studio](https://lmstudio.ai)
- For Kali terminal (Windows only): WSL2 + Kali Linux from Microsoft Store
- For Ghidra decompilation: [Docker](https://www.docker.com) + `ghidra-headless` image

See [INSTALL.md](./INSTALL.md) for detailed platform-specific installation instructions.

## Build from Source

```bash
git clone https://github.com/Razisafir/KOVIX
cd KOVIX
npm install
NODE_OPTIONS="--max-old-space-size=8192" npm run compile
./scripts/code.sh        # Linux/macOS — dev launcher (BUILD.md's reference to ./scripts/construct.sh is stale post-rename)
.\scripts\code.bat       # Windows — dev launcher
```

For detailed build instructions, see [BUILD.md](./BUILD.md). For packaging into installers (.deb/.rpm/.exe/.zip), see [PACKAGING.md](./PACKAGING.md).

## License

This project is licensed under a Proprietary license. See [LICENSE.txt](./LICENSE.txt) for the full terms. Kovix is a fork of [Code-OSS](https://github.com/microsoft/vscode) by Microsoft, used under the MIT License — see [NOTICE.md](./NOTICE.md) and [ThirdPartyNotices.txt](./ThirdPartyNotices.txt) for third-party attribution.

---

<div align="center">

**[Download Kovix Latest Release](https://github.com/Razisafir/KOVIX/releases/latest)** · **[Report an Issue](https://github.com/Razisafir/KOVIX/issues)** · **[Read the Changelog](./CHANGELOG.md)** · **[Architecture Decisions v1.8.0](./docs/DECISIONS-v1.8.0.md)** · **[Security Policy](./SECURITY.md)** · **[Privacy Policy](./PRIVACY.md)**

</div>
