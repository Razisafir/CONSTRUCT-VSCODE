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
