# Kovix v1.8.0 — Architecture Decisions

This document records the decisions made during the v1.8.0 consolidation pass (June 2026), with full reasoning grounded in actual code reading. These decisions are binding for v1.x; revisit at v2.0 planning.

## Decision 1: Multi-agent is NOT in scope for v1.x

### Question
> Is multi-agent wanted for v1.x? (Need to verify phase-28-launch's impl is real, not aspirational)

### Findings

**phase-28-launch impl is REAL, not aspirational.** Verified by reading all 4 files:

| File | Lines | Role |
|------|-------|------|
| `src/vs/platform/construct/common/agentOrchestratorService.ts` | 985 | Interface + types |
| `src/vs/workbench/contrib/construct/browser/services/agentOrchestratorService.ts` | 1402 | Implementation |
| `src/vs/platform/construct/common/multiAgentExecution.ts` | 141 | Interface (AgentRole, AgentTask, AgentHandoff, AgentConflict, SharedMemory) |
| `src/vs/workbench/contrib/construct/browser/services/multiAgentExecutionService.ts` | 595 | Implementation |

Total: 3123 lines. Real `AgentRole` enum (Planner, Coder, Verifier, Repairer, MemoryManager), real `AgentTask` lifecycle (pending → running → completed/failed), real `AgentHandoff` between roles, real `AgentConflict` detection (file_edit / resource / dependency), real `SharedMemory` keyed store with read-by tracking.

**BUT: phase-20-multiagent has a DIFFERENT, CONFLICTING design.** 8 files, pool/dispatcher model: `agentOrchestrator.ts`, `parallelDispatcher.ts`, `agentFactory.ts`, `agentPoolService.ts`. Pool-of-workers with parallel dispatch vs. phase-28's role-based sequential handoffs. These two architectures are not compatible.

**Main branch has NEITHER.** Only `memoryOrchestrator.ts` (memory coordination, not multi-agent execution). Main has the config flags `kovix.autonomous.parallelSwarm` and `kovix.autonomous.swarmSize` registered in `kovixAutonomousConfig.ts`, but no swarm implementation behind them.

### Decision

**NOT in scope for v1.x.** Reasoning:

1. **Two competing designs = team hasn't decided.** Shipping one design means rejecting the other. Without a clear product decision, shipping either is premature.
2. **Main's single-agent loop already does idea→plan→execute→verify→complete** with milestone gates, plan approval, verification harness, and error recovery. This is sufficient for v1.x.
3. **Multi-agent adds significant complexity** for marginal value at v1.x scale: coordination overhead, conflict resolution, shared memory consistency, debugging difficulty.
4. **The config flags `parallelSwarm` and `swarmSize` imply a feature that doesn't exist.** This is misleading to users.

### Action items

- [x] Marked `kovix.autonomous.parallelSwarm` and `kovix.autonomous.swarmSize` as `deprecated: true` in `kovixAutonomousConfig.ts` with a description explaining they are reserved for future use and currently no-op.
- [ ] Filed issue #139 to track multi-agent design decision for v2.0.
- [ ] Recovery branches `recovery/phase-20-multiagent` and `recovery/phase-28-launch` preserved on origin for future reference.

### Revisit at

v2.0 planning. Pre-conditions for revisiting: (a) clear product answer on pool-model vs. role-handoff-model, (b) v1.x single-agent loop proven stable in production, (c) real user demand for parallel agent execution.

---

## Decision 2: Cost governor / credit system IS part of v1.x vision (but currently inert)

### Question
> Is the cost governor / credit system part of v1.x vision? (Now ready on PR #138 if yes)

### Findings

**PR #138 (merged June 24 2026, commit 22994aaa) ported the interfaces and a stub implementation:**

| File | Lines | Status |
|------|-------|--------|
| `src/vs/platform/construct/common/costGovernor.ts` | 54 | Interface only |
| `src/vs/platform/construct/common/pricing/creditSystem.ts` | 201 | Interface only |
| `src/vs/platform/construct/common/pricing/pricingTypes.ts` | 269 | Types (SubscriptionTier, TIER_CONFIG, CreditActionType, DEFAULT_CREDIT_RULES) |
| `src/vs/workbench/contrib/construct/browser/services/costGovernorService.ts` | 48 | **Permissive stub** — all checks return allow |
| `src/vs/workbench/contrib/construct/browser/services/pricing/creditSystemService.ts` | 869 | Full CreditSystemService + CostGovernorEnhancedService impl |
| `src/vs/platform/construct/common/executionSanity.ts` | 189 | Interface only |
| `src/vs/workbench/contrib/construct/browser/services/executionSanityService.ts` | 585 | Full impl with 7 validation methods |

**Currently INERT.** Zero call sites in `agentLoop.ts`. The agent loop makes LLM calls without debiting credits, executes milestones without checking the cost governor, and runs verification without consulting execution sanity. The services are registered as singletons but never invoked.

**GOD Mode (on recovery/phase-28-launch) REQUIRES both `ICreditSystem` and `ICostGovernor`** — see `godModeActivatorService.ts` constructor. `MINIMUM_CREDITS_FOR_GOD_MODE = 10` credits. So porting GOD Mode would force these to become real.

### Decision

**YES, part of v1.x vision.** Reasoning:

1. **User explicitly wants it** ("Now ready on PR #138 if yes" implies desire to include).
2. **GOD Mode depends on it** — and GOD Mode is the launch-readiness ceremony that gives users confidence the agent is production-ready.
3. **The interfaces are already on main** (PR #138 merged). Removing them now would be churn; wiring them is the natural next step.
4. **ExecutionSanity is independently valuable** — its 7 validation methods (validateBuildResult, validateMilestoneCompletion, validateVerificationContradiction, etc.) augment the existing verification harness with deeper sanity checks.

### Action items

- [x] Documented the wiring gap in this decisions doc.
- [ ] Filed issue #140 to track wiring `creditSystem.debit(...)` into `agentLoop.ts`'s LLM call path. Requires design decision: what credit cost for what action? (Suggested: see `DEFAULT_CREDIT_RULES` in `pricingTypes.ts`.)
- [ ] Filed issue #141 to track wiring `costGovernor.checkBudget(...)` into `agentLoop.ts`'s milestone advance logic.
- [ ] Filed issue #142 to track wiring `executionSanity.validateMilestoneCompletion(...)` into the verification harness in `agentErrorRecoveryService.ts`.
- [ ] GOD Mode port tracked as issue #143 (depends on #140, #141 being done first).

### Revisit at

v1.9.0 (if wiring is done) or v2.0 (if GOD Mode port is the trigger).

---

## Decision 3: GOD Mode is a launch-readiness ceremony, not a power feature

### Question
> What does "GOD Mode" actually do? (Haven't read godModeActivator.ts yet)

### Findings

Read `godModeActivator.ts` (985 lines, interface) and `godModeActivatorService.ts` (partial, ~200+ lines read) on `recovery/phase-28-launch`.

**GOD Mode is NOT "all-powerful agent mode".** It is a **launch-readiness ceremony** with two components:

#### Component 1: `ILaunchChecklist` — pre-launch validation

15 automated checks that verify the system is ready for production launch. Each check exercises representative operations and verifies results. API:

```typescript
interface ILaunchChecklist {
  runAllChecks(): Promise<ILaunchStatus>;        // Run all 15 checks
  runCheck(phase: string): Promise<ILaunchCheckResult>;  // Run one phase's check
  getStatus(): ILaunchStatus | undefined;        // Get most recent status
  readonly checkCount: number;                   // 15
  readonly onCheckCompleted: Event<ILaunchCheckResult>;
  readonly onAllChecksCompleted: Event<ILaunchStatus>;
}
```

#### Component 2: `IGodModeActivator` — credit-gated autonomous session

State machine: `Inactive → Countdown(3s) → Active → Paused → Stopped`

```typescript
interface IGodModeActivator {
  readonly state: GodModeState;
  activate(config: IGodModeConfig): Promise<boolean>;  // Validates prereqs, creates git checkpoint, starts countdown
  pause(): boolean;   // Pause at current milestone (only if Active)
  resume(): boolean;  // Resume from Paused
  stop(): Promise<IGodModeSummary>;  // Restore pre-GOD state, emit summary
  readonly onStateChanged: Event<GodModeState>;
  readonly onCountdown: Event<number>;  // 3, 2, 1, 0
  readonly onStopped: Event<IGodModeSummary>;
}
```

**Behavior on `activate(config)`:**
1. Validate prerequisites (credits ≥ `MINIMUM_CREDITS_FOR_GOD_MODE = 10`, all launch checks pass)
2. Create a git checkpoint (so the session can be rolled back)
3. Trigger countdown animation (3 seconds)
4. Transition to Active state
5. Begin autonomous execution, tracking: `milestonesCompleted`, `milestonesTotal`, `filesChanged`, `agentsUsed`, `creditsConsumedAtStart`, `checkpointHash`

**Behavior on `stop()`:**
1. Restore pre-GOD state (git reset to checkpoint hash)
2. Emit `IGodModeSummary` with session stats
3. Transition to Inactive

### What GOD Mode is NOT

- ❌ Not "unlimited agent power" — the agent runs the same idea→plan→execute loop as normal mode
- ❌ Not "skip all approvals" — milestone gates still apply
- ❌ Not "god mode" in the gaming sense — it doesn't unlock hidden capabilities
- ❌ Not a separate agent — it's the same agent with extra safety rails and a ceremony

### What GOD Mode IS

- ✅ A **launch-readiness checklist** (15 automated checks)
- ✅ A **credit-gated session** (requires ≥10 credits, tracks consumption)
- ✅ A **rollback-safe session** (git checkpoint before, automatic restore on stop)
- ✅ A **ceremony** (countdown animation, state transitions, session summary)

### Why the name "GOD Mode"

Best guess: the name was chosen for marketing/branding impact ("launch the agent in GOD Mode!") rather than technical accuracy. The actual behavior is closer to "validated production launch with safety net". A more accurate name would be "Launch Mode" or "Validated Autonomous Session".

### Decision

**Document the real behavior, do NOT port to main in v1.x.** Reasoning:

1. Depends on `ICreditSystem` and `ICostGovernor` being actually wired (currently inert per Decision 2).
2. The launch checklist is independently valuable but should be a separate, smaller feature (`Kovix: Run Launch Checks` command) rather than tied to a "GOD Mode" ceremony.
3. The name "GOD Mode" is misleading and should be reconsidered before shipping.

### Action items

- [x] This document records the real behavior for future reference.
- [ ] Issue #143 tracks porting GOD Mode (blocked on #140, #141).
- [ ] Issue #144 tracks extracting the launch checklist as a standalone feature independent of GOD Mode.
- [ ] Issue #145 tracks renaming "GOD Mode" to something accurate before any user-facing surface ships.

---

## Summary

| Question | Answer | Action |
|----------|--------|--------|
| Multi-agent for v1.x? | **No.** Two competing designs, neither on main, single-agent sufficient. | Mark `parallelSwarm`/`swarmSize` as deprecated; file #139 for v2.0 design. |
| Cost governor / credit system for v1.x? | **Yes (vision), not yet (reality).** PR #138 merged interfaces + stub; inert. | File #140, #141, #142 to track wiring into agentLoop. |
| What does GOD Mode do? | **Launch-readiness ceremony + credit-gated autonomous session with rollback.** Not a power feature. | Document real behavior; file #143, #144, #145 for port + rename decisions. |
