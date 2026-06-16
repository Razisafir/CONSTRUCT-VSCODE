<div align="center">

# Kovix

**AI-native development environment with autonomous coding agents**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Razisafir/KOVIX)
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](./LICENSE.txt)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Razisafir/KOVIX)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/Razisafir/KOVIX/actions)

</div>

---

## Download

Grab the latest release for your platform from [GitHub Releases](https://github.com/Razisafir/KOVIX/releases):

| Platform | Download |
|---|---|
| Windows | `.exe` installer |
| macOS | `.dmg` (Intel and Apple Silicon) |
| Linux | `.deb` / `.rpm` / `.tar.gz` |

---

## What is Kovix?

Kovix is an AI-native development environment with autonomous coding agents built directly into the editor. Describe what you need -- the agent reads your codebase, writes code, runs terminal commands, and searches your project -- all with human approval before applying changes.

Unlike cloud-dependent tools like Cursor or GitHub Copilot, Kovix is designed to work with **local LLMs** via Ollama or LM Studio. Your code and API keys never leave your machine. No telemetry, no Microsoft account, no subscription.

The agent uses a plan/act loop: it reasons through the steps, calls tools (file read/write, terminal execution, code search), and presents changes for your review. Switch between Ollama for fully offline inference, Xenova Transformers.js for in-process ONNX models, or cloud APIs like Anthropic for maximum capability.

## Quick Start

1. **Install a local AI runtime** (recommended): [Ollama](https://ollama.ai)
2. **Pull the recommended models:**

   ```bash
   ollama pull llama3.2
   ollama pull nomic-embed-text
   ```

3. **Download and install Kovix** from [Releases](https://github.com/Razisafir/KOVIX/releases)
4. **Launch Kovix** -- the setup wizard opens automatically and walks you through provider setup

Re-open the wizard anytime via the Command Palette: `Construct: Open Setup Wizard`

## Built on Code-OSS

Kovix is built on [Microsoft's Code-OSS](https://github.com/microsoft/vscode), the open-source foundation of VS Code, used under the [MIT License](https://opensource.org/licenses/MIT).

## Features

- **Autonomous AI coding agents with tool use** -- Plan-act agent loop that reads files, writes code, runs terminal commands, and searches your codebase with human approval before applying changes
- **MCP protocol support** -- Connect any Model Context Protocol server to extend agent capabilities with custom tools via JSON-RPC over stdio
- **Vector memory (Qdrant)** -- Index your entire workspace into vector embeddings for semantic search and automatic context injection into agent conversations
- **Local ML models (Transformers.js)** -- In-process ONNX inference via @xenova/transformers for code completion without any external API
- **Persistent memory (Supermemory)** -- Conversation context persistence and memory management across sessions
- **Offline-first: runs on Ollama, LM Studio, or local ONNX models** -- GPU-accelerated inference with automatic fallback to in-process ONNX or cloud APIs
- **Built-in Kali Linux terminal on Windows via WSL2** -- Detects Kali WSL2 automatically and adds a dedicated terminal profile for security testing workflows
- **Security tooling: nmap, Ghidra, Nuclei** -- Integrated network scanning, binary decompilation, and vulnerability scanning with safety gates requiring explicit user confirmation
- **Multi-model: switch between local and cloud models in one click** -- Status bar model picker lets you swap providers instantly
- **No telemetry, no Microsoft account, no subscription** -- All Microsoft telemetry removed; Open VSX gallery replaces the proprietary marketplace

## Screenshots

Coming soon.

## Prerequisites

- **Node.js 20+** and **npm 10+** (for building from source)
- **Git**
- For local AI: [Ollama](https://ollama.ai) (recommended) or [LM Studio](https://lmstudio.ai)
- For Kali terminal (Windows only): WSL2 + Kali Linux from Microsoft Store
- For Ghidra decompilation: [Docker](https://www.docker.com) + `ghidra-headless` image

See [INSTALL.md](./INSTALL.md) for detailed platform-specific installation instructions.

## Installation

### Download from Releases

Pre-built binaries for Windows, macOS, and Linux are available on the [GitHub Releases](https://github.com/Razisafir/KOVIX/releases) page.

### Build from Source

```bash
git clone https://github.com/Razisafir/KOVIX
cd KOVIX
npm install
NODE_OPTIONS="--max-old-space-size=8192" npm run compile
./scripts/code.sh        # Linux/macOS
.\scripts\code.bat       # Windows
```

For detailed build instructions, see [BUILD.md](./BUILD.md).

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+K` | Open Kovix Agent panel |
| `Ctrl+Shift+I` | Show inline agent |
| `Ctrl+Enter` | Send message |
| `Ctrl+Shift+Enter` | Accept all pending diffs |
| `Ctrl+Shift+Escape` | Reject all pending diffs |

## Commands

All Kovix commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `construct.focusPanel` | Open the Kovix Agent panel (`Ctrl+Shift+K`) |
| `construct.newChat` | Start a new chat session |
| `construct.setApiKey` | Set Anthropic API key (stored in OS keychain) |
| `construct.clearApiKey` | Remove stored API key |
| `construct.switchProvider` | Switch between Ollama / Xenova / Cloud providers |
| `construct.selectModel` | Select the active AI model |
| `construct.indexWorkspace` | Index workspace for semantic search |
| `construct.openMemoryPanel` | Open the Memory panel |
| `construct.searchMemories` | Search stored memories |
| `construct.addMemory` | Add a manual memory entry |
| `construct.testCloudConnection` | Test cloud AI connection |
| `construct.testMemoryConnection` | Test memory service connection |
| `construct.openApiSettings` | Open Kovix API settings |
| `construct.undoTask` | Undo last agent task |
| `construct.showInlineAgent` | Show inline agent (`Ctrl+Shift+I`) |

## Configuration

Kovix stores workspace settings in `.kovix/settings.json`:

```json
{
  "defaultModel": "llama3.2",
  "ollamaEndpoint": "http://localhost:11434",
  "kaliEnabled": false,
  "providerType": "ollama",
  "embeddingModel": "nomic-embed-text",
  "enableSecurityTools": true
}
```

| Field | Description |
|---|---|
| `defaultModel` | Model ID used for agent conversations (e.g. `llama3.2`, `mistral`) |
| `ollamaEndpoint` | Ollama API base URL (default: `http://localhost:11434`) |
| `kaliEnabled` | Enable the Kali Linux terminal profile (Windows + WSL2 only) |
| `providerType` | AI provider backend: `ollama`, `xenova`, or `cloud` |
| `embeddingModel` | Embedding model for semantic search (default: `nomic-embed-text`) |
| `enableSecurityTools` | Enable security tools (nmap, Ghidra, Nuclei) in agent |

## Security Tooling

Kovix integrates professional security tools directly into the agent loop. Every security tool has a **safety gate** -- the agent must receive explicit user confirmation before execution.

### nmap_scan -- Network Scanner

Target scanning with XML output parsing. The agent can scan hosts, detect open ports, and identify running services.

```
User: Scan 192.168.1.100 for open ports
Agent: I'd like to run nmap to scan that target. Approve? [Yes/No]
-> Parses XML output, summarizes open ports and services
```

Requires: `nmap` installed on the system (`sudo apt-get install nmap` / `brew install nmap`)

### ghidra_decompile -- Binary Decompilation

Binary decompilation via Docker headless Ghidra. Upload a binary and get decompiled C-like source code.

```
User: Decompile the function at 0x00401000 in malware.exe
Agent: Running Ghidra headless decompilation. Approve? [Yes/No]
-> Returns decompiled pseudocode from the specified address
```

Requires: Docker + `ghidra-headless` image (`docker pull ghidra-headless`)

### nuclei_scan -- Vulnerability Scanner

Template-based vulnerability scanning with severity filtering and JSON output parsing.

```
User: Scan https://example.com for CVEs
Agent: Running Nuclei vulnerability scan. Approve? [Yes/No]
-> Parses JSON output, lists findings by severity (critical/high/medium/low)
```

Requires: `nuclei` installed (`go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`)

## MCP Servers

Kovix supports the **Model Context Protocol (MCP)**, allowing you to connect external tool servers that extend the agent's capabilities. MCP servers provide additional tools the agent can call during conversations.

### Configuration

MCP servers are configured via the `construct.mcp.servers` setting (array of objects):

```json
{
  "construct.mcp.servers": [
    {
      "name": "my-server",
      "command": "node",
      "args": ["path/to/mcp-server.js"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  ]
}
```

| Field | Description |
|---|---|
| `name` | Unique identifier for the MCP server (used in tool dispatch) |
| `command` | Executable to launch the server |
| `args` | Arguments passed to the command |
| `env` | Environment variables for the server process |

### Tool Dispatch Format

Tools from MCP servers are dispatched using the format: `mcpServerName__toolName`

For example, a server named `my-server` exposing a tool `query_database` would be invoked as `my-server__query_database`.

### Managing MCP Servers

- Add servers via Settings -- search `construct.mcp.servers`
- Restart Kovix after adding or removing servers
- The agent automatically discovers available MCP tools and includes them in its tool registry
- MCP tools respect the same safety blocklist as built-in tools

## Semantic Memory

Kovix indexes your entire workspace for semantic search, enabling the agent to retrieve relevant context without you having to specify file paths.

### How It Works

1. **Indexing** -- Run `Kovix: Index Workspace` (or it triggers automatically). Files are chunked and embedded using Ollama's `nomic-embed-text` model (or falls back to pseudo-embeddings).
2. **Storage** -- Embeddings are stored in a local Qdrant vector database running in-process. BM25 keyword indexing runs as a fallback.
3. **Retrieval** -- When you ask the agent a question, relevant code chunks are injected into the conversation context automatically.

### Commands

| Command | Description |
|---|---|
| `construct.indexWorkspace` | Build or rebuild the workspace index |
| `construct.openMemoryPanel` | View and manage indexed memories |
| `construct.searchMemories` | Search stored memories by query |
| `construct.addMemory` | Add a manual memory entry |

### Configuration

```json
{
  "embeddingModel": "nomic-embed-text",
  "ollamaEndpoint": "http://localhost:11434"
}
```

If Ollama is unavailable, the system falls back to BM25 keyword search -- no embeddings required.

## Internet Research

Kovix integrates **Agent Reach**, an internet research toolkit that gives the AI agent access to the entire web — no API keys required for most platforms. The agent can search YouTube, GitHub, Reddit, read documentation pages, and more, directly within conversations.

### What It Enables

- **Web research** — Read any public webpage or documentation and summarize it in-chat
- **Video discovery** — Search YouTube and pull transcripts for analysis
- **Code exploration** — Search GitHub for libraries, examples, and repositories
- **Community insights** — Search Reddit, Twitter/X, Bilibili, and Xiaohongshu for discussions and opinions
- **AI-powered search** — Semantic search via Exa for research questions where meaning matters more than keywords

### Installation

Agent Reach is available as an MCP server and can be installed via the setup wizard:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run `Construct: Open Setup Wizard`
3. Select **Agent Reach** from the integrations list and follow the prompts

Or configure it manually by adding the MCP server to your settings:

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

Then restart Kovix. The agent will automatically discover the new tools.

### Out-of-the-Box Channels

These channels work immediately with no authentication:

| Tool | Description |
|------|-------------|
| `agent_reach__read_webpage` | Read and extract clean text from any URL |
| `agent_reach__read_rss` | Fetch recent articles from RSS/Atom feeds |
| `agent_reach__search_youtube` | Search YouTube videos |
| `agent_reach__get_youtube_transcript` | Retrieve video transcripts |
| `agent_reach__search_github` | Search repositories, code, issues on GitHub |
| `agent_reach__search_bilibili` | Search Bilibili videos (Chinese content) |
| `agent_reach__search_exa` | AI-powered semantic web search |

### Channels Requiring Authentication

These platforms require cookie-based login due to anti-bot protections:

| Tool | Description | Setup |
|------|-------------|-------|
| `agent_reach__search_twitter` | Search tweets and trending topics | `agent-reach configure twitter-cookies "..."` |
| `agent_reach__search_reddit` | Search subreddits and discussions | `agent-reach configure reddit-cookies "..."` |
| `agent_reach__search_xiaohongshu` | Search lifestyle/review content | `agent-reach configure xiaohongshu-cookies "..."` |

### Cookie Security Notes

- Cookies are **stored locally** on your machine only — never sent to any remote server except the target platform
- Obtain cookies by logging into the platform in your browser, then copying them from the browser's developer tools (Application/Storage → Cookies)
- For Twitter/X: copy the `auth_token` cookie value
- For Reddit: copy the `reddit_session` cookie value
- For Xiaohongshu: copy the `web_session` cookie value
- Cookies expire — re-run the configure command when authentication fails

### Diagnostics

Run `agent_reach__doctor` at any time to check which channels are operational and which need setup. If a tool returns an error, the agent will automatically suggest running the doctor to diagnose the issue.

### Full Tool Reference

| Tool | Use When | Auth Required |
|------|----------|---------------|
| `agent_reach__read_webpage` | User asks about a specific URL or docs page | No |
| `agent_reach__read_rss` | User asks about news or blog feed updates | No |
| `agent_reach__search_youtube` | User wants video tutorials or YouTube content | No |
| `agent_reach__get_youtube_transcript` | User wants to summarize or search within a video | No |
| `agent_reach__search_github` | User wants libraries, repos, or code examples | No |
| `agent_reach__search_twitter` | User asks about tweets, trends, or X content | Yes (cookies) |
| `agent_reach__search_reddit` | User wants community opinions or troubleshooting | Sometimes |
| `agent_reach__search_bilibili` | User wants Chinese-language tutorials or content | No |
| `agent_reach__search_xiaohongshu` | User wants product reviews or lifestyle content | Yes (cookies) |
| `agent_reach__search_exa` | User asks broad research questions needing semantic search | No |
| `agent_reach__doctor` | Another Agent Reach tool fails or returns an error | No |

## Design Intelligence

Kovix integrates **UI-UX Pro Max**, an AI-powered design intelligence engine that helps the agent generate proper design systems. It provides 67 UI styles, 161 color palettes, 57 font pairings, 99 UX guidelines, and 25 chart types across 16+ tech stacks — all searchable via BM25 ranking.

### What It Enables

- **Design system generation** -- Describe your project ("SaaS dashboard", "e-commerce luxury store") and get a complete design system with colors, typography, layout patterns, and component specs
- **UI style search** -- Find the right visual style from 67 options (Minimalism, Glassmorphism, Brutalism, Aurora, Neumorphism, etc.)
- **Color palette discovery** -- Get pre-tuned palettes for any product category with full hex values and CSS variables
- **Typography pairing** -- Find curated heading/body font combinations with Google Fonts URLs
- **Framework-specific guidelines** -- Get stack-specific UI rules for React, Vue, Svelte, Next.js, Astro, SwiftUI, Flutter, and more

### Installation

UI-UX Pro Max is bundled with Kovix and installed automatically at `.kovix/skills/ui-ux-pro-max/`. The engine is a Python script that reads local CSV data files — no API keys or network access required.

### Available Tools

| Tool | Description | Use When |
|------|-------------|----------|
| `uiux_pro_max__search_style` | Search 67 UI styles by keyword | User asks about visual style, design direction |
| `uiux_pro_max__search_color` | Search 161 color palettes | User needs color scheme, palette, tokens |
| `uiux_pro_max__search_typography` | Search 57 font pairings | User needs fonts, type system |
| `uiux_pro_max__generate_design_system` | Generate complete design system | User is starting a new project or page |
| `uiux_pro_max__get_stack_guidelines` | Get framework-specific guidelines | User needs React/Vue/Svelte/etc. UI guidance |

### Command Palette Commands

All UI-UX Pro Max commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) under the **Construct: Design** category:

| Command | Description |
|---------|-------------|
| `construct.uiuxSearchStyle` | Search UI Styles |
| `construct.uiuxSearchColor` | Search Color Palettes |
| `construct.uiuxGenerateDesignSystem` | Generate Design System |
| `construct.uiuxStackGuidelines` | Get Stack Guidelines |

### Tech Stacks Supported

React, Next.js, Vue, Svelte, Astro, SwiftUI, React Native, Flutter, NuxtJS, Nuxt UI, HTML + Tailwind, shadcn/ui, Jetpack Compose, Three.js, Angular, Laravel

### Design System Output

When generating a design system, the engine produces:

- **Pattern**: Landing page structure, CTA placement, section order
- **Style**: UI style name, effects, performance rating, accessibility grade
- **Colors**: Full palette (primary, secondary, accent, background, foreground, muted, border, destructive, ring)
- **Typography**: Heading/body fonts, mood, Google Fonts URLs
- **Key Effects**: Animation and interaction recommendations
- **Anti-Patterns**: Design patterns to avoid
- **Pre-Delivery Checklist**: Accessibility and UX verification steps

---

## Behavioral Rules (Ponytail)

Kovix integrates **Ponytail**, a behavioral ruleset that makes the AI agent adopt a "lazy senior developer" mindset. Before writing any code, the agent climbs a decision ladder: YAGNI -> stdlib -> native platform -> installed deps -> one line -> minimum code.

### What It Enables

- **Lazy mode** -- The agent prefers deleting code over adding it, uses stdlib over new dependencies, and writes the minimum viable solution
- **Code review** -- On-demand review of any file or diff for over-engineering, with specific tags (`delete:`, `stdlib:`, `native:`, `yagni:`, `shrink:`)
- **Repo audit** -- Scan the entire codebase for bloat and unnecessary complexity
- **3 intensity levels**:
  - **Lite** -- Gentle reminders, soft nudges toward simplicity
  - **Full** (default) -- Strict rules, blocks unrequested abstractions and new dependencies
  - **Ultra** -- Maximum enforcement, every line must justify its existence
  - **Off** -- Rules disabled, agent operates normally

### How to Use

The agent reads the Ponytail ruleset automatically from `.kovix/skills/ponytail.md`. To change mode:

1. **Command Palette**: `Ctrl+Shift+P` -> "Construct: Set Ponytail Mode"
2. **Status bar**: Click the `[PONYTAIL]` badge to cycle modes
3. **Slash commands** (in agent chat):
   - `/ponytail` -- Show current mode and rules
   - `/ponytail-review` -- Review current file for over-engineering
   - `/ponytail-audit` -- Audit entire workspace for bloat
   - `/ponytail-help` -- Show quick reference

### Available Tools

| Tool | Description |
|------|-------------|
| `ponytail_set_mode` | Set lazy-dev intensity (lite/full/ultra/off) |
| `ponytail_review_code` | Review code for over-engineering |
| `ponytail_audit_repo` | Audit codebase for bloat |
| `ponytail_get_rules` | Get current ruleset for the mode |
| `ponytail_help` | Quick reference card |

---

## Architecture

Kovix is built on the [VS Code open-source project](https://github.com/microsoft/vscode) with the following additions:

- **VS Code fork** -- Full editor with all upstream features intact
- **`IKovixAIService`** -- Unified AI provider interface for Ollama, Xenova ONNX, and cloud backends
- **Agent loop** -- Plan/act cycle with built-in tools (read, write, run, search, memory) plus security tools and MCP extensions
- **MCP tool registry** -- Extensible tool execution engine with command safety blocklist; dispatches MCP tools via `serverName__toolName` format
- **Security tools** -- nmap_scan, ghidra_decompile, nuclei_scan with user-approval safety gates
- **Qdrant + BM25 memory** -- Hybrid retrieval: vector embeddings with keyword fallback

```
┌──────────────────────────────────────────────────────────┐
│                        Kovix                             │
├───────────┬───────────┬───────────┬──────────────────────┤
│  Editor   │  Agent    │ Terminal   │  Memory Panel       │
│ (VS Code  │  Panel    │ (Kali/    │  (Qdrant/BM25)      │
│  fork)    │           │  WSL2)    │                     │
├───────────┴───────────┴───────────┴──────────────────────┤
│                  IKovixAIService                         │
├───────────┬───────────┬─────────────────────────────────┤
│  Ollama   │  Xenova   │   Cloud API (Anthropic)         │
│  Provider │  Provider │   Provider                      │
├───────────┴───────────┴─────────────────────────────────┤
│          Tool Registry (Built-in + MCP + Security)       │
├────────────┬──────────────┬─────────────────────────────┤
│ Agent      │ Security     │  MCP Server Tools           │
│ Tools      │ Tools        │                             │
│ read/write │ nmap_scan/   │  server__tool               │
│ run/search │ ghidra/      │  (user-configured)          │
│ memory     │ nuclei_scan  │                             │
├────────────┴──────────────┴─────────────────────────────┤
│             Semantic Memory (Qdrant + BM25)              │
│             nomic-embed-text embeddings                  │
└──────────────────────────────────────────────────────────┘
```

## License

This project is licensed under a Proprietary license. See [LICENSE.txt](./LICENSE.txt) for details.

Kovix is a fork of [Code-OSS](https://github.com/microsoft/vscode) by Microsoft, used under the MIT License.
