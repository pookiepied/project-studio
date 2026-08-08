import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/core/logging/logger";

type ClaudePermissionMode =
  | "default"
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "dontAsk"
  | "plan";

interface ClaudeBridgeStreamEvent {
  sessionId: string;
  text: string;
  stream: "stdout" | "stderr";
}

interface ClaudeBridgeExitEvent {
  sessionId: string;
  code: number;
}

interface ClaudeBridgeTurnOptions {
  sessionId: string;
  prompt: string;
  cwd?: string;
  resume?: string;
  model?: string;
  permissionMode?: ClaudePermissionMode;
  /** Extended-thinking token budget — exported as MAX_THINKING_TOKENS to the CLI. */
  thinkingBudget?: number;
  onLine: (line: string, stream: "stdout" | "stderr") => void;
  onExit?: (code: number) => void;
}

class ClaudeBridgeService {
  private activeSessionId: string | null = null;

  async runTurn(options: ClaudeBridgeTurnOptions): Promise<void> {
    const { sessionId, prompt, cwd, resume, model, permissionMode, thinkingBudget, onLine, onExit } = options;
    this.activeSessionId = sessionId;

    const unlisteners: UnlistenFn[] = [];

    try {
      unlisteners.push(await listen<ClaudeBridgeStreamEvent>("claude-bridge-output", (event) => {
        if (event.payload.sessionId !== sessionId) return;
        onLine(event.payload.text, event.payload.stream);
      }));

      unlisteners.push(await listen<ClaudeBridgeExitEvent>("claude-bridge-exit", (event) => {
        if (event.payload.sessionId !== sessionId) return;
        onExit?.(event.payload.code);
      }));

      await invoke("claude_bridge_start", {
        sessionId,
        prompt,
        cwd,
        resume,
        model,
        permissionMode,
        thinkingBudget,
      });
    } finally {
      for (const unlisten of unlisteners) {
        try {
          unlisten();
        } catch (error) {
          logger.warn("ClaudeBridge", "Failed to clean up event listener", error);
        }
      }
      if (this.activeSessionId === sessionId) this.activeSessionId = null;
    }
  }

  async stopActiveTurn(): Promise<void> {
    const sessionId = this.activeSessionId;
    if (!sessionId) return;
    try {
      await invoke("claude_bridge_stop", { sessionId });
    } catch (error) {
      logger.warn("ClaudeBridge", "Failed to stop active Claude turn", error);
    }
  }
}

export const claudeBridgeService = new ClaudeBridgeService();
