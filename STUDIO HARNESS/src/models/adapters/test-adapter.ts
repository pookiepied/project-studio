import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { registerApiProvider, registerProvider } from "@flue/runtime";

import {
  defaultModelReference,
  ModelResolutionError,
  type ModelCapability,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type ModelReference,
} from "../../contracts/models.js";

const api = "project-studio-test";
const piProvider = "project-studio-test";

const TEST_PROVIDER = "project-studio";
const TEST_MODEL = "default";
const CONTEXT_WINDOW = 32_000;
const MAX_OUTPUT_TOKENS = 4_096;

const TEST_CAPABILITY: ModelCapability = {
  textGeneration: "supported",
  streaming: "supported",
  reasoning: "unsupported",
  toolCalling: "supported",
  vision: "unsupported",
  embeddings: "unsupported",
  reranking: "unsupported",
  imageGeneration: "unsupported",
  videoGeneration: "unsupported",
  speechGeneration: "unsupported",
  transcription: "unsupported",
  contextWindow: CONTEXT_WINDOW,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
};

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function createMessage(
  model: Model<Api>,
  content: AssistantMessage["content"] = [],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api,
    provider: piProvider,
    model: model.id,
    usage: emptyUsage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function latestUserText(context: Context): string {
  for (const message of context.messages.toReversed()) {
    if (message.role === "user") {
      return typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
    }
  }
  return "";
}

function hasToolResult(context: Context): boolean {
  return context.messages.some(
    (message) =>
      message.role === "toolResult" &&
      message.toolName === "workspace_summary",
  );
}

function hasAnyToolResult(context: Context): boolean {
  return context.messages.some((message) => message.role === "toolResult");
}

function mcpToolName(context: Context): string | undefined {
  return context.tools?.find((tool) => tool.name.startsWith("mcp__"))?.name;
}

async function waitForDelay(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function stream(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const events = createAssistantMessageEventStream();

  void (async () => {
    try {
      const userText = latestUserText(context);
      if (userText.includes("[slow]")) {
        await waitForDelay(10_000, options?.signal);
      }

      const initial = createMessage(model);
      events.push({ type: "start", partial: initial });

      const mcpName = mcpToolName(context);
      if (userText.toLowerCase().includes("mcp") && mcpName !== undefined && !hasAnyToolResult(context)) {
        const toolCall = {
          type: "toolCall" as const,
          id: "mcp-echo-1",
          name: mcpName,
          arguments: { text: "hello from the model" },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";
        events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
        events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }

      if (
        userText.toLowerCase().includes("workspace") &&
        !hasToolResult(context)
      ) {
        const toolCall = {
          type: "toolCall" as const,
          id: "workspace-summary-1",
          name: "workspace_summary",
          arguments: { workspace: "Project Studio V2" },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";

        events.push({
          type: "toolcall_start",
          contentIndex: 0,
          partial: initial,
        });
        events.push({
          type: "toolcall_end",
          contentIndex: 0,
          toolCall,
          partial: message,
        });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }

      const text = hasToolResult(context)
        ? "Project Studio V2 workspace is ready."
        : hasAnyToolResult(context)
          ? "MCP tool completed."
        : `Echo: ${userText.replace("[slow]", "").trim()}`;
      const partial = createMessage(model, [{ type: "text", text: "" }]);
      let streamedText = "";
      events.push({ type: "text_start", contentIndex: 0, partial });

      for (const chunk of [text.slice(0, 8), text.slice(8)]) {
        streamedText += chunk;
        partial.content = [{ type: "text", text: streamedText }];
        events.push({
          type: "text_delta",
          contentIndex: 0,
          delta: chunk,
          partial,
        });
      }

      const message = createMessage(model, [{ type: "text", text }]);
      events.push({
        type: "text_end",
        contentIndex: 0,
        content: text,
        partial: message,
      });
      events.push({ type: "done", reason: "stop", message });
    } catch (error) {
      const message = createMessage(model);
      message.stopReason = "aborted";
      message.errorMessage =
        error instanceof Error ? error.message : "The request was aborted.";
      events.push({ type: "error", reason: "aborted", error: message });
    }
  })();

  return events;
}

export class TestModelProviderAdapter implements ModelProviderAdapter {
  readonly source = "test" as const;
  readonly operational = true;
  #registered = false;

  register(): void {
    if (this.#registered) {
      return;
    }

    registerApiProvider({
      api,
      stream,
      streamSimple: stream,
    });

    registerProvider(TEST_PROVIDER, {
      api,
      baseUrl: "in-process://project-studio-test",
      contextWindow: CONTEXT_WINDOW,
      maxTokens: MAX_OUTPUT_TOKENS,
    });

    this.#registered = true;
  }

  resolve(reference: ModelReference): ModelDescriptor {
    if (reference.source !== this.source) {
      throw new ModelResolutionError(
        `Model source "${reference.source}" does not match the "${this.source}" adapter.`,
      );
    }
    if (reference.provider !== TEST_PROVIDER || reference.model !== TEST_MODEL) {
      throw new ModelResolutionError(
        `Unknown model "${reference.provider}/${reference.model}" for source "${this.source}".`,
      );
    }

    return {
      source: this.source,
      provider: TEST_PROVIDER,
      model: TEST_MODEL,
      resolvedModelId: `${TEST_PROVIDER}/${TEST_MODEL}`,
      capability: TEST_CAPABILITY,
      operational: true,
    };
  }

  listModels(): readonly ModelDescriptor[] {
    return [this.resolve(defaultModelReference(this.source))];
  }
}
