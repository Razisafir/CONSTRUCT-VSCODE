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

## STUB-004 — MCP tool execution 30s timeout (RESOLVED in Phase 5.4)

**File:** `src/vs/workbench/contrib/construct/browser/services/mcp/mcpServerManagerService.ts`
lines 261-303.

**Status:** ✅ RESOLVED — confirmed during Phase 5.4 audit.

**Resolution evidence:** The `executeTool()` method already wraps each
`client.callTool()` invocation in a `Promise.race` against a 30-second
timeout (lines 266-279):

```typescript
const MCP_TOOL_TIMEOUT_MS = 30_000; // SEC: MCP tool execution must not hang indefinitely
const mcpToolCall = this.connectionPool.executeWithRetry(
    serverName,
    async (client: any) => {
        return await client.callTool({
            name: toolName,
            arguments: args
        });
    }
);
const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`MCP tool execution timed out after ${MCP_TOOL_TIMEOUT_MS / 1000}s`)), MCP_TOOL_TIMEOUT_MS)
);
const result = await Promise.race([mcpToolCall, timeoutPromise]);
```

The timeout is non-configurable at 30s (hardcoded constant). A hung MCP
server now rejects after 30s and the error is caught + returned as
`{ success: false, error: 'MCP tool execution timed out after 30s' }` —
the agent loop sees this as a normal tool failure and routes through
`AgentErrorRecoveryService` (classified as `timeout` via the existing
pattern match in `ERROR_CLASSIFICATION_PATTERNS`).

**Impact on Phase 3 UI:** None directly, but it means a hung MCP server
during the Verifying state's test run will not hang the agent loop
indefinitely — the verification harness has its own 120s timeout, and the
MCP tool calls inside that test have their own 30s timeout. Defense in
depth.

**Future improvement (not blocking):** Make the 30s configurable via a new
`construct.mcp.toolTimeoutMs` setting (default 30000, min 5000, max 120000).
Not in scope for this prompt — the hardcoded 30s is a sensible default and
matches the prompt's explicit ask.
