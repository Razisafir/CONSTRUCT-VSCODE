# PHASE 0 COMPREHENSION NOTES — internal scratch, not a deliverable

> Written after reading: README.md, AGENTS.md, KOVIX_DESIGN_SYSTEM_FOUNDATION.md,
> branding/README.md, design-system/kovix/MASTER.md, product.json, git log -100,
> git branch -a, the two recovery branches' diffs, construct.contribution.ts,
> src/vs/platform/construct/common/agent/{agentLoop,milestoneStateMachine}.ts,
> src/vs/platform/construct/common/recovery/agentErrorRecovery.ts,
> src/vs/workbench/browser/media/kovix-logos.svg, and inspecting every icon file
> under resources/{win32,darwin,linux,server}/.

## 0.1 — History doc reconciliation

**Docs the prompt expected but DO NOT exist:**
- `BLOCKERS.md` — missing
- `STUBS.md` — missing
- `SECURITY_AUDIT.md` — missing (SECURITY.md exists but is just a security policy template, not an audit)
- `KOVIX_BRAND_AND_UI_GRAND_PROMPT.md` — missing

**Docs that DO exist and are load-bearing:**
- `README.md` — current v1.7.1, describes the agent panel, providers, modes, commands (note: README itself uses `construct.*` IDs throughout — example: `construct.manageApiKeys`)
- `KOVIX_DESIGN_SYSTEM_FOUNDATION.md` — dated 2026-06-20, the **current authoritative** brand spec: teal `#14B8A6` accent on blue-black `#0B1115` background, Inter + JetBrains Mono typography
- `design-system/kovix/MASTER.md` — **STALE / CONFLICTING** — prescribes green `#22C55E` accent (older pre-teal direction). Should be ignored or deleted. Real teal work was done in commits e4d2ca60 → dca477ac → 6473c735 → 542dfda3 → f3820d83 → b0ad32c2 → 890de6da → 315fafaf (the design-system Phase A→F sequence).
- `AGENTS.md` — misleadingly named; contains the Ponytail prompt, not agent architecture docs
- `branding/README.md` — documents the icon replacement process (copy kovix.ico → resources/win32/{kovix,code}.ico, etc.) but the `branding/` directory itself is empty

## 0.2 — Agent request lifecycle (confirmed by reading code, not running it)

**The chain, end to end:**

1. **Panel mount.** `workbench.common.main.ts` imports `construct.contribution.ts` (confirmed registered). The contribution registers a view container (AuxiliaryBarLocation.RIGHT) and 5 views: `construct.agentPanel`, `construct.memoryPanel`, `construct.memoryGraph`, `construct.controlCenter`, `construct.agentSettings`. The pane classes are `ConstructAgentViewPane` (2017 lines), `ConstructMemoryViewPane`, `KovixMemoryGraphPane`, `KovixAgentControlCenter`, `KovixAgentSettingPane`.

2. **User input.** User types in the agent panel composer (`Ctrl+Enter` to send). `constructAgentView.ts` captures the input and calls `IAgentLoop` (service ID `'construct.agentLoop'`, decorator `IAgentLoop`).

3. **Planning phase.** `IAgentLoop.runPlanningPhase(task)` runs first with read-only tools only. Returns `IPlanResult` with `IPlanStep[]` (each step is `Read|Create|Edit|Run` + target + description). Plan is shown to the user for approval.

4. **Approval.** User picks execution mode + which milestones to pause at → `IApprovedPlan`. Calls `IAgentLoop.runWithApprovedPlan(approvedPlan)`.

5. **Execution loop.** In `AgentLoopService` (browser, 1129 lines):
   - Build system prompt (with memory context injected, engineering discipline, ponytail)
   - Call LLM via `IConstructAIService` (auto-selects provider: Ollama | Xenova | Cloud, with per-mode override)
   - Parse response for `tool_use` blocks
   - For each tool call: dispatch via `IConstructToolRegistryService` (1897 lines, ~29 tools + MCP-discovered + security tools)
   - Feed tool result back into the next LLM call
   - Loop until LLM returns `end_turn` or max 15 rounds
   - Emit `AgentLoopEvent` stream throughout (thinking | token | tool_start | tool_executing | tool_result | file_written | milestone_* | complete | error)

6. **Milestones.** `milestoneStateMachine.ts` defines `ExecutionState`: Idle | Planning | AwaitingApproval | Executing | PausedAtMilestone | Complete | Error. The loop extracts milestones from plan steps and pauses at the user-selected ones.

7. **Error recovery.** When a tool fails, `IAgentErrorRecovery` (`'construct.agentErrorRecovery'`) classifies the error (`non_zero_exit | file_permission | file_not_found | syntax_error | network_error | timeout | unknown`), retries up to 3x with error context injected into the next LLM call, then escalates to user with retry/skip/edit/abort options.

8. **UI updates.** `constructAgentView.ts` subscribes to the `AgentLoopEvent` stream and renders. File changes flow through `onFileChange` for the real-time file-tree diff in `constructProgressPanel.ts`.

**The broken link the prompt warned about — FOUND:**

The platform `IAgentLoop` interface documents this flow:
> 6. Stop when LLM returns end_turn or max rounds (15) reached

…with NO verification step between "LLM says end_turn" and "Complete". This means the agent can self-declare "done" without any harness check that the code actually works. This is the **verification gap** the prompt's Phase 0.1 #6 mentions.

The `recovery/grand-redesign-v1` branch's `phase(1)` commit (d554d14d) closes this gap by:
- Adding `Verifying` + `VerificationFailed` to `ExecutionState`
- Adding `verification_start` + `verification_result` events
- Inserting a `runVerification()` harness between "LLM says done" and "Complete" that runs `npm test` > `npm run build` > `npm run typecheck` > `npx tsc --noEmit` (or marks "unverified" if none exist), with a 2-minute timeout
- Routing failures through `AgentErrorRecoveryService` as a new `verification_failed` error type
- Updating the system prompt with "Iron Law: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE" + a Common Failures table + Karpathy four principles + Ponytail discipline

This is real, well-engineered work. **It should be cherry-picked, not redone.**

## 0.3 — Branding state (confirmed)

**product.json — fully renamed already:**
- `nameShort: "Kovix"`, `nameLong: "Kovix IDE"`, `applicationName: "kovix"` ✓
- `dataFolderName: ".kovix"` ✓
- `linuxIconName: "kovix"` ✓
- `darwinBundleIdentifier: "ai.kovix.ide"` ✓
- `win32AppUserModelId: "Kovix.IDE"` ✓
- `urlProtocol: "kovix"` ✓
- `win32MutexName: "kovixide"`, `win32DirName: "Kovix"`, `win32RegValueName: "KovixIDE"` ✓
- `serverApplicationName: "kovix-server"`, `tunnelApplicationName: "kovix-tunnel"` ✓
- **MISSING from product.json**: no `win32Icon` / `darwinIcon` / `linuxIcon` path entries. But: VS Code's build actually wires platform icons via `build/gulpfile.vscode.{win32,darwin,linux}.js` (resources/* paths), not product.json. So this is NOT a bug — the prompt's premise was wrong.

**Icon files — exist but WRONG/INCOMPLETE:**

| File | Size on disk | Actual dimensions | Verdict |
|---|---|---|---|
| `resources/win32/kovix.ico` | 90,909 B | MS icon: 16x16 + 32x32 only (2 sizes!) | Insufficient — Windows taskbar shows 256x256; this will be blurry |
| `resources/win32/kovix_150x150.png` | 395 B | 150x150, 2-bit colormap (4 colors) | Garbage placeholder |
| `resources/win32/kovix_70x70.png` | 338 B | 70x70, 8-bit RGBA | OK but tiny |
| `resources/win32/code.ico` | **MISSING** | — | Build expects this alias; will fail or fall back to default |
| `resources/darwin/kovix.icns` | 189,124 B | "ic12" type only (32x32@2x = 64x64) | Missing ic07/08/09/10/11/13/14 (16/32/128/256/512/1024) |
| `resources/darwin/code.icns` | (not checked) | — | Likely also missing alias |
| `resources/linux/kovix.png` | 2,721 B | 1024x1024, 4-bit colormap (16 colors) | Looks terrible — 16 colors for a teal gradient |
| `resources/linux/code.png` | (not checked) | — | Likely missing alias |
| `resources/server/kovix-192.png` | 2,721 B | (suspect same 4-bit issue) | Probably low quality |
| `resources/server/kovix-512.png` | 87,703 B | (likely OK) | Probably OK |

**Source SVG:**
- `src/vs/workbench/browser/media/kovix-logos.svg` (4614 B) is a **real, well-designed** source asset: a squared slab-cut "K" on a teal gradient tile, with `<symbol>` definitions for sizes 16/24/48/128/192. Note: the gradient ID is still `kovix-volt-gradient` (legacy name from the Volt-violet era) but the actual stops are teal `#2DD4BF → #14B8A6 → #0F766E`.

**Branding directory:**
- `branding/` contains only `README.md` — no actual source icons. The README documents a manual copy process that nobody has executed.

**Naming split — confirmed real and large:**
- 50+ `construct.*` command IDs registered in `construct.contribution.ts` alone (full inventory pending Phase 1.1 grep)
- Platform service IDs use `construct.*` prefix: `construct.agentLoop`, `construct.agentErrorRecovery`
- README.md uses `construct.*` throughout in its commands/settings tables
- ~220 `construct.*` occurrences vs ~43 `kovix.*` in browser contribution files (per the prompt's prior count — Phase 1.1 will produce the authoritative count)

## 0.4 — Branches (Phase 0.1 #6 — confirmed)

Both branches the prompt flagged DO exist on origin:

- `origin/fix/cherry-pick-verification-gate` (4 commits on top of v1.7.1):
  - `ed63f1a9 phase(1): close verification gap in agent loop`
  - `381b599a phase(2,3,4): security audit + Verifying UI + engineering skill port`
  - `7f42f0a6 phase(5): quality pass — MCP timeout verified, innerHTML safe, PRs triaged`
  - `b926ef9b fix: restore tab indentation in 3 files converted to spaces by recovery commits`

- `origin/recovery/grand-redesign-v1` (3 commits on top of v1.7.0):
  - `d554d14d phase(1): close verification gap in agent loop`
  - `741292fd phase(2,3,4): security audit + Verifying UI + engineering skill port`
  - `47dc7914 phase(5): quality pass — MCP timeout verified, innerHTML safe, PRs triaged`

The two branches contain the **same conceptual work** but based on different parents (v1.7.0 vs v1.7.1) and with different commit hashes. `fix/cherry-pick-verification-gate` is the newer base (v1.7.1) and also has a tab-indentation fixup commit on top. **This is the branch to cherry-pick from.**

## 0.5 — Sandbox constraints (declared up front, per Phase 3.1)

This environment is a headless Linux sandbox. The Phase 3 gates that depend on:
- A real display (X server / GPU) — **NOT AVAILABLE**. Cannot launch the packaged Electron app, cannot click the agent panel icon, cannot visually verify icons render.
- Native module compilation (`libxkbfile-dev`, Electron headers from `electronjs.org`) — **LIKELY BLOCKED**. Prior sessions hit this; npm install on a VS Code fork is famously slow and frequently fails on sandboxed networks.
- An LLM API key configured in the running app — the user provided an NVIDIA NIM key (`nvapi-...`), but **I cannot use it from inside the sandbox** because I cannot launch the app. It will be noted in the PR description for Razi to use when running Phase 3 on his desktop.

**What I CAN do in this sandbox:**
- All of Phase 0 (done), Phase 1 (rename + migration), Phase 2 (regenerate icons from SVG using librsvg2/imagemagick if available), and the static portions of Phase 3 (`npm install`, `npm run compile`, `npx tsc --noEmit`) — modulo native module blockers.
- Push to a clearly-named `fix/agent-functional-recovery` branch and open a PR with an honest status section per Phase 5's requirements.

**What Razi must do on his desktop to close the loop:**
- Phase 3.2 (package + launch) and Phase 3.3 (click the panel, type a message, verify the agent responds and executes a real tool call, run a task that triggers the Verifying state).
- The PR description will name these as the unverified-in-sandbox items.
