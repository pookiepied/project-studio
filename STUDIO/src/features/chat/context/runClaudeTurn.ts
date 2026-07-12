/**
 * Claude Code (CLI bridge) turn driver.
 *
 * Extracted verbatim from ChatProvider. This owns one turn against the local
 * Claude Code binary: it streams the CLI's JSON event protocol, mirrors the
 * events into chat state (text deltas, thinking blocks, tool cards, harness
 * segments), and persists the evolving session metadata.
 *
 * This is the *other* engine — the Studio engine goes over the Local Runtime's
 * WebSocket (`@/runtime`). Both funnel into the same `handleStreamDone`.
 *
 * It is a plain async function over an explicit dependency bundle rather than a
 * hook, so the provider stays a composition and this stays testable.
 */

import { claudeBridgeService } from "@/features/chat/services/claudeBridgeService";
import { effortToThinkingBudget } from "@/cliBridges";
import type { ClaudeEffortLevel, ChatEngine } from "@/cliBridges/types";
import { logger } from "@/core/logging/logger";
import { classifyToolDisplay } from "@/runtime";
import { buildHarnessEvent } from "@/lib/harnessEventUtils";
import type { PermissionModeId } from "@/core/permissions";
import type { ChatConversation, ClaudeSessionMetadata, MessageSegment } from "@/types";
import type { ActiveToolCall } from "./types";

/** Maps Claude Code's tool names onto the runtime's tool-card vocabulary. */
export function mapClaudeToolName(tool: string): string {
  const lowered = tool.toLowerCase();
  if (lowered === "bash") return "bash";
  if (lowered === "powershell") return "powershell";
  if (lowered === "read") return "read_file";
  if (lowered === "edit") return "edit_file";
  if (lowered === "write") return "write_file";
  if (lowered === "glob") return "glob";
  if (lowered === "grep") return "grep";
  return lowered;
}

export interface ClaudeTurnDeps {
  // ── Turn inputs ────────────────────────────────────────────────────────
  activeConversation: ChatConversation;
  prompt: string;
  optimisticAssistantId: string;

  // ── Session / settings snapshot ────────────────────────────────────────
  autopilotMode: boolean;
  claudePermissionMode: PermissionModeId;
  claudeEffortLevel: ClaudeEffortLevel;
  claudeModel: string;
  claudeSession: ClaudeSessionMetadata | null;
  projectContextPath: string | null;

  // ── Turn-scoped accumulators (owned by the provider) ────────────────────
  activeConversationIdRef: React.MutableRefObject<string>;
  optimisticAssistantIdRef: React.MutableRefObject<string>;
  fullContentRef: React.MutableRefObject<string>;
  pendingSegmentTextRef: React.MutableRefObject<string>;
  latestStreamingContentRef: React.MutableRefObject<string>;
  thinkingContentRef: React.MutableRefObject<string>;
  harnessSegmentsRef: React.MutableRefObject<MessageSegment[]>;
  handleStreamDoneRef: React.MutableRefObject<(() => Promise<void>) | null>;

  // ── State writers ──────────────────────────────────────────────────────
  resetStreamingState: (optimisticAssistantId: string, existingContent?: string) => void;
  scheduleStreamingContentUpdate: (next: string) => void;
  setActiveToolCalls: React.Dispatch<React.SetStateAction<ActiveToolCall[]>>;
  setHarnessSegments: React.Dispatch<React.SetStateAction<MessageSegment[]>>;
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
  setThinkingContent: React.Dispatch<React.SetStateAction<string>>;
  setClaudeSession: React.Dispatch<React.SetStateAction<ClaudeSessionMetadata | null>>;
  setClaudeModelState: React.Dispatch<React.SetStateAction<string>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  persistConversationMetadata: (
    conv: ChatConversation,
    provider: ChatEngine,
    nextClaude?: ClaudeSessionMetadata | null
  ) => Promise<ChatConversation>;
  /** Tears the turn down to idle and surfaces `message` to the user. */
  failStreamingTurn: (message: string) => void;
}

export async function runClaudeTurn(deps: ClaudeTurnDeps): Promise<void> {
  const {
    activeConversation,
    prompt,
    optimisticAssistantId,
    autopilotMode,
    claudePermissionMode,
    claudeEffortLevel,
    claudeModel,
    claudeSession,
    projectContextPath,
    activeConversationIdRef,
    optimisticAssistantIdRef,
    fullContentRef,
    pendingSegmentTextRef,
    latestStreamingContentRef,
    thinkingContentRef,
    harnessSegmentsRef,
    handleStreamDoneRef,
    resetStreamingState,
    scheduleStreamingContentUpdate,
    setActiveToolCalls,
    setHarnessSegments,
    setStreamingContent,
    setThinkingContent,
    setClaudeSession,
    setClaudeModelState,
    setIsLoading,
    persistConversationMetadata,
    failStreamingTurn,
  } = deps;

  const bridgeSessionId = `claude-turn-${Date.now()}`;
  const permissionMode: PermissionModeId = autopilotMode
    ? "bypassPermissions"
    : claudePermissionMode;
  const cwd = projectContextPath || claudeSession?.cwd || undefined;
  const resume = claudeSession?.sessionId || undefined;
  const seenTextDeltas = { current: false };
  let finalExitCode = 0;

  activeConversationIdRef.current = activeConversation.id;
  optimisticAssistantIdRef.current = optimisticAssistantId;
  resetStreamingState(optimisticAssistantId);

  const completeClaudeTool = (toolUseId: string, rawResult: unknown) => {
    setActiveToolCalls((prev) =>
      prev.map((tc) =>
        tc.callId === toolUseId ? { ...tc, status: "complete", result: rawResult } : tc
      )
    );
  };

  try {
    await claudeBridgeService.runTurn({
      sessionId: bridgeSessionId,
      prompt,
      cwd,
      resume,
      model: resume ? undefined : claudeModel,
      permissionMode,
      thinkingBudget: effortToThinkingBudget(claudeEffortLevel),
      onLine: async (line, stream) => {
        if (stream === "stderr") {
          logger.warn("ClaudeBridge", "stderr", line);
          return;
        }

        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          logger.warn("ClaudeBridge", "Failed to parse Claude stream line", line);
          return;
        }

        if (event.type === "stream_event") {
          const delta = event.event?.delta;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            seenTextDeltas.current = true;
            fullContentRef.current += delta.text;
            pendingSegmentTextRef.current += delta.text;
            scheduleStreamingContentUpdate(pendingSegmentTextRef.current);
          }
          return;
        }

        if (event.type === "system" && event.subtype === "init") {
          const nextClaude: ClaudeSessionMetadata = {
            ...(claudeSession ?? {}),
            sessionId: event.session_id,
            model: event.model ?? claudeModel,
            permissionMode: event.permissionMode ?? permissionMode,
            effortLevel: claudeEffortLevel,
            cwd: event.cwd ?? cwd,
            lastTurnAt: Date.now(),
          };
          setClaudeSession(nextClaude);
          setClaudeModelState(nextClaude.model ?? claudeModel);
          await persistConversationMetadata(activeConversation, "claude", nextClaude);
          return;
        }

        if (event.type === "rate_limit_event") {
          setClaudeSession((prev) => {
            const next = {
              ...(prev ?? {}),
              rateLimit: event.rate_limit_info,
              lastTurnAt: Date.now(),
            };
            persistConversationMetadata(activeConversation, "claude", next).catch(() => {});
            return next;
          });
          return;
        }

        if (event.type === "system" && event.subtype === "thinking_tokens") {
          // Token-count pings carry no real reasoning text. Showing a fake
          // "Thinking… N" placeholder is misleading and lingered after the
          // turn finished. We only surface genuine `thinking` content blocks
          // (handled below), so ignore this signal entirely.
          return;
        }

        if (event.type === "assistant" && Array.isArray(event.message?.content)) {
          // Claude assistant events carry a MULTI-block content array
          // (e.g. [thinking, text], [text, tool_use], several tool_use in one
          // event). Iterate every block — inspecting only content[0] silently
          // dropped later tool_use blocks, which is what made tool steps go
          // missing / appear out of order.
          for (const block of event.message.content) {
            if (block?.type === "thinking" && typeof block.thinking === "string") {
              thinkingContentRef.current = block.thinking;
              setThinkingContent(block.thinking);
              continue;
            }

            if (block?.type === "tool_use") {
              const toolName = mapClaudeToolName(block.name ?? "tool");
              const args = (block.input ?? {}) as Record<string, unknown>;
              const displayClass = classifyToolDisplay(toolName);
              setActiveToolCalls((prev) => [
                ...prev.filter((item) => item.callId !== block.id),
                {
                  callId: block.id,
                  tool: toolName,
                  args,
                  status: "running",
                  displayClass,
                },
              ]);

              if (displayClass === "stream") {
                const pendingText = pendingSegmentTextRef.current;
                if (pendingText) {
                  harnessSegmentsRef.current = [
                    ...harnessSegmentsRef.current,
                    { type: "text", content: pendingText },
                  ];
                  pendingSegmentTextRef.current = "";
                  setStreamingContent("");
                  latestStreamingContentRef.current = "";
                }
                harnessSegmentsRef.current = [
                  ...harnessSegmentsRef.current,
                  { type: "harness_event", event: buildHarnessEvent(block.id, toolName, args, "running") },
                ];
                setHarnessSegments([...harnessSegmentsRef.current]);
              }
              continue;
            }
          }

          // Text snapshot fallback — only when we haven't been receiving live
          // text deltas (which are the normal streaming path).
          if (!seenTextDeltas.current) {
            const textBlock = event.message.content.find((item: any) => item.type === "text");
            if (typeof textBlock?.text === "string" && textBlock.text) {
              fullContentRef.current = textBlock.text;
              pendingSegmentTextRef.current = textBlock.text;
              scheduleStreamingContentUpdate(textBlock.text);
            }
          }
          return;
        }

        if (event.type === "user" && Array.isArray(event.message?.content)) {
          // A single user event can batch multiple tool_result blocks; iterate
          // all of them so every matching card is marked complete (only reading
          // content[0] left later tools stuck showing "running").
          let changed = false;
          for (const block of event.message.content) {
            if (block?.type !== "tool_result" || !block.tool_use_id) continue;
            const result = event.tool_use_result ?? block.content;
            completeClaudeTool(block.tool_use_id, result);
            harnessSegmentsRef.current = harnessSegmentsRef.current.map((segment) => {
              if (segment.type !== "harness_event" || segment.event.callId !== block.tool_use_id) return segment;
              changed = true;
              return {
                type: "harness_event" as const,
                event: buildHarnessEvent(
                  block.tool_use_id,
                  segment.event.tool,
                  segment.event.args,
                  "complete",
                  result
                ),
              };
            });
          }
          if (changed) setHarnessSegments([...harnessSegmentsRef.current]);
          return;
        }

        if (event.type === "result") {
          const turnCost = typeof event.total_cost_usd === "number" ? event.total_cost_usd : undefined;
          // Real usage from the model's own accounting — the ground truth that
          // includes the system prompt, skills, tools, and every file-read
          // result the estimate can't see.
          const usage = (event.usage ?? {}) as Record<string, unknown>;
          const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
          const nextClaude: ClaudeSessionMetadata = {
            ...(claudeSession ?? {}),
            sessionId: event.session_id ?? claudeSession?.sessionId,
            model: claudeModel,
            permissionMode,
            cwd,
            lastCostUsd: turnCost ?? claudeSession?.lastCostUsd,
            lastDurationMs: typeof event.duration_ms === "number" ? event.duration_ms : claudeSession?.lastDurationMs,
            lastInputTokens: num(usage.input_tokens) ?? claudeSession?.lastInputTokens,
            lastOutputTokens: num(usage.output_tokens) ?? claudeSession?.lastOutputTokens,
            lastCacheReadTokens: num(usage.cache_read_input_tokens) ?? claudeSession?.lastCacheReadTokens,
            lastCacheCreationTokens: num(usage.cache_creation_input_tokens) ?? claudeSession?.lastCacheCreationTokens,
            // Cumulative per-conversation spend — what the composer shows.
            totalCostUsd: (claudeSession?.totalCostUsd ?? 0) + (turnCost ?? 0),
            lastTurnAt: Date.now(),
            rateLimit: claudeSession?.rateLimit,
          };
          setClaudeSession(nextClaude);
          await persistConversationMetadata(activeConversation, "claude", nextClaude);
        }
      },
      onExit: (code) => {
        finalExitCode = code;
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failStreamingTurn(message);
    return;
  }

  if (finalExitCode !== 0 && !fullContentRef.current.trim()) {
    failStreamingTurn("Claude stopped before returning a response.");
    return;
  }

  await handleStreamDoneRef.current?.();
  // Claude turns own their own loading lifecycle (no agentChat onLoadingChange
  // callback). Without this, isLoading stayed true after a successful turn and
  // the "Thinking…" dot bubble reappeared once streaming flags cleared.
  setIsLoading(false);
}
