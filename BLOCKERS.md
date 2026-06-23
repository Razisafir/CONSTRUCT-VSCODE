# BLOCKERS — Kovix Grand Redesign

Items that block progress on `feature/grand-redesign` and need user input or
environmental changes to resolve. Items are added when discovered; they are
NOT removed inline — they're resolved in a separate commit when fixed.

---

## BLOCK-001 — Desktop boot verification cannot run in this environment (Phase 6)

**Discovered:** Phase 6 attempt, 2026-06-22.

**Symptom:** Phase 6 of `KOVIX_GRAND_LAUNCH_PROMPT.md` requires launching the
built Kovix app on a real desktop machine with a GUI and running a real agent
task end-to-end. The current build/CI environment is a headless Linux container
with no display server, no GPU, and no way to launch an Electron app.

**Impact:** Phase 6's "deliberate-failure test produces a real
`VerificationFailed` state" check cannot be verified by command output in this
environment. The code path is implemented (see `runVerification()` in
`agentLoop.ts`) but the end-to-end UI flow has not been observed.

**Resolution required from user:**
1. Pull `feature/grand-redesign` onto a desktop machine (Windows or macOS).
2. Follow `PACKAGING.md` to build and launch the app.
3. Run a real agent task that should pass verification (e.g. "add a unit test
   to a small project that already has `npm test` configured").
4. Run a deliberately-failing task (e.g. "delete the existing test file" — the
   verification harness should catch this and route to error recovery).
5. Confirm the Verifying chip appears in the progress panel during step 3 and
   that the VerificationFailed state appears during step 4.

**Workaround in code:** The verification harness itself
(`runVerification()` + `detectVerificationCommand()` in `agentLoop.ts`) is
fully implemented and unit-testable. The UI surfaces (Phase 3.1) are
implemented in `constructProgressPanel.ts` but their live behavior cannot be
confirmed without a desktop.

---

## BLOCK-002 — Full `npm run compile` + `npm test` gate not yet run (Phase 1 + Phase 5 gates)

**Discovered:** Phase 1 gate attempt, 2026-06-22.

**Symptom:** The Phase 1 hard gate requires `npm run compile` and
`npx tsc --noEmit` to both show 0 errors, with output pasted into the commit
message. The Phase 5 hard gate additionally requires `npm test`.

`npm install` was attempted in the build environment and FAILED with:
```
npm error Package 'xkbfile', required by 'virtual:world', not found.
npm error gyp ERR! cwd /home/z/my-project/kovix-work/node_modules/native-keymap
npm error gyp ERR! command "/usr/bin/node" ".../node-gyp/bin/node-gyp.js" "rebuild"
npm error gyp ERR! not ok
```
`native-keymap` (a VS Code dependency) requires the system library `libxkbfile-dev`
(+ `libx11-dev`, `libxkbcommon-dev`) which is not installable in this sandbox
without root apt access. Without `node_modules/` fully populated, neither
`npm run compile` nor `npx tsc --noEmit` can run.

**Mitigation applied:** Installed standalone TypeScript 5.6.2 in
`/home/z/my-project/tsc-bin/` (outside the project tree, with `--ignore-scripts`
to skip native module rebuilds). Ran parse-only syntax checks
(`--noResolve --skipLibCheck`) against all 6 modified files. Result:

```
✓ src/vs/platform/construct/common/agent/milestoneStateMachine.ts — clean
✓ src/vs/platform/construct/common/agent/agentLoop.ts — clean
✓ src/vs/platform/construct/common/recovery/agentErrorRecovery.ts — clean
✓ src/vs/workbench/contrib/construct/browser/services/recovery/agentErrorRecovery.ts — clean
✓ src/vs/workbench/contrib/construct/browser/kovixAutonomousConfig.ts — clean
✓ src/vs/workbench/contrib/construct/browser/services/agent/agentLoop.ts — edited regions clean
  (pre-existing _register/decorator errors at lines 182-221 are --noResolve
   artifacts from missing Disposable base class, NOT from my changes — they
   appear in unedited code)
```

**Impact:** Phase 1's code changes parse cleanly with TypeScript 5.6.2. They
are additive (new enum members, type union extension, new async generator
method, one new helper, one new config setting) and TypeScript-compatible by
construction. The full project compile gate is NOT yet run — must be done
locally before merge.

**Resolution required from user:**
1. On a Linux desktop with `apt install -y libxkbfile-dev libx11-dev libxkbcommon-dev`:
   ```bash
   cd /path/to/kovix-work
   git checkout feature/grand-redesign
   npm install                           # 10-15 min
   npm run compile 2>&1 | tail -30       # 5-10 min, must show 0 errors
   npx tsc --noEmit 2>&1 | tail -30      # 5-10 min, must show 0 errors
   ```
2. On Windows/macOS, the equivalent system libs are bundled with VS Code's
   build toolchain — see `BUILD.md` for platform-specific prerequisites.
3. If errors appear in the edited regions (lines 649-690 or 1021-1121 of
   `src/vs/workbench/contrib/construct/browser/services/agent/agentLoop.ts`,
   or any line of the other 5 files), paste them back and the fixes will be
   applied before merge.

**Iron Law acknowledgement:** This block entry itself follows the rule — the
gate is reported as 'parse-clean but full-compile not yet run' rather than
'passing' because the verification command has not been executed in this turn.

---

## BLOCK-002-RESOLVED — `npm run compile` + `npx tsc --noEmit` now PASS (2026-06-24)

**Discovered:** Re-attempt in `fix/agent-functional-recovery` branch, 2026-06-24.

**Symptom:** The original BLOCK-002 was based on `npm install` failing in a
prior session due to `libxkbfile-dev` not being installable without root apt.
That blocker still holds for **native module compilation** (e.g. `native-keymap`,
`keytar`, `node-pty` will not build without `-dev` system headers).

**Mitigation applied in this session:**
1. `npm install --ignore-scripts --no-audit --no-fund` succeeded in 19s —
   1504 packages installed at the root.
2. Each extension with its own `package.json` was then `npm install`-ed
   individually (extensions/markdown-language-features, /simple-browser,
   /css-language-features/server, /html-language-features/server,
   /json-language-features/server, .vscode/extensions/vscode-selfhost-test-provider,
   vscode-selfhost-import-aid). Total ~30s parallel.
3. `npx tsc --noEmit -p src/tsconfig.json` with
   `NODE_OPTIONS=--max-old-space-size=8192` → **0 errors** across the entire
   `src/` tree, including all renamed `construct.*` → `kovix.*` identifiers
   and the new `KovixSettingsMigrationContribution`.
4. `node ./node_modules/gulp/bin/gulp.js compile` (the project's actual
   `npm run compile` script) with `NODE_OPTIONS=--max-old-space-size=8192`
   → **0 errors**, finished in 2.05 minutes. Both `compilation extensions`
   (30s) and `compilation` core (95s) report `0 errors`.

**What still cannot run in this sandbox (escalate to Razi's desktop):**
- Native module rebuilds (libxkbfile-dev / libx11-dev / libxkbcommon-dev).
  This means `npm install` (without `--ignore-scripts`) will fail, and the
  packaged Electron app cannot be launched.
- Phase 3.2 (package + launch) and Phase 3.3 (click the panel, type a
  message, verify the agent responds, run a task that triggers the
  `Verifying` state). These need a real display.
- The user-provided NVIDIA NIM key (`nvapi-...`) cannot be used from this
  sandbox — it must be configured in the running app on a desktop.

**Iron Law adherence:** The compile-gate claim in this entry is backed by
real command output. Logs:
- `/tmp/tsc-output-4.log` — 0 errors (excluding 6 npm-warn lines about
  unknown .npmrc config keys, which are unrelated noise).
- `/tmp/compile-final.log` — 0 errors, 191 lines, last line:
  `[17:07:29] Finished 'compile' after 2.05 min`.

---

## BLOCK-004 — Stale setting names in `.github/workflows/kovix-build-test.yml`

**Discovered:** Phase 1.3 rename pass, 2026-06-24.

**Symptom:** The workflow at `.github/workflows/kovix-build-test.yml` writes
a settings.json for the test run with these keys:
- `construct.llm.provider` → renamed to `kovix.api.activeProvider` in this PR
- `construct.llm.apiKey` → renamed to `kovix.cloud.apiKey`
- `construct.llm.model` → renamed to `kovix.cloud.model`
- `construct.memory.embeddingProvider` → no equivalent — the actual code
  uses `kovix.embedding` (a single string, not a separate provider/model
  pair). This is a stale setting name from a prior API design.
- `construct.memory.embeddingModel` → no equivalent
- `construct.memory.vectorStore` → no equivalent (the code uses
  `kovix.memory.enabled` boolean + Qdrant auto-detection)
- `construct.safety.confirmDestructive` → no equivalent — the actual code
  uses `kovix.security.allowExternalTargets` (different semantics, but
  closest match for the test's intent).

This PR renamed the prefix `construct.` → `kovix.` (per Phase 1.3) and
mapped the closest equivalents, but the underlying setting names in the
workflow DO NOT match what the actual code registers. The test workflow
would silently write settings that the code ignores.

**Impact:** The kovix-build-test.yml workflow (if it runs) would not
actually configure the agent correctly — settings would be no-ops.

**Resolution required from user:** Audit the workflow's settings.json
against `src/vs/workbench/contrib/construct/browser/constructApiConfig.ts`
and `constructMemoryConfig.ts` (the actual configuration registration
files). Update the workflow to use setting names that match what the code
registers. This is out of scope for the 24-hour recovery window.

---

## BLOCK-005 — Conflicting design-system docs (green vs teal)

**Discovered:** Phase 0.3 branding state audit, 2026-06-24.

**Symptom:** Two design-system documents exist in the repo with
**contradictory** accent color prescriptions:
- `KOVIX_DESIGN_SYSTEM_FOUNDATION.md` (dated 2026-06-20, current) —
  prescribes teal `#14B8A6` accent on blue-black `#0B1115` background.
  This is what the v1.7.0/v1.7.1 "teal identity" release actually shipped.
- `design-system/kovix/MASTER.md` (older, undated) — prescribes green
  `#22C55E` accent on `#0F172A` background. This is the pre-teal direction
  that was superseded by commit `e4d2ca60 [design-system] Phase A: replace
  Volt-violet foundation with teal identity`.

**Impact:** A future agent or contributor reading `design-system/kovix/MASTER.md`
would build against the wrong color palette. The file's metadata says
"Generated: 2026-06-20 09:33:38" — same date as the teal foundation doc —
which makes it look authoritative when it isn't.

**Resolution required from user:** Either delete `design-system/kovix/MASTER.md`
entirely, or add a "SUPERSEDED — see KOVIX_DESIGN_SYSTEM_FOUNDATION.md"
banner at the top. Not in scope for the 24-hour recovery window since
deleting docs is a one-way decision the user should make.

---

## BLOCK-003 — `gitleaks` scan not run (Phase 2 gate)

**Discovered:** Phase 2 attempt, 2026-06-22.

**Symptom:** Phase 2's gate requires `npx gitleaks detect --source . --no-git -v`
to actually run with output pasted. The build environment has limited network
access for `npx` package installation and `gitleaks` is a Go binary that may
not be installable via `npx` in this sandbox.

**Impact:** Secret-scanning verification of the repo is incomplete. The
existing `secretRedactor.ts` / `PromptSanitiser` / `workspaceGuard.ts` defenses
remain in place, but no fresh scan has confirmed no new secrets leaked.

**Resolution required from user:** Run the gitleaks scan locally:
```bash
npx gitleaks detect --source . --no-git -v 2>&1 | tail -60
```
If findings appear, paste them and they'll be triaged into `SECURITY_AUDIT.md`.
