# How to Cut a Kovix Release

This document describes how to ship a new Kovix release using the GitHub Actions pipeline defined in [`.github/workflows/release.yml`](./.github/workflows/release.yml).

## 0. Prerequisites

- Push access to `Razisafir/KOVIX` on `main`.
- A clean working tree (`git status` shows nothing to commit).
- All planned changes for the release have been merged into `main` and verified locally with `npm run compile`.

## 1. Bump the version

The version lives in three places and **all three must match** before tagging:

| File | Field |
|---|---|
| `package.json` | `"version": "1.6.0"` |
| `package-lock.json` | top-level `"version"` AND `packages[""].version` |
| `README.md` | version badge + footer "Download Kovix vX.Y.Z" |

Also append a `## vX.Y.Z — <title>` entry to the top of [`CHANGELOG.md`](./CHANGELOG.md) describing what changed. See the existing v1.5.x / v1.6.0 entries for the format.

## 2. Commit & tag

```bash
git add package.json package-lock.json README.md CHANGELOG.md
git commit -m "release: v1.6.0 — <short title>"
git tag -a v1.6.0 -m "Kovix v1.6.0 — <short title>"
git push origin main
git push origin v1.6.0
```

The `git push origin v1.6.0` is what triggers the release workflow — `release.yml` filters on `tags: ['v*']`.

> If you do not want to push `main` yet (e.g., the version bump is the only change and you want it on the tag only), you can push the tag alone — but that leaves `main` behind. The convention is to push both in the same session.

## 3. Watch the build

Open the Actions tab: <https://github.com/Razisafir/KOVIX/actions>

You will see the **Release Build** workflow run with three parallel jobs:

| Job | Runner | Output artifact(s) |
|---|---|---|
| `build-windows` | `windows-2022` | `KovixSetup-x64-v1.6.0.exe` + `checksums-sha256.txt` |
| `build-macos` | `macos-latest` | `kovix-darwin-x64.zip` + `checksums-sha256.txt` |
| `build-linux` | `ubuntu-latest` | `kovix_1.6.0_amd64.deb`, `kovix-1.6.0.x86_64.rpm`, `kovix-1.6.0.tar.gz` + `checksums-sha256.txt` |

Each job has `timeout-minutes: 120`. A clean run completes in ~25–40 minutes depending on runner load. If any job fails, the `create-release` job is skipped — fix the issue, bump the patch version (`v1.6.0 → v1.6.1`), re-tag, and re-push.

## 4. The release appears automatically

The `create-release` job (which only runs on tag pushes) downloads all three platform artifacts, flattens them into a single `out/` directory, generates a unified `checksums.txt`, and creates the GitHub Release via `softprops/action-gh-release@v2` using the tag name as the release title.

Find it at: <https://github.com/Razisafir/KOVIX/releases>

The release body is templated in `release.yml` (search for `body: |`) — edit that template in the workflow file if you want to change what appears in the release notes. The changelog link points at `CHANGELOG.md` on `main`.

## 5. Verify

Before announcing:

1. Download each artifact on a clean machine.
2. Run `sha256sum -c checksums.txt --ignore-missing` against the downloaded files.
3. Install on each platform (Windows, macOS, Linux) and smoke-test:
   - App launches without immediate crash
   - `Ctrl+Shift+K` opens the Kovix Agent panel
   - Settings → API keys can be entered and persisted
   - A simple chat message ("hello") returns a response from the configured provider

## 6. Announce

Share the GitHub Releases page with users. The changelog entry from step 1 is the canonical "what's new" reference — point release announcements at it rather than copy-pasting.

## Releasing from a branch (rare)

If you need to ship a hotfix off a non-`main` branch:

1. Cherry-pick the fix onto `main` first if possible — releases off branches are discouraged.
2. If you must: tag from the branch (`git tag -a v1.6.1 <branch-sha> -m ...`), push the tag. The `release.yml` `on.push.tags` trigger fires regardless of which branch the tag points at.
3. Note in the changelog that the release was cut from a branch and why.

## Manual workflow dispatch (no tag)

If you want a one-off build without creating a release (e.g., to test a CI change), use the "Run workflow" button on <https://github.com/Razisafir/KOVIX/actions/workflows/release.yml> with `workflow_dispatch`. The `create-release` job is gated on `if: startsWith(github.ref, 'refs/tags/')` so no release will be published — only the artifact ZIPs will be uploaded to the Actions run.

## See also

- [`CHANGELOG.md`](./CHANGELOG.md) — what changed in each release
- [`PACKAGING.md`](./PACKAGING.md) — local packaging commands (DEB / RPM / Snap / DMG / EXE)
- [`BUILD.md`](./BUILD.md) — local build instructions
- [`.github/workflows/release.yml`](./.github/workflows/release.yml) — the actual workflow definition

---

# Extended Pre-Launch Checklist (Phase 4.2)

Merged from `skills/shipping-and-launch/SKILL.md` (addyosmani/agent-skills).
This extends — does not replace — the basic verify steps in section 5 above.
Every item must have evidence (command output, screenshot, or link) — not a
blanket "looks good."

## A. Code Quality

- [ ] `npm run compile` shows 0 errors (paste tail in release notes)
- [ ] `npx tsc --noEmit` shows 0 errors (paste tail in release notes)
- [ ] `npm test` passes (paste tail in release notes)
- [ ] Lint passes: `npm run eslint` shows 0 errors
- [ ] Code reviewed and approved (link to PR)
- [ ] No `TODO` / `FIXME` comments that should be resolved before launch
      (`git grep -nE "TODO|FIXME" -- src/ | wc -l` — count should not have
      grown since the last release unless each new item is intentional)
- [ ] No `console.log` debugging statements in production code
      (`git grep -nE "console\.(log|debug)" -- src/vs/workbench/contrib/construct/`)
- [ ] Error handling covers expected failure modes (verification harness,
      recovery service, MCP timeout all tested)

## B. Security

- [ ] `gitleaks detect --source . -v` runs clean (or all findings are
      triaged in `SECURITY_AUDIT.md`)
- [ ] No secrets in code or version control (re-run gitleaks before tag)
- [ ] `npm audit --audit-level=high` shows no high/critical vulnerabilities
      (paste output; if any, link to the triage decision)
- [ ] Input validation on all user-facing entry points (chat input,
      onboarding wizard, API key entry, MCP server URL entry)
- [ ] Authentication and authorization checks in place (API key storage
      uses `secureKeyManager.ts` / `ISecretStorageService`, not plaintext)
- [ ] CSP headers configured for webviews (check `constructWebviewService.ts`)
- [ ] Rate limiting on terminal executor (already enforced — 10 commands /
      30 seconds — confirm via `terminalExecutor.ts` rate-limit check)
- [ ] CORS configured to specific origins (not wildcard) for any HTTP
      endpoints the agent might call
- [ ] `PromptSanitiser` + `secretRedactor` + `workspaceGuard` all active
      (cross-checked annually against `skills/security-audit-extended/`)

## C. Performance

- [ ] Agent loop max rounds cap in place (default 50 — see
      `construct.autonomous.maxRounds` setting)
- [ ] No N+1 queries in critical paths (memory store, skill registry, MCP
      marketplace all use batched reads where applicable)
- [ ] Bundle size within budget (`du -sh out/` after compile — should be
      comparable to previous release ±10%)
- [ ] File watcher doesn't pin CPU at 100% during agent execution
      (manual smoke test — start a long task, watch `top`)
- [ ] Memory store queries have appropriate indexes (check
      `constructMemoryService.ts` for any new queries added since last release)
- [ ] Caching configured for static assets and repeated queries (skill
      registry context caching is on by default)

## D. Accessibility

- [ ] Keyboard navigation works for all interactive elements in the agent
      panel (Tab through send box, stop button, plan-approval checkboxes,
      milestone pause/resume)
- [ ] Screen reader can convey agent state changes (ARIA live regions on
      status bar + message container — see `kovixAccessibilityConfig.ts`)
- [ ] Color contrast meets WCAG 2.1 AA (4.5:1 for text) — verify with
      browser devtools against the teal palette
- [ ] Focus management correct for modals (plan approval, milestone pause,
      error recovery quick-pick)
- [ ] Error messages are descriptive and associated with their source
      (verification failures show the actual command output, not just
      "verification failed")
- [ ] No accessibility warnings in axe-core (run against the running app
      via browser devtools — Kovix's workbench is native DOM, not webview,
      so this applies to the agent panel specifically)

## E. Infrastructure

- [ ] `package.json` version matches `package-lock.json` version matches
      `README.md` version badge (use `scripts/v1_7_0_bump.py` style surgical
      bumper to preserve tab indentation)
- [ ] `CHANGELOG.md` has a new entry at the top with the version, date,
      and summary of changes
- [ ] GitHub Actions release workflow (`release.yml`) triggers successfully
      on tag push (watch the Actions tab — all 3 build jobs must pass
      before `create-release` runs)
- [ ] GitHub Release page has all expected assets (system installer, user
      installer, portable zip, macOS zip, .deb, checksums.txt, checksums-sha256.txt)
- [ ] SHA256 of each downloaded asset matches the value in `checksums.txt`
- [ ] Health check: install on a clean VM, app launches without immediate
      crash, `Ctrl+Shift+K` opens the agent panel

## F. Documentation

- [ ] `README.md` updated with any new setup requirements (new settings,
      new dependencies, new keyboard shortcuts)
- [ ] `CHANGELOG.md` updated (this is the canonical "what's new" reference)
- [ ] `RELEASE_INSTRUCTIONS.md` itself is current (this file — review
      annually)
- [ ] `BLOCKERS.md` and `STUBS.md` updated with any new items discovered
      during the release process
- [ ] `SECURITY_AUDIT.md` re-run for this release (gitleaks + the cross-
      check table in section SEC-4)
- [ ] User-facing documentation updated (if applicable — new features
      documented in README or a dedicated docs/ entry)

## G. Rollback Plan (required for every release)

Document this in the release notes or a linked GitHub issue:

### Trigger Conditions
- App crashes on launch for >5% of users within 24 hours
- Agent loop hangs indefinitely on common tasks
- Security vulnerability discovered in shipped code

### Rollback Steps
1. Mark the release as a pre-release on GitHub (uncheck "Latest release")
2. Re-publish the previous release as "Latest" (or just point users at the
   previous release's assets)
3. If the bad version was installed via auto-update, ship a hotfix
   release with the fix + a higher version number
4. Communicate: post a GitHub issue explaining what broke, link to the fix

### Time to Rollback
- Mark-as-pre-release: < 1 minute
- Re-publish previous: < 5 minutes
- Hotfix release (with full CI build): ~1-2 hours (see section 3 above)

## H. Post-Launch Verification

In the first hour after launch:

1. Check the GitHub Release page — all assets downloadable, SHA256 matches
2. Install on a clean Windows VM (or use a Windows-using friend/CI)
3. Smoke test:
   - App launches without immediate crash
   - `Ctrl+Shift+K` opens the Kovix Agent panel
   - Settings → API keys can be entered and persisted
   - A simple chat message ("hello") returns a response
   - If a real agent task is run: confirm the Verifying chip appears
     (Phase 3.1 — verification state shows in status bar)
4. Watch the GitHub Issues tab for the first 24 hours — any "app won't
   launch" or "agent crashes" reports need immediate attention
5. Confirm rollback mechanism works (dry run: mark the release as
   pre-release, confirm the previous release becomes "Latest", then
   restore)
