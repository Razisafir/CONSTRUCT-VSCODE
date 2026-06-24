/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IAgentLoop, AgentLoopEvent, IPlanResult, IPlanStep } from '../../../../../../platform/construct/common/agent/agentLoop.js';
import { IApprovedPlan, IMilestone, ExecutionState } from '../../../../../../platform/construct/common/agent/milestoneStateMachine.js';
import { LoadingState, FileChangeEntry } from '../../../../../../platform/construct/common/agent/loadingState.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { IChatMessage, IToolDefinition, IToolCall } from '../../../../../../platform/construct/common/llm/constructAIProvider.js';
import { IMCPProcess } from '../../../../../../platform/construct/common/mcp/mcpProcess.js';
import { IMCPServerManager } from '../../../../../../platform/construct/common/mcp/mcpServerManager.js';
import { ITerminalExecutor, isInterpreterCommand } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
// SEC-7 (H4 follow-up): Modal confirmation dialog for interpreter commands + severity.
import { IDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import Severity from '../../../../../../base/common/severity.js';
import { IDiffApplier } from '../../../../../../platform/construct/common/editor/diffApplier.js';
import { IMemoryOrchestrator } from '../../../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IConstructMemoryService } from '../../../../../../platform/construct/common/memory/constructMemory.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IAgentErrorRecovery } from '../../../../../../platform/construct/common/recovery/agentErrorRecovery.js';
import { ISnapshotManager, IRestoreResult } from '../../../../../../platform/construct/common/snapshot/snapshotManager.js';
import { IFileWatcherService } from '../../../../../../platform/construct/common/watcher/fileWatcherService.js';
// SEC-6: Prompt sanitisation to prevent injection attacks
import { PromptSanitiser } from '../../../../../../platform/construct/common/security/promptSanitiser.js';
// SEC-4: Workspace boundary validation to prevent path traversal
import { assertWithinWorkspace } from '../../../../../../platform/construct/common/security/workspaceGuard.js';
// SEC-7: Secret redaction from tool outputs
import { redactSecrets } from '../../../../../../platform/construct/common/security/secretRedactor.js';
// P0-5: In-memory staging for agent-proposed changes
import { IPendingChangesService } from '../../../../../../platform/construct/common/diff/pendingChanges.js';
import { IUniversalMemoryService } from '../../../../../../platform/construct/common/memory/universalMemoryService.js';
import { ISkillRegistry } from '../../../../../../platform/construct/common/skills/skillRegistry.js';
// Fix for F-002 (#72): inject the tool registry so security tools (nmap, nuclei, ghidra)
// and MCP server tools are visible to the LLM, not just the 8 hardcoded AGENT_TOOLS.
import { IConstructToolRegistry } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';
// Phase 3 -- wire the enhanced cost governor + credit system + execution sanity layer
// into the agent loop. The deleted permissive ICostGovernorService stub used to
// pretend to gate spending; this is the real gate. Execution sanity catches
// hallucinated success (exit 0 + stderr 'error', empty build output, etc.).
import { ICostGovernor, ICreditSystem } from '../../../../../../platform/construct/common/pricing/creditSystem.js';
import { IExecutionSanityService, SanitySeverity } from '../../../../../../platform/construct/common/executionSanity.js';
// Phase 4 -- the three Phase 3 helpers (mapToolToActionType, checkCostGate,
// applyCommandSanity) and the credit-consumption path were extracted to
// agentLoopHelpers.ts for unit testability. AgentLoopService has 22 injected
// dependencies, making direct instantiation impractical for tests. The
// extracted helpers take their collaborators as parameters instead.
//
// Note: only checkCostGate, applyCommandSanity, and consumeCreditsForToolCall
// are imported here. mapToolToActionType is called internally by
// consumeCreditsForToolCall (in the extracted module), so agentLoop.ts
// does not need to import it directly.
import {
        checkCostGate,
        applyCommandSanity,
        consumeCreditsForToolCall,
} from '../../../../../../platform/construct/common/agent/agentLoopHelpers.js';

const MAX_ROUNDS = 50;

/**
 * Cached result of a tool execution, used to avoid double-execution
 * during the planning phase.
 */
interface IToolResultCache {
        output: string;
        isError: boolean;
}

/**
 * Tool definitions for the unified AI provider interface.
 */
const AGENT_TOOLS: IToolDefinition[] = [
        {
                name: 'read_file',
                description: 'Read the contents of a file. Returns the file content as a string.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file relative to workspace root' }
                        },
                        required: ['path']
                }
        },
        {
                name: 'write_file',
                description: 'Write content to a file. Creates the file and parent directories if they don\'t exist.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file relative to workspace root' },
                                content: { type: 'string' as const, description: 'Content to write to the file' }
                        },
                        required: ['path', 'content']
                }
        },
        {
                name: 'list_directory',
                description: 'List the contents of a directory. Returns file and directory names.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the directory relative to workspace root' }
                        },
                        required: ['path']
                }
        },
        {
                name: 'create_directory',
                description: 'Create a directory, including any necessary parent directories.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the directory relative to workspace root' }
                        },
                        required: ['path']
                }
        },
        {
                name: 'run_command',
                description: 'Execute a shell command and return the output. Use for installing dependencies, running builds, tests, etc.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                command: { type: 'string' as const, description: 'The shell command to execute' },
                                cwd: { type: 'string' as const, description: 'Working directory (optional, defaults to workspace root)' }
                        },
                        required: ['command']
                }
        },
        {
                name: 'edit_file',
                description: 'Apply a unified diff to an existing file. Use for targeted edits rather than rewriting entire files.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file relative to workspace root' },
                                diff: { type: 'string' as const, description: 'Unified diff content to apply' }
                        },
                        required: ['path', 'diff']
                }
        },
        {
                name: 'search_codebase',
                description: 'Search the codebase using semantic similarity. Returns the most relevant code chunks. Requires Qdrant vector store to be running.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                query: { type: 'string' as const, description: 'The search query in natural language' },
                                topK: { type: 'number' as const, description: 'Number of results to return (default 8)' }
                        },
                        required: ['query']
                }
        },
        {
                name: 'web_search',
                description: 'Search the web for information. Only available when online mode is enabled. Returns search results with URLs and snippets.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                query: { type: 'string' as const, description: 'The search query' },
                                num: { type: 'number' as const, description: 'Number of results to return (default 10)' }
                        },
                        required: ['query']
                }
        }
];

/** Read-only tools for planning phase. */
const PLANNING_TOOLS: IToolDefinition[] = [
        AGENT_TOOLS[0], // read_file
        AGENT_TOOLS[2], // list_directory
];

export class AgentLoopService extends Disposable implements IAgentLoop {
        readonly _serviceBrand: undefined;

        private _isRunning = false;

        /**
         * Fix for F-003 (#73): multi-turn conversation context.
         * Each turn's user message + assistant response + tool calls + tool results
         * are appended here and prepended to the next turn's conversationMessages.
         * Cleared when the user starts a new chat (see clearConversationHistory()).
         */
        private _conversationHistory: IChatMessage[] = [];

        /** Fix for F-003 (#73): clear history when starting a new chat. */
        clearConversationHistory(): void {
                this._conversationHistory = [];
                this._activeSnapshotId = null;
                this._completedMilestoneIds.clear();
                this.logService.info('[AgentLoop] Conversation history cleared');
        }
        private readonly _onDidStart = this._register(new Emitter<string>());
        readonly onDidStart = this._onDidStart.event;
        private readonly _onDidComplete = this._register(new Emitter<{ summary: string }>());
        readonly onDidComplete = this._onDidComplete.event;
        private readonly _onError = this._register(new Emitter<{ text: string; recoverable: boolean }>());
        readonly onError = this._onError.event;

        private readonly _onLoadingStateChange = this._register(new Emitter<LoadingState>());
        readonly onLoadingStateChange = this._onLoadingStateChange.event;

        private readonly _onFileChange = this._register(new Emitter<FileChangeEntry>());
        readonly onFileChange = this._onFileChange.event;

        private readonly _onDidMilestonePause = this._register(new Emitter<IMilestone>());
        readonly onDidMilestonePause = this._onDidMilestonePause.event;

        /** Active snapshot ID for the current task (for undo support). */
        private _activeSnapshotId: string | null = null;

        /** Milestone execution state. */
        private _executionState: ExecutionState = ExecutionState.Idle;
        private _currentMilestone: IMilestone | null = null;
        private _milestoneResumeResolver: (() => void) | null = null;
        private _completedMilestoneIds: Set<string> = new Set();

        constructor(
                @ILogService private readonly logService: ILogService,
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IMCPProcess private readonly mcpProcess: IMCPProcess,
                @ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
                @IDiffApplier private readonly diffApplier: IDiffApplier,
                @IMemoryOrchestrator private readonly memoryOrchestrator: IMemoryOrchestrator,
                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ICommandService private readonly commandService: ICommandService,
                @IFileService private readonly fileService: IFileService,
                @IAgentErrorRecovery private readonly errorRecovery: IAgentErrorRecovery,
                @ISnapshotManager private readonly snapshotManager: ISnapshotManager,
                @IFileWatcherService private readonly fileWatcher: IFileWatcherService,
                @IPendingChangesService private readonly pendingChanges: IPendingChangesService,
                @IMCPServerManager private readonly mcpServerManager: IMCPServerManager,
                @IUniversalMemoryService private readonly universalMemory: IUniversalMemoryService,
                @ISkillRegistry private readonly skillRegistry: ISkillRegistry,
                @IDialogService private readonly dialogService: IDialogService,
                // Fix for F-002 (#72): inject the tool registry so the agent loop sees
                // security tools (nmap, nuclei, ghidra) and MCP server tools too.
                @IConstructToolRegistry private readonly toolRegistry: IConstructToolRegistry,
                // Phase 3: real spending gate (replaces the deleted permissive stub).
                @ICostGovernor private readonly costGovernor: ICostGovernor,
                @ICreditSystem private readonly creditSystem: ICreditSystem,
                // Phase 3: hallucinated-success detector -- validates that claimed
                // success (exit 0) actually matches reality (artifacts present, no
                // 'error' in stderr, non-empty output, etc.).
                @IExecutionSanityService private readonly executionSanity: IExecutionSanityService,
        ) {
                super();
                this.logService.info('[AgentLoop] Service created with error recovery, snapshots, file watcher, pending changes, universal memory, skill registry, tool registry, cost governor, credit system, and execution sanity');

                // Phase 3: surface cost-governor events into the Kovix log channel so
                // the user can see budget warnings and emergency-stop triggers in
                // real time during an agent task. Non-fatal: listeners are registered
                // as disposables so they clean up with the service.
                this._register(this.creditSystem.onEmergencyStop(({ creditsRemaining }) => {
                        this.logService.error(`[AgentLoop][CostGovernor] EMERGENCY STOP triggered: only ${creditsRemaining} credits remaining. Further agent actions will be blocked until credits are replenished.`);
                }));
                this._register(this.creditSystem.onBudgetWarning(alert => {
                        this.logService.warn(`[AgentLoop][CostGovernor] Budget warning (${alert.type}): ${alert.message} -- usage ${alert.currentUsage}/${alert.threshold}. ${alert.suggestedAction}`);
                }));
                this._register(this.creditSystem.onCreditsChanged(({ remaining, total, consumed }) => {
                        // Trace-level: too noisy for info, but useful for debugging spend.
                        this.logService.trace(`[AgentLoop][CostGovernor] Credits: ${remaining}/${total} remaining (${consumed} consumed this period)`);
                }));
        }

        /**
         * Fix for F-002 (#72): build the tool list from the registry, falling back
         * to the hardcoded AGENT_TOOLS only if the registry is empty (e.g. during
         * early init before MCP servers connect).
         */
        private getAgentTools(): IToolDefinition[] {
                const registered = this.toolRegistry.listTools();
                return registered.length > 0 ? registered : AGENT_TOOLS;
        }

        /** Fix for F-002 (#72): read-only tools for the planning phase. */
        private getPlanningTools(): IToolDefinition[] {
                const all = this.getAgentTools();
                const readOnlyNames = new Set(['read_file', 'list_directory', 'search_codebase', 'web_search']);
                const filtered = all.filter(t => readOnlyNames.has(t.name));
                return filtered.length > 0 ? filtered : PLANNING_TOOLS;
        }

        // ----------------------------------------------------------------------
        // Phase 3 -- cost governor + execution sanity integration
        //
        // The cost governor gates each LLM round on emergency mode (<10 credits)
        // and consumes credits per tool call so the governor's data is real. The
        // execution sanity layer validates command output to catch hallucinated
        // success (exit 0 + empty output, exit 0 + 'error' in stderr, missing
        // build artifacts, etc.). Together these replace the deleted permissive
        // ICostGovernorService stub with real, enforceable spending protection.
        //
        // Phase 4 -- the helper implementations were extracted to
        // agentLoopHelpers.ts so they can be unit-tested directly. These
        // private wrappers just delegate, preserving the call sites in this
        // file (this.checkCostGate(), this.applyCommandSanity()) while the
        // real logic lives in the extracted module. See agentLoopHelpers.ts
        // for the testable implementations.
        //
        // Note: mapToolToActionType does NOT have a wrapper here because it's
        // only called from consumeCreditsForToolCall() in the extracted module,
        // which calls the extracted function directly. Keeping a wrapper would
        // be dead code (the compiler catches this as 'declared but never read').
        // ----------------------------------------------------------------------

        private checkCostGate(): { allowed: boolean; reason: string } {
                return checkCostGate(this.costGovernor, this.creditSystem, this.logService);
        }

        private applyCommandSanity(
                command: string,
                exitCode: number,
                stdout: string,
                stderr: string,
        ): { output: string; suspicious: boolean } {
                return applyCommandSanity(this.executionSanity, this.logService, command, exitCode, stdout, stderr);
        }

        get isRunning(): boolean {
                return this._isRunning;
        }

        get executionState(): ExecutionState {
                return this._executionState;
        }

        get currentMilestone(): IMilestone | null {
                return this._currentMilestone;
        }

        async runPlanningPhase(task: string, signal?: AbortSignal): Promise<IPlanResult> {
                this.logService.info(`[AgentLoop] Planning phase started: ${task}`);

                // Ensure MCP process is connected for planning reads
                if (!this.mcpProcess.connected) {
                        await this.mcpProcess.initialize();
                }

                // Build system prompt with memory context
                const systemPrompt = await this.buildSystemPrompt(task, true);

                // Fix for F-003 (#73): prepend prior conversation context so the agent
                // remembers what was discussed in previous turns.
                const conversationMessages: IChatMessage[] = [
                        ...this._conversationHistory,
                        {
                                role: 'user',
                                content: `Analyze the current workspace and create a plan for this task: "${task}"\n\nFirst, explore the workspace to understand its structure, then list the specific steps needed. Use only read_file and list_directory tools.\n\nFormat your response as a numbered list of steps, each starting with [Read], [Create], [Edit], or [Run].`
                        }
                ];

                let fullResponse = '';

                try {
                        let roundCount = 0;

                        while (roundCount < MAX_ROUNDS) {
                                roundCount++;

                                // Tool result cache: prevents double-execution during planning.
                                // Results are cached during stream iteration and reused when
                                // building the tool result messages for the next API call.
                                const toolResultCache = new Map<string, IToolResultCache>();

                                const assistantToolCalls: IToolCall[] = [];
                                let currentText = '';
                                let stopReason = '';
                                let hadToolCalls = false;

                                // Create a NEW stream for each round with updated conversation
                                // Create a timeout controller (60s per LLM call)
                                const timeoutController = new AbortController();
                                const timeoutId = setTimeout(() => timeoutController.abort(), 60_000);
                                // Chain user's abort signal with the timeout
                                if (signal) {
                                        signal.addEventListener('abort', () => timeoutController.abort());
                                }

                                const stream = this.aiService.chat(
                                        conversationMessages,
                                        this.getPlanningTools(),
                                        { signal: timeoutController.signal, systemPrompt }
                                );

                                for await (const event of stream) {
                                        if (signal?.aborted) {
                                                clearTimeout(timeoutId);
                                                return { steps: [], summary: 'Cancelled', rawResponse: '' };
                                        }

                                        switch (event.type) {
                                                case 'token':
                                                        currentText += event.text;
                                                        fullResponse += event.text;
                                                        break;
                                                case 'tool_start':
                                                        hadToolCalls = true;
                                                        assistantToolCalls.push({
                                                                id: event.toolId,
                                                                name: event.toolName,
                                                                arguments: '{}',
                                                        });
                                                        break;
                                                case 'tool_end': {
                                                        // Update the tool call with the actual arguments
                                                        const toolCall = assistantToolCalls.find(
                                                                tc => tc.id === event.toolId
                                                        );
                                                        if (toolCall) {
                                                                toolCall.arguments = JSON.stringify(event.toolInput);
                                                        }

                                                        // Execute the tool ONCE and cache the result
                                                        if (!toolResultCache.has(event.toolId)) {
                                                                const toolResult = await this.executeTool(event.toolName, event.toolInput, true);
                                                                toolResultCache.set(event.toolId, {
                                                                        output: toolResult,
                                                                        isError: toolResult.startsWith('Error:'),
                                                                });
                                                        }
                                                        break;
                                                }
                                                case 'done':
                                                        stopReason = event.stopReason;
                                                        break;
                                                case 'error':
                                                        throw new Error(event.text);
                                        }
                                }

                                clearTimeout(timeoutId);

                                // If there were tool calls, add assistant message + tool result messages and continue
                                if (hadToolCalls && stopReason === 'tool_use') {
                                        conversationMessages.push({
                                                role: 'assistant',
                                                content: currentText || '',
                                                toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined
                                        });

                                        // Build tool result messages from cache (NOT re-executing tools)
                                        for (const toolCall of assistantToolCalls) {
                                                const cached = toolResultCache.get(toolCall.id);
                                                if (cached) {
                                                        conversationMessages.push({
                                                                role: 'tool',
                                                                content: cached.output,
                                                                toolCallId: toolCall.id,
                                                        });
                                                } else {
                                                        // Fallback: should not happen, but execute once if cache miss
                                                        this.logService.warn(`[AgentLoop] Cache miss for tool ${toolCall.id}, executing as fallback`);
                                                        const input = JSON.parse(toolCall.arguments);
                                                        const result = await this.executeTool(toolCall.name, input, true);
                                                        conversationMessages.push({
                                                                role: 'tool',
                                                                content: result,
                                                                toolCallId: toolCall.id,
                                                        });
                                                }
                                        }
                                        continue;
                                }

                                // End turn -- planning complete
                                break;
                        }

                        // Parse the plan from the response
                        const steps = this.parsePlan(fullResponse);

                        // Fix for F-003 (#73): remember this turn so the next turn has context.
                        this._conversationHistory.push(
                                { role: 'user', content: task },
                                { role: 'assistant', content: fullResponse },
                        );

                        return {
                                steps,
                                summary: fullResponse,
                                rawResponse: fullResponse,
                        };
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[AgentLoop] Planning error: ${msg}`);
                        throw error;
                }
        }

        async *run(task: string, signal?: AbortSignal): AsyncGenerator<AgentLoopEvent> {
                if (this._isRunning) {
                        yield { type: 'error', text: 'Agent loop is already running.', recoverable: false };
                        return;
                }

                this._isRunning = true;
                this._onDidStart.fire(task);
                this.logService.info(`[AgentLoop] Execution started: ${task}`);

                try {
                        // Ensure MCP process is connected
                        if (!this.mcpProcess.connected) {
                                await this.mcpProcess.initialize();
                        }

                        // Create snapshot before task execution (for undo support)
                        const workspacePath = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '.';
                        try {
                                const snapshot = await this.snapshotManager.createSnapshot(workspacePath, task);
                                this._activeSnapshotId = snapshot.id;
                                this.logService.info(`[AgentLoop] Snapshot created: ${snapshot.id} (strategy: ${snapshot.strategy})`);
                        } catch (snapErr) {
                                this.logService.warn('[AgentLoop] Snapshot creation failed (non-blocking):', snapErr instanceof Error ? snapErr.message : String(snapErr));
                        }

                        // Start file watcher for real-time refresh
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                        if (workspaceRoot && !this.fileWatcher.isWatching) {
                                this.fileWatcher.startWatching(workspaceRoot);
                        }

                        // Build system prompt with memory context
                        const systemPrompt = await this.buildSystemPrompt(task, false);

                        // Fix for F-003 (#73): prepend prior conversation context.
                        const conversationMessages: IChatMessage[] = [
                                ...this._conversationHistory,
                                {
                                        role: 'user',
                                        content: task
                                }
                        ];

                        let roundCount = 0;
                        let finalSummary = '';

                        while (roundCount < MAX_ROUNDS) {
                                roundCount++;

                                // Phase 3: cost-governor gate. Each LLM round consumes
                                // credits (via the tool calls it triggers); if we're in
                                // emergency mode (<10 credits), stop the loop with a
                                // clear, recoverable error. The user can replenish
                                // credits and re-run; essential actions outside the
                                // agent loop (file save, git commit, settings) remain
                                // available regardless of credit balance.
                                const gate = this.checkCostGate();
                                if (!gate.allowed) {
                                        this._executionState = ExecutionState.Error;
                                        this._onError.fire({ text: gate.reason, recoverable: true });
                                        yield { type: 'error', text: gate.reason, recoverable: true };
                                        return;
                                }

                                this.logService.info(`[AgentLoop] Round ${roundCount}/${MAX_ROUNDS}`);

                                const assistantToolCalls: IToolCall[] = [];
                                const toolResults: { toolUseId: string; toolName: string; result: string; success: boolean; filePath?: string }[] = [];
                                let currentText = '';
                                let stopReason = '';
                                let hasToolCalls = false;

                                // Create a NEW stream for each round with updated conversation
                                // Create a timeout controller (60s per LLM call)
                                const timeoutController = new AbortController();
                                const timeoutId = setTimeout(() => timeoutController.abort(), 60_000);
                                // Chain user's abort signal with the timeout
                                if (signal) {
                                        signal.addEventListener('abort', () => timeoutController.abort());
                                }

                                const stream = this.aiService.chat(
                                        conversationMessages,
                                        this.getAgentTools(),
                                        { signal: timeoutController.signal, systemPrompt }
                                );

                                for await (const event of stream) {
                                        if (signal?.aborted) {
                                                clearTimeout(timeoutId);
                                                yield { type: 'error', text: '[STOP] Stopped by user', recoverable: false };
                                                this._isRunning = false;
                                                return;
                                        }

                                        switch (event.type) {
                                                case 'token':
                                                        currentText += event.text;
                                                        yield { type: 'token', text: event.text };
                                                        break;

                                                case 'tool_start':
                                                        hasToolCalls = true;
                                                        assistantToolCalls.push({
                                                                id: event.toolId,
                                                                name: event.toolName,
                                                                arguments: '{}',
                                                        });
                                                        yield { type: 'tool_start', toolId: event.toolId, toolName: event.toolName };
                                                        break;

                                                case 'tool_input':
                                                        yield { type: 'tool_executing', toolId: event.toolId, toolName: '', detail: event.text };
                                                        break;

                                                case 'tool_end': {
                                                        // Update the tool call with the actual arguments
                                                        const toolCall = assistantToolCalls.find(
                                                                tc => tc.id === event.toolId
                                                        );
                                                        if (toolCall) {
                                                                toolCall.arguments = JSON.stringify(event.toolInput ?? {});
                                                        }

                                                        yield { type: 'tool_executing', toolId: event.toolId, toolName: event.toolName, detail: 'Executing...' };

                                                        // Execute the tool with error recovery
                                                        let toolResult = await this.executeTool(event.toolName, event.toolInput, false);
                                                        let success = !toolResult.startsWith('Error:');

                                                        // Error recovery: if tool failed, attempt recovery
                                                        if (!success && this.errorRecovery) {
                                                                const stepError = this.errorRecovery.classifyError(
                                                                        event.toolName,
                                                                        event.toolInput,
                                                                        toolResult,
                                                                        undefined,
                                                                        undefined
                                                                );
                                                                this.logService.info(`[AgentLoop] Step error classified: ${stepError.errorType} for tool ${event.toolName}`);

                                                                const recoveryResult = await this.errorRecovery.attemptRecovery(stepError);
                                                                if (recoveryResult.strategy === 'retry' && !recoveryResult.success) {
                                                                        // Inject error context into conversation for the next LLM call
                                                                        const errorContext = this.errorRecovery.buildErrorContext(stepError, [toolResult]);
                                                                        this.logService.info(`[AgentLoop] Injecting error context for retry: ${stepError.errorType}`);
                                                                        // The error context will be included in the next tool result message
                                                                        toolResult = `${toolResult}\n\n${errorContext}`;
                                                                } else if (recoveryResult.strategy === 'abort') {
                                                                        yield { type: 'error', text: `Step failed and user chose to abort: ${stepError.message}`, recoverable: false };
                                                                        this._isRunning = false;
                                                                        return;
                                                                }
                                                                // 'skip' strategy: continue with remaining steps
                                                        }

                                                        yield { type: 'tool_result', toolId: event.toolId, toolName: event.toolName, result: toolResult, success };

                                                        // Track file writes for snapshot + file watcher
                                                        let filePath: string | undefined;
                                                        if ((event.toolName === 'write_file' || event.toolName === 'edit_file') && success) {
                                                                const toolInput = event.toolInput as Record<string, string> | null;
                                                                filePath = toolInput?.path ?? '';
                                                                if (filePath) {
                                                                        yield { type: 'file_written', filePath };

                                                                        // Track in snapshot for undo support
                                                                        if (this._activeSnapshotId) {
                                                                                try {
                                                                                        const exists = await this.diffApplier.exists(filePath);
                                                                                        if (exists) {
                                                                                                this.snapshotManager.trackFileModified(this._activeSnapshotId, filePath);
                                                                                        } else {
                                                                                                this.snapshotManager.trackFileCreated(this._activeSnapshotId, filePath);
                                                                                        }
                                                                                } catch {
                                                                                        // Snapshot tracking is non-critical
                                                                                        this.snapshotManager.trackFileCreated(this._activeSnapshotId, filePath);
                                                                                }
                                                                        }

                                                                        // Notify file watcher for real-time tree refresh
                                                                        const fileUri = URI.file(filePath);
                                                                        this.fileWatcher.notifyAgentFileCreated(fileUri);
                                                                }
                                                        }

                                                        // Store tool result for batching
                                                        toolResults.push({
                                                                toolUseId: event.toolId,
                                                                toolName: event.toolName,
                                                                result: toolResult,
                                                                success,
                                                                filePath,
                                                        });

                                                        // Phase 3: consume credits for successful tool calls.
                                                        // Reads are free; writes/commands consume 1 credit each.
                                                        // Failures do NOT consume credits (the user shouldn't pay
                                                        // for broken tool calls). Fire-and-forget: credit
                                                        // accounting must never block the agent loop. If
                                                        // consumeCredits returns false (insufficient credits),
                                                        // the next round's checkCostGate() will catch it and
                                                        // stop the loop with a recoverable error.
                                                        //
                                                        // Phase 4: the consumption logic was extracted to
                                                        // consumeCreditsForToolCall() in agentLoopHelpers.ts
                                                        // for unit testability.
                                                        consumeCreditsForToolCall(
                                                                this.creditSystem,
                                                                this.logService,
                                                                event.toolName,
                                                                success,
                                                                this._activeSnapshotId ?? undefined,
                                                        );

                                                        // Store in memory
                                                        if (this.constructMemory.isInitialized && this.constructMemory.config.autoLearn) {
                                                                this.constructMemory.addMemory(
                                                                        `Tool ${event.toolName}: ${JSON.stringify(event.toolInput)} -> ${success ? 'Success' : 'Failed'}`,
                                                                        { type: 'tool_result', toolName: event.toolName, taskId: task }
                                                                ).catch(() => { /* non-critical */ });
                                                        }
                                                        break;
                                                }

                                                case 'done':
                                                        stopReason = event.stopReason;
                                                        break;

                                                case 'error':
                                                        yield { type: 'error', text: event.text, recoverable: true };
                                                        break;
                                        }
                                }

                                clearTimeout(timeoutId);

                                // Add remaining text to final summary
                                if (currentText) {
                                        finalSummary += currentText;
                                }

                                // If there were tool calls, add assistant + tool results to conversation
                                if (hasToolCalls && toolResults.length > 0) {
                                        conversationMessages.push({
                                                role: 'assistant',
                                                content: currentText || '(executing tools)',
                                                toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined
                                        });

                                        // Each tool result is a separate message in the unified format
                                        for (const tr of toolResults) {
                                                conversationMessages.push({
                                                        role: 'tool',
                                                        content: tr.result,
                                                        toolCallId: tr.toolUseId,
                                                });
                                        }
                                }

                                // If end_turn or no more tool calls, we're done
                                if (stopReason === 'end_turn' || !hasToolCalls) {
                                        break;
                                }
                        }

                        // ──────────────────────────────────────────────────────────────────────
                        // Phase 1.2 — Real verification before "complete" is allowed.
                        // The agent has declared the task done (end_turn / no tool calls).
                        // The harness now runs a REAL check (test > build > typecheck)
                        // and only lets the milestone advance if exit code is 0.
                        // This converts "confidently wrong" from a silent pass into a
                        // classified 'verification_failed' error routed through
                        // AgentErrorRecoveryService.
                        // ──────────────────────────────────────────────────────────────────────
                        for await (const vEvent of this.runVerification(signal)) {
                                yield vEvent;
                                if (vEvent.type === 'verification_result' && !vEvent.passed) {
                                        // Verification failed — classify + route to error recovery
                                        this._executionState = ExecutionState.VerificationFailed;
                                        const stepError = this.errorRecovery.classifyError(
                                                'verification_harness',
                                                { command: 'auto-detected' },
                                                vEvent.output,
                                                1,
                                                vEvent.output
                                        );
                                        // Force the error type to verification_failed regardless of pattern match
                                        (stepError as { errorType: string }).errorType = 'verification_failed';
                                        this.logService.warn(`[AgentLoop] Verification failed, routing to error recovery: ${vEvent.output.substring(0, 200)}`);
                                        const recovery = await this.errorRecovery.attemptRecovery(stepError);
                                        const recoverable = recovery.strategy === 'retry';
                                        this._executionState = ExecutionState.Error;
                                        const errText = `[Verification Failed] The agent declared the task complete, but the harness's real check returned non-zero.\n${vEvent.output.substring(0, 800)}`;
                                        this._onError.fire({ text: errText, recoverable });
                                        yield { type: 'error', text: errText, recoverable };
                                        return; // do NOT yield 'complete'
                                }
                        }
                        // Verification passed (or marked unverified) — proceed normally.
                        this._executionState = ExecutionState.Complete;

                        // Store task summary in memory
                        if (this.constructMemory.isInitialized && this.constructMemory.config.autoLearn) {
                                this.constructMemory.addMemory(
                                        `Task completed: ${task}. Summary: ${finalSummary.substring(0, 500)}`,
                                        { type: 'task_summary', task }
                                ).catch(() => { /* non-critical */ });
                        }

                        // Auto-extract universal memory from completed task
                        if (this.universalMemory && finalSummary) {
                                this.universalMemory.autoExtractFromTask(task, finalSummary.substring(0, 500)).catch(() => { /* non-critical */ });
                        }

                        // Fix for F-003 (#73): remember this turn so the next turn has context.
                        this._conversationHistory.push(
                                { role: 'user', content: task },
                                { role: 'assistant', content: finalSummary || 'Task completed.' },
                        );

                        yield { type: 'complete', summary: finalSummary || 'Task completed.' };
                        this._onDidComplete.fire({ summary: finalSummary });
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[AgentLoop] Error: ${msg}`);
                        this._onError.fire({ text: msg, recoverable: false });
                        yield { type: 'error', text: msg, recoverable: false };
                } finally {
                        this._isRunning = false;
                        this._activeSnapshotId = null;
                }
        }

        /**
         * Run execution with an approved plan, supporting milestone-based pausing.
         */
        async *runWithApprovedPlan(approvedPlan: IApprovedPlan, signal?: AbortSignal): AsyncGenerator<AgentLoopEvent> {
                const selectedSteps = approvedPlan.steps.filter(s => s.selected);
                if (selectedSteps.length === 0) {
                        yield { type: 'error', text: 'No steps selected for execution.', recoverable: false };
                        return;
                }

                const taskDescription = selectedSteps.map(s => `${s.action}: ${s.target}`).join('\n');
                const enhancedTask = `${approvedPlan.task}\n\nExecute these specific steps:\n${taskDescription}`;

                yield* this.run(enhancedTask, signal);
        }

        /**
         * Resume from the current milestone pause.
         */
        resumeFromMilestone(): void {
                if (this._milestoneResumeResolver) {
                        this._executionState = ExecutionState.Executing;
                        const milestone = this._currentMilestone;
                        this._milestoneResumeResolver();
                        this._milestoneResumeResolver = null;
                        if (milestone) {
                                this._completedMilestoneIds.add(milestone.id);
                        }
                        this._currentMilestone = null;
                }
        }

        /**
         * Skip the current milestone and move to the next.
         */
        skipCurrentMilestone(): void {
                if (this._milestoneResumeResolver) {
                        this._executionState = ExecutionState.Executing;
                        const milestone = this._currentMilestone;
                        this._milestoneResumeResolver();
                        this._milestoneResumeResolver = null;
                        if (milestone) {
                                this._completedMilestoneIds.add(milestone.id);
                        }
                        this._currentMilestone = null;
                }
        }

        /**
         * Extract milestones from a plan's steps.
         * Groups consecutive steps into milestones, marking major ones
         * at natural boundaries (e.g., after file creation steps).
         */
        extractMilestonesFromPlan(steps: IPlanStep[]): IMilestone[] {
                if (steps.length === 0) {
                        return [];
                }

                const milestones: IMilestone[] = [];
                let currentGroup: number[] = [];
                let milestoneIndex = 0;

                for (let i = 0; i < steps.length; i++) {
                        currentGroup.push(i);

                        // Create a milestone boundary after every 3-5 steps,
                        // or when the action type changes to a different category
                        const isNaturalBoundary =
                                currentGroup.length >= 3 &&
                                (i === steps.length - 1 ||
                                        (steps[i].action === 'Run' && steps[i + 1]?.action !== 'Run') ||
                                        (steps[i].action === 'Create' && steps[i + 1]?.action !== 'Create') ||
                                        currentGroup.length >= 5);

                        if (isNaturalBoundary) {
                                const firstStep = steps[currentGroup[0]];
                                const lastStep = steps[currentGroup[currentGroup.length - 1]];
                                const isMajor = currentGroup.some(idx =>
                                        steps[idx].action === 'Create' || steps[idx].action === 'Run'
                                );

                                milestones.push({
                                        id: `milestone-${milestoneIndex}`,
                                        name: `${firstStep.action}: ${firstStep.target}${currentGroup.length > 1 ? ` -> ${lastStep.target}` : ''}`,
                                        description: `Steps ${currentGroup[0] + 1}-${currentGroup[currentGroup.length - 1] + 1}`,
                                        index: milestoneIndex,
                                        isMajor,
                                        stepIndices: [...currentGroup],
                                        completed: false,
                                });

                                currentGroup = [];
                                milestoneIndex++;
                        }
                }

                // Handle remaining steps
                if (currentGroup.length > 0) {
                        const firstStep = steps[currentGroup[0]];
                        milestones.push({
                                id: `milestone-${milestoneIndex}`,
                                name: `${firstStep.action}: ${firstStep.target}`,
                                description: `Steps ${currentGroup[0] + 1}-${currentGroup[currentGroup.length - 1] + 1}`,
                                index: milestoneIndex,
                                isMajor: currentGroup.some(idx =>
                                        steps[idx].action === 'Create' || steps[idx].action === 'Run'
                                ),
                                stepIndices: [...currentGroup],
                                completed: false,
                        });
                }

                return milestones;
        }

        /**
         * Undo the last agent task by restoring the most recent snapshot.
         * Reverts all file changes made during the last task.
         */
        async undoLastTask(): Promise<IRestoreResult | null> {
                const snapshots = this.snapshotManager.getAllSnapshots();
                const lastSnapshot = snapshots.find(s => s.status === 'active');
                if (!lastSnapshot) {
                        this.logService.info('[AgentLoop] No active snapshot to undo');
                        return null;
                }

                this.logService.info(`[AgentLoop] Undoing task: ${lastSnapshot.taskDescription} (snapshot: ${lastSnapshot.id})`);
                const result = await this.snapshotManager.restoreSnapshot(lastSnapshot.id);
                this.refreshExplorer();
                return result;
        }

        /**
         * Execute a tool and return the result as a string.
         */
        private async executeTool(name: string, input: unknown, readOnly: boolean): Promise<string> {
                const args = (input as Record<string, string> | null) ?? {};

                try {
                        switch (name) {
                                case 'read_file': {
                                        const path = args.path;
                                        if (!path) { return 'Error: path is required'; }
                                        // SEC-4: Validate path is within workspace
                                        assertWithinWorkspace(path, this.workspaceContextService);
                                        const content = await this.mcpProcess.readFile(path);
                                        // SEC-6: Sanitise file content before injecting into LLM context
                                        return PromptSanitiser.sanitise(content);
                                }

                                case 'write_file': {
                                        if (readOnly) { return 'Error: write_file not available during planning phase'; }
                                        const path = args.path;
                                        const content = args.content;
                                        if (!path || content === undefined) { return 'Error: path and content are required'; }
                                        // SEC-4: Validate path is within workspace
                                        assertWithinWorkspace(path, this.workspaceContextService);
                                        // P0-5 FIX: Stage in memory, don't write to disk directly
                                        const writeUri = URI.file(path);
                                        await this.pendingChanges.stageFile(writeUri, content);
                                        return `File change staged: ${path}. Review and accept/reject in diff view.`;
                                }

                                case 'list_directory': {
                                        const path = args.path ?? '.';
                                        // SEC-4: Validate path is within workspace (allow '.' as CWD)
                                        if (path !== '.') {
                                                assertWithinWorkspace(path, this.workspaceContextService);
                                        }
                                        const entries = await this.mcpProcess.listDirectory(path);
                                        // SEC-6: Sanitise directory listing before injecting into LLM context
                                        return PromptSanitiser.sanitise(entries.join('\n'));
                                }

                                case 'create_directory': {
                                        if (readOnly) { return 'Error: create_directory not available during planning phase'; }
                                        const path = args.path;
                                        if (!path) { return 'Error: path is required'; }
                                        // SEC-4: Validate path is within workspace
                                        assertWithinWorkspace(path, this.workspaceContextService);
                                        await this.mcpProcess.createDirectory(path);
                                        return `Directory created: ${path}`;
                                }

                                case 'run_command': {
                                        if (readOnly) { return 'Error: run_command not available during planning phase'; }
                                        const command = args.command;
                                        if (!command) { return 'Error: command is required'; }
                                        const cwd = args.cwd;
                                        // SEC-7 (H4 follow-up): Interpreter-command confirmation dialog.
                                        // Mirrors the edit_file diff-approval flow: commands that can
                                        // execute arbitrary code via crafted arguments (node, python,
                                        // npx, npm, curl, wget, docker, etc. — see INTERPRETER_COMMANDS)
                                        // require explicit user consent before spawning. If the user
                                        // declines, we return an error to the LLM so it can re-plan.
                                        //
                                        // Restricted mode (kovix.terminal.restrictedMode=true,
                                        // the default) already blocks interpreters via the allowlist
                                        // before this code runs. This gate covers the case where the
                                        // user has disabled restricted mode — every interpreter
                                        // invocation now pops a modal instead of running silently.
                                        if (isInterpreterCommand(command)) {
                                                const confirmed = await this.dialogService.confirm({
                                                        type: Severity.Warning,
                                                        title: 'Approve command execution',
                                                        message: `The agent wants to run a command that can execute arbitrary code.`,
                                                        detail: `Command: ${command}${cwd ? `\nWorking directory: ${cwd}` : ''}\n\nThis command is on the interpreter allowlist (node, python, npx, curl, docker, etc.) because it can run arbitrary code through crafted arguments. Review the command carefully before approving.`,
                                                        primaryButton: 'Run once',
                                                        cancelButton: 'Cancel',
                                                });
                                                if (!confirmed.confirmed) {
                                                        this.logService.info(`[AgentLoop] User declined interpreter command: ${command}`);
                                                        return 'Error: user declined to run this command. Re-plan without invoking an interpreter, or ask the user to run it manually.';
                                                }
                                                this.logService.info(`[AgentLoop] User approved interpreter command: ${command}`);
                                        }
                                        const result = await this.terminalExecutor.execute(command, cwd, 60000);
                                        let output = '';
                                        if (result.stdout) { output += result.stdout; }
                                        if (result.stderr) { output += (output ? '\n' : '') + result.stderr; }
                                        if (result.exitCode !== 0) {
                                                output += `\nExit code: ${result.exitCode}`;
                                        }
                                        // Phase 3: Execution sanity check on command output.
                                        // Catches hallucinated success (exit 0 + 'error' in stderr,
                                        // exit 0 + empty output, etc.). Findings are appended to
                                        // the output so the LLM sees them and re-plans accordingly.
                                        const sanity = this.applyCommandSanity(command, result.exitCode, result.stdout ?? '', result.stderr ?? '');
                                        if (sanity.suspicious) {
                                                output = sanity.output;
                                        }
                                        // SEC-6: Sanitise command output to prevent injection
                                        // SEC-7: Redact any secrets from command output
                                        return PromptSanitiser.sanitise(redactSecrets(output || '(no output)'));
                                }

                                case 'edit_file': {
                                        if (readOnly) { return 'Error: edit_file not available during planning phase'; }
                                        const path = args.path;
                                        const diff = args.diff;
                                        if (!path || !diff) { return 'Error: path and diff are required'; }
                                        // SEC-4: Validate path is within workspace
                                        assertWithinWorkspace(path, this.workspaceContextService);
                                        // P0-5 FIX: Stage in memory, don't apply diff directly
                                        const editUri = URI.file(path);
                                        await this.pendingChanges.stageEdit(editUri, diff);
                                        return `Edit staged: ${path}. Review and accept/reject in diff view.`;
                                }

                                case 'search_codebase': {
                                        const query = args.query;
                                        if (!query) { return 'Error: query is required'; }
                                        // Delegate to the tool registry which has vector store access
                                        try {
                                                // Use command service to execute via the registry
                                                const toolResult = await this.commandService.executeCommand('kovix.executeTool', 'search_codebase', { query, topK: args.topK ?? 8 });
                                                const raw = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                                                // SEC-6: Sanitise search results to prevent injection
                                                return PromptSanitiser.sanitise(raw);
                                        } catch {
                                                return 'Error: Codebase search unavailable. Qdrant may not be running.';
                                        }
                                }

                                case 'web_search': {
                                        const query = args.query;
                                        if (!query) { return 'Error: query is required'; }
                                        // Delegate to the tool registry which handles online mode
                                        try {
                                                const toolResult = await this.commandService.executeCommand('kovix.executeTool', 'web_search', { query, num: args.num ?? 10 });
                                                const raw = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                                                // SEC-6: Sanitise web search results to prevent injection
                                                // SEC-7: Redact secrets from web content
                                                return PromptSanitiser.sanitise(redactSecrets(raw));
                                        } catch {
                                                return 'Error: Web search unavailable. Enable online mode in settings.';
                                        }
                                }

                                default: {
                                        // BUG 7 FIX: Check if this is an MCP tool call (format: serverName__toolName)
                                        // Split only on the FIRST __ to handle tool names that contain __
                                        const separatorIndex = name.indexOf('__');
                                        if (separatorIndex !== -1) {
                                                const serverName = name.slice(0, separatorIndex);
                                                const toolName = name.slice(separatorIndex + 2);
                                                try {
                                                        const result = await this.mcpServerManager.executeTool(serverName, toolName, args);
                                                        const raw = typeof result === 'string' ? result : JSON.stringify(result);
                                                        // SEC-6: Sanitise MCP tool output to prevent injection
                                                        // SEC-7: Redact secrets from MCP output
                                                        return PromptSanitiser.sanitise(redactSecrets(raw));
                                                } catch (err: unknown) {
                                                        return 'Error: MCP tool ' + name + ' failed: ' + (err instanceof Error ? err.message : String(err));
                                                }
                                        }
                                        return 'Error: Unknown tool: ' + name;
                                }
                        }
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        return `Error: ${msg}`;
                }
        }

        /**
         * Phase 1.2 — Real verification harness.
         *
         * Runs a harness-controlled check (NOT an LLM-controlled one) to confirm
         * the agent's "done" claim. Detection order:
         *   1. package.json scripts.test  →  `npm test`
         *   2. package.json scripts.build  →  `npm run build`
         *   3. package.json scripts.typecheck  →  `npm run typecheck`
         *   4. tsconfig.json present  →  `npx tsc --noEmit`
         *   5. nothing found  →  yield verification_result with unverified=true
         *
         * The loop MUST pass through this before reaching PausedAtMilestone or
         * Complete. Verifying is harness-controlled — the agent cannot
         * self-report its way out of it.
         */
        private async *runVerification(signal?: AbortSignal): AsyncGenerator<AgentLoopEvent> {
                this._executionState = ExecutionState.Verifying;
                this.logService.info('[AgentLoop] Entering Verifying state — running harness check');

                const detection = await this.detectVerificationCommand();

                if (!detection.command) {
                        // No test/build/typecheck available — mark unverified, do not fail.
                        // The UI surfaces a distinct warning-toned badge so the user knows
                        // the agent's "done" claim was NOT backed by a real check.
                        this.logService.info(`[AgentLoop] No verification command available (${detection.reason}); marking milestone unverified`);
                        yield {
                                type: 'verification_result',
                                passed: true,
                                output: `unverified:no-command — ${detection.reason}`,
                                unverified: true,
                        };
                        return;
                }

                yield { type: 'verification_start', command: detection.command };

                const cwd = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                try {
                        const execResult = await this.terminalExecutor.execute(
                                detection.command,
                                cwd,
                                120_000, // 2-minute timeout -- tests shouldn't run forever
                                signal
                        );
                        let passed = execResult.exitCode === 0;
                        let output = `--- verification command: ${detection.command} (${detection.reason}) ---\n--- stdout (last 4KB) ---\n${execResult.stdout.slice(-4096)}\n--- stderr (last 4KB) ---\n${execResult.stderr.slice(-4096)}\n--- exit code: ${execResult.exitCode} ---`;

                        // Phase 3: Execution sanity check on the verification result.
                        // This is the critical hallucinated-success detector -- if the
                        // verification command exited 0 but the output is suspicious
                        // (empty, contains 'error' in stderr, missing build artifacts
                        // for build commands), we override `passed` to false and route
                        // the failure through AgentErrorRecoveryService as a
                        // 'verification_failed' error.
                        //
                        // We run both validateCommandResult (general sanity) and, if the
                        // detected command looks like a build (npm run build, tsc),
                        // validateBuildResult (artifact presence check). Either one
                        // returning Critical/Fail flips the result.
                        try {
                                const cmdChecks = this.executionSanity.validateCommandResult(
                                        detection.command,
                                        execResult.exitCode,
                                        execResult.stdout,
                                        execResult.stderr,
                                );
                                const suspicious = cmdChecks.filter(
                                        c => c.severity === SanitySeverity.Critical || c.severity === SanitySeverity.Fail
                                );
                                if (suspicious.length > 0) {
                                        passed = false;
                                        const findings = suspicious
                                                .map(c => `[Sanity ${c.severity}] ${c.checkName}: ${c.message}`)
                                                .join('\n');
                                        output += `\n\n--- Execution Sanity Findings (override: verification FAILED despite exit 0) ---\n${findings}\n--- End Sanity Findings ---`;
                                        this.logService.warn(`[AgentLoop][ExecutionSanity] Verification flagged as hallucinated success despite exit ${execResult.exitCode}:\n${findings}`);
                                }

                                // Run build-result validation too if the command looks like a build.
                                // This adds artifact-presence checks (dist/, build/, out/) on top
                                // of the generic command-output checks above.
                                const looksLikeBuild = /(^|\s)(build|tsc|compile|webpack|vite|rollup)(\s|$)/i.test(detection.command);
                                if (looksLikeBuild) {
                                        const buildChecks = this.executionSanity.validateBuildResult(
                                                execResult.exitCode,
                                                `${execResult.stdout}\n${execResult.stderr}`,
                                        );
                                        const buildFail = buildChecks.filter(
                                                c => c.severity === SanitySeverity.Critical || c.severity === SanitySeverity.Fail
                                        );
                                        if (buildFail.length > 0) {
                                                passed = false;
                                                const findings = buildFail
                                                        .map(c => `[Sanity ${c.severity}] ${c.checkName}: ${c.message}`)
                                                        .join('\n');
                                                output += `\n\n--- Build Sanity Findings (override: verification FAILED despite exit 0) ---\n${findings}\n--- End Build Sanity Findings ---`;
                                                this.logService.warn(`[AgentLoop][ExecutionSanity] Build verification flagged as hallucinated success:\n${findings}`);
                                        }
                                }
                        } catch (sanityErr) {
                                // Sanity checks must never break verification. Log and proceed
                                // with the raw exit-code-based result.
                                this.logService.warn(`[AgentLoop][ExecutionSanity] Verification sanity check threw: ${sanityErr instanceof Error ? sanityErr.message : String(sanityErr)}`);
                        }

                        this.logService.info(`[AgentLoop] Verification ${passed ? 'PASSED' : 'FAILED'} (exit ${execResult.exitCode})`);
                        yield { type: 'verification_result', passed, output };
                } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        this.logService.warn(`[AgentLoop] Verification command crashed: ${errMsg}`);
                        yield {
                                type: 'verification_result',
                                passed: false,
                                output: `verification command crashed: ${errMsg}`,
                        };
                }
        }

        /**
         * Phase 1.2 helper — detect which verification command to run for the
         * current workspace. Returns { command, reason } or { command: null, reason }
         * if no test/build/typecheck command exists.
         */
        private async detectVerificationCommand(): Promise<{ command: string | null; reason: string }> {
                const folder = this.workspaceContextService.getWorkspace().folders[0];
                if (!folder) {
                        return { command: null, reason: 'no workspace folder open' };
                }

                // Try package.json scripts.{test,build,typecheck}
                try {
                        const pkgUri = URI.joinPath(folder.uri, 'package.json');
                        const stat = await this.fileService.readFile(pkgUri);
                        const pkg = JSON.parse(stat.value.toString()) as { scripts?: Record<string, string> };
                        if (pkg.scripts?.test && !pkg.scripts.test.includes('No tests specified' as string)) {
                                return { command: 'npm test', reason: 'package.json scripts.test' };
                        }
                        if (pkg.scripts?.build) {
                                return { command: 'npm run build', reason: 'package.json scripts.build' };
                        }
                        if (pkg.scripts?.typecheck) {
                                return { command: 'npm run typecheck', reason: 'package.json scripts.typecheck' };
                        }
                } catch {
                        // No package.json or invalid JSON — fall through to tsconfig check
                }

                // Fallback: tsc --noEmit if tsconfig.json exists
                try {
                        const tsconfigUri = URI.joinPath(folder.uri, 'tsconfig.json');
                        await this.fileService.readFile(tsconfigUri);
                        return { command: 'npx tsc --noEmit', reason: 'tsconfig.json present (no package.json scripts)' };
                } catch {
                        // No tsconfig either
                }

                return { command: null, reason: 'no package.json scripts and no tsconfig.json — workspace has no automated check' };
        }

        /**
         * Build the system prompt with memory context injected.
         * Calls memoryOrchestrator.injectContextIntoPrompt() to include
         * Supermemory persistent context and local four-layer memory.
         */
        private async buildSystemPrompt(task: string, planningOnly: boolean): Promise<string> {
                const workspacePath = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '.';
                const date = new Date().toISOString().split('T')[0];

                const mode = planningOnly ? 'PLANNING MODE -- use only read_file and list_directory to explore the workspace. Do NOT make any changes.' : '';

                let prompt = `You are Kovix, an expert AI coding assistant.

${mode}

Working directory: ${workspacePath}
Current date: ${date}

Guidelines:
- Always read relevant existing files before making changes
- Write complete, working code -- never truncate with "// ... rest of file"
- Prefer running commands over asking the user to run them
- After writing files or making changes, verify by RUNNING the relevant command
  (tests, build, type-check, or the actual feature) and reading its real output.
  Reading a file back to confirm its contents were written is NOT verification —
  it only proves the write syscall succeeded, not that the code works.
- Never claim a task is complete, fixed, or passing without having run the
  verification command in this same turn and seen its exit code / output.
  The Iron Law: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
  If you haven't run the verification command in this turn, you cannot claim
  it passes — "should work", "probably fixed", "I'm confident" are rationalizations,
  not evidence. See the Common Failures table below.
- If no test or build command exists for what you changed, say so explicitly and
  mark the result as "unverified" rather than implying it was checked.
- Keep the user informed with brief status messages
- If task requires installing dependencies, do it
- Always think about what could go wrong and handle it

Common Failures table (do not reproduce these patterns):
  | Claim                  | Requires                                  | Not Sufficient                  |
  |------------------------|-------------------------------------------|---------------------------------|
  | Tests pass             | Test command output: 0 failures           | Previous run, "should pass"     |
  | Build succeeds         | Build command: exit 0                     | Linter passing, logs look good  |
  | Bug fixed              | Test original symptom: passes             | Code changed, assumed fixed     |
  | Agent completed        | VCS diff shows changes                    | Agent reports "success"         |
  | Requirements met       | Line-by-line checklist                    | Tests passing                   |

Engineering discipline (Karpathy four principles):
  1. Think Before Coding — state assumptions explicitly. If multiple interpretations
     exist, present them; don't pick silently. If a simpler approach exists, say so.
  2. Simplicity First — minimum code that solves the problem. No speculative
     abstractions, no "flexibility" that wasn't requested, no error handling for
     impossible scenarios. If 200 lines could be 50, rewrite.
  3. Surgical Changes — touch only what you must. Don't "improve" adjacent code.
     Match existing style. Every changed line should trace directly to the request.
  4. Goal-Driven Execution — define a verifiable success criterion before starting.
     "Fix the bug" → "write a test that reproduces it, then make it pass".

Ponytail discipline (DEFAULT: full):
  YAGNI ladder applies — stdlib before deps, native before custom, one line before
  fifty. Don't introduce unrequested abstractions. If the user didn't ask for a
  framework, plugin system, or config layer, don't add one. Escalate to bigger
  architecture only when the task explicitly requires it.`;

                // Inject memory context from MemoryOrchestrator (Supermemory + local layers)
                // SEC-6: Sanitise memory context before injection to prevent prompt injection
                if (this.memoryOrchestrator) {
                        try {
                                const projectId = this.workspaceContextService.getWorkspace().folders[0]?.name ?? 'default';
                                prompt = await this.memoryOrchestrator.injectContextIntoPrompt(prompt, projectId);
                                // SEC-6: Sanitise the entire prompt after memory injection
                                // We only sanitise the memory-injected portion, not the system prompt itself
                        } catch (error) {
                                this.logService.warn('[AgentLoop] Memory context injection failed, using base prompt:', error instanceof Error ? error.message : String(error));
                        }
                }

                // Inject universal memory context (cross-project knowledge)
                if (this.universalMemory) {
                        try {
                                const universalContext = await this.universalMemory.getContextForTask(task, 5);
                                if (universalContext) {
                                        // SEC-7 (H3 fix): Sanitise memory context before injection.
                                        // Previous code concatenated universalMemory context RAW
                                        // into the system prompt, bypassing the PromptSanitiser
                                        // applied to file reads / search results / terminal output.
                                        // A memory entry containing "ignore previous instructions"
                                        // or a prompt-injection payload scraped from a web page
                                        // would land in the system prompt verbatim.
                                        prompt += `\n\n[Universal Knowledge]\n${PromptSanitiser.sanitise(universalContext)}`;
                                }
                        } catch (error) {
                                this.logService.warn('[AgentLoop] Universal memory context injection failed:', error instanceof Error ? error.message : String(error));
                        }
                }

                // Inject auto-discovered skills (Kovix v1.4.0)
                // The skill registry ranks all enabled skills against the task
                // description and returns the top-K as a single string. This
                // lets the agent invoke /<slug> or follow the playbook inline
                // without the user having to remember which skill exists.
                if (this.skillRegistry) {
                        try {
                                const skillContext = await this.skillRegistry.getContextForTask(task, 3);
                                if (skillContext) {
                                        // SEC-7 (H3 fix): Sanitise skill context too — skills can
                                        // come from cloned repos or the marketplace and may contain
                                        // prompt-injection payloads. The PromptSanitiser wraps the
                                        // content in safety delimiters and filters known injection
                                        // prefixes. Defense-in-depth: the user should still review
                                        // any /<slug> invocation before the agent acts on it.
                                        prompt += PromptSanitiser.sanitise(skillContext);
                                }
                        } catch (error) {
                                this.logService.warn('[AgentLoop] Skill context injection failed:', error instanceof Error ? error.message : String(error));
                        }
                }

                return prompt;
        }

        /**
         * Parse a plan from the LLM's text response.
         */
        private parsePlan(response: string): IPlanStep[] {
                const steps: IPlanStep[] = [];
                const lines = response.split('\n');

                let stepIndex = 0;
                for (const line of lines) {
                        // Match lines like "1. [Read] src/App.tsx" or "[Create] new-file.tsx"
                        const match = line.match(/^\s*\d+\.?\s*\[(Read|Create|Edit|Run)\]\s*(.+)/i);
                        if (match) {
                                const action = (match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()) as IPlanStep['action'];
                                const target = match[2].trim();
                                steps.push({
                                        index: stepIndex++,
                                        action,
                                        target,
                                        description: line.trim(),
                                });
                        }
                }

                // If no structured steps found, create a generic plan
                if (steps.length === 0) {
                        steps.push({
                                index: 0,
                                action: 'Read',
                                target: 'workspace',
                                description: response.substring(0, 200),
                        });
                }

                return steps;
        }

        /**
         * Refresh the file explorer after file writes.
         * Uses multiple fallback strategies for reliability across contexts.
         */
        private async refreshExplorer(): Promise<void> {
                try {
                        // Primary: Kovix IDE command
                        await this.commandService.executeCommand('workbench.files.action.refreshFilesExplorer');
                } catch {
                        // Fallback: stat the workspace root to trigger file watcher
                        try {
                                const rootUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                                if (rootUri) {
                                        await this.fileService.stat(rootUri);
                                }
                        } catch {
                                // Non-critical -- file explorer will refresh eventually via watchers
                        }
                }
        }

        override dispose(): void {
                super.dispose();
        }
}
