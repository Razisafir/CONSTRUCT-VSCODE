# STUBS — Kovix Grand Redesign

Stubbed/incomplete code paths that ship as functional placeholders. Each entry
says what works, what doesn't, and what the unblocker is. Items are NOT fixed
inline unless a phase explicitly says to fix them.

---

## STUB-001 — `fileWatcherService.ts` `fs.watch` polling fallback

**File:** `src/vs/platform/construct/common/watcher/fileWatcherService.ts`

**What works:** File-change events are delivered to subscribers. The service
constructs a real `fs.watch` watcher per watched directory on macOS/Linux and
a polling fallback on Windows.

**What's stubbed:** Recursive watch on Windows uses 1-second polling instead
of `ReadDirectoryChangesW`. This means file-change events during the Verifying
state's test run (Phase 1.2) may arrive up to 1s late on Windows.

**Impact on Phase 3 UI:** The Verifying chip itself doesn't depend on file
watching — it depends on the terminal executor's stdout. So this stub does
NOT block the Phase 3 UI work. It only affects real-time file-tree diff
updates during the test run.

**Unblocker:** Implement `ReadDirectoryChangesW` binding in
`fileWatcherService.ts` (Windows-specific native module). Not in scope for
this prompt.

---

## STUB-002 — MCP marketplace catalog is empty `[]`

**File:** `src/vs/workbench/contrib/construct/browser/services/mcp/mcpMarketplaceService.ts`

**What works:** The MCP marketplace UI loads, renders the catalog, and supports
install/uninstall for items that ARE in the catalog. Built-in entries (ponytail,
ui-ux-pro-max, agent-reach) are populated by `mcpConnectionPool.ts` directly
and bypass the marketplace catalog.

**What's stubbed:** The marketplace `[]` placeholder means no third-party MCP
servers are listed. Users can still add MCP servers manually via the
`construct.mcp.servers` setting.

**Impact on Phase 3 UI:** None. The Verifying chip and unverified badge don't
depend on the MCP marketplace.

**Unblocker:** Curate a real marketplace catalog JSON. Not in scope for this
prompt.

---

## STUB-003 — Memory stats hardcoded in memory browser UI

**File:** `src/vs/workbench/contrib/construct/browser/constructMemoryPanel.ts`
(approximate — verify path)

**What works:** The memory browser UI shows entries with timestamps and types.

**What's stubbed:** Aggregate stats (total entries, size, PII-scrub count) are
hardcoded constants, not computed from the actual memory store.

**Impact on Phase 3 UI:** None for the Verifying chip. If the Phase 3 redesign
touches the memory browser panel, the stats will need to be wired up.

**Unblocker:** Wire `IMemoryStore.getStats()` to the UI. Not in scope for this
prompt unless Phase 3 explicitly touches the memory browser.

---

## STUB-004 — MCP tool execution 30s timeout (flagged in Phase 5.4)

**File:** `src/vs/workbench/contrib/construct/browser/services/mcp/mcpServerManager.ts`
and `mcpConnectionPool.ts`

**What works:** MCP tool calls execute and return results.

**What's stubbed:** No enforced timeout. A hung MCP server can hang the agent
loop indefinitely. The Phase 5.4 work item in the grand launch prompt asks to
fix this — it's tracked here so the Phase 5 pass can resolve it.

**Unblocker:** Wrap each `callTool` invocation in a `Promise.race` with a
configurable timeout (default 30s) in `mcpConnectionPool.ts`. Phase 5 will
address this.
