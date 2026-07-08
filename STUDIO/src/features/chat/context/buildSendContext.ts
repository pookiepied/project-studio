import type { APIChatMessage } from "@/services/ai/types";
import type { FileAttachment } from "@/services/files/fileAttachmentService";
import type { ChatConversation } from "@/types";
import type { ConversationStorageScope } from "@/services/storage/chatHistoryService";
import { memorySystem } from "@/services/storage/memorySystem";
import { indexDocumentForRAG, buildRAGAnnotation, DOC_RAG_THRESHOLD } from "@/services/files/docIndexService";
import { getContextMessages, loadConversation } from "@/services/storage/chatHistoryService";
import { buildApiMessages, pruneContextByTokens, applyAllSystemMessages, prependProjectContextToLastUser } from "./messageBuilder";
import { getMcpServers } from "./buildChatRequest";
import { MAX_CONTEXT_MESSAGES } from "./constants";

export interface SendContextParams {
  convId: string;
  userContent: string;
  attachments: FileAttachment[];
  model: string;
  isMemoryEnabled: boolean;
  projectContext: { path: string; name: string } | null;
  storageScope: ConversationStorageScope;
  imageModel: string;
  videoModel: string;
  silentPrompt: boolean;
  silentDocPrompt: boolean;
  apiContent: string;
  getContextLimit: (model: string) => number;
  setContextTokens: (n: number) => void;
  setContextLimit: (n: number) => void;
}

export interface SendContextResult {
  prunedMessages: APIChatMessage[];
  runningMcpServers: string[];
  freshConv: ChatConversation | null;
}

export async function buildSendContext({
  convId,
  userContent,
  attachments,
  model,
  isMemoryEnabled,
  projectContext,
  storageScope,
  imageModel,
  videoModel,
  silentPrompt,
  silentDocPrompt,
  apiContent,
  getContextLimit,
  setContextTokens,
  setContextLimit,
}: SendContextParams): Promise<SendContextResult> {
  // ── RAG indexing ────────────────────────────────────────────────────────
  const ragIndexedIds = new Set<string>();
  const ragDocs: Array<{ fileName: string; chunkCount: number; sessionId: string; truncated: boolean }> = [];
  const largeTextAtts = attachments.filter(
    (a) => !a.isImage && !a.pdfPageImages?.length && a.content && a.content.length > DOC_RAG_THRESHOLD
  );
  if (largeTextAtts.length > 0) {
    const results = await Promise.allSettled(
      largeTextAtts.map((a) => indexDocumentForRAG(a.content!, a.name, convId))
    );
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        ragIndexedIds.add(largeTextAtts[i].id);
        ragDocs.push({
          fileName: largeTextAtts[i].name,
          chunkCount: r.value.chunkCount,
          sessionId: convId,
          truncated: r.value.truncated,
        });
      }
    });
  }

  // ── Assemble context messages ────────────────────────────────────────────
  const contextMessages = await getContextMessages(convId, MAX_CONTEXT_MESSAGES);
  const apiMessages: APIChatMessage[] = contextMessages.map((m) => ({
    role: m.role, content: m.content,
  }));

  if (silentPrompt || silentDocPrompt) {
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === "user") { apiMessages[i].content = apiContent; break; }
    }
  }

  // Inject inline text attachments
  const textAtts = attachments.filter((a) => !a.isImage && a.content && !ragIndexedIds.has(a.id));
  if (textAtts.length > 0) {
    let lastUserIdx = -1;
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx >= 0) {
      const attContent = textAtts.map((a) =>
        a.isPDF
          ? `${a.contextPrompt}\n\n${a.content}`
          : `${a.contextPrompt}\n\`\`\`${a.extension.slice(1)}\n${a.content}\n\`\`\``
      ).join("\n\n");
      apiMessages[lastUserIdx].content += "\n\n" + attContent;
    }
  }

  // RAG annotation
  if (ragDocs.length > 0) {
    let lastUserIdx = -1;
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx >= 0) {
      apiMessages[lastUserIdx].content =
        buildRAGAnnotation(ragDocs) + "\n\n" + apiMessages[lastUserIdx].content;
    }
  }

  // Memory context injection
  if (isMemoryEnabled) {
    try {
      const memCtx = await memorySystem.getMemoryContext(userContent, convId);
      if (memCtx) {
        const sysIdx = apiMessages.findIndex((m) => m.role === "system");
        if (sysIdx >= 0) apiMessages[sysIdx].content += memCtx;
        else apiMessages.unshift({ role: "system", content: `You are a helpful AI assistant.${memCtx}` });
      }
    } catch {
      /* memory context is optional */
    }
  }

  // ── Summarisation + context window ──────────────────────────────────────
  const freshConv = await loadConversation(convId);
  const baseMessages = freshConv
    ? await buildApiMessages(freshConv, model, getContextLimit, setContextTokens, setContextLimit)
    : apiMessages;

  // Reconcile attachment mutations with buildApiMessages output.
  // buildApiMessages re-loads messages from storage, so inline content edits
  // (silent prompts, injected attachments, RAG) need to be re-applied to its output.
  let finalBaseMessages = baseMessages;
  if (
    (silentPrompt || silentDocPrompt || textAtts.length > 0 || ragDocs.length > 0 || !!projectContext) &&
    apiMessages.length > 0
  ) {
    const lastUserIdx = apiMessages.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);
    const baseLastUserIdx = finalBaseMessages.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);
    if (lastUserIdx >= 0 && baseLastUserIdx >= 0) {
      finalBaseMessages = finalBaseMessages.map((m, i) =>
        i === baseLastUserIdx ? { ...m, content: apiMessages[lastUserIdx].content } : m
      );
    }
  }

  finalBaseMessages = prependProjectContextToLastUser(finalBaseMessages, projectContext);

  // ── System messages + pruning ───────────────────────────────────────────
  const runningMcpServers = await getMcpServers(storageScope);

  const enhanced = applyAllSystemMessages(
    finalBaseMessages, runningMcpServers,
    imageModel, videoModel, projectContext
  );
  const prunedMessages = pruneContextByTokens(enhanced, getContextLimit(model));

  return { prunedMessages, runningMcpServers, freshConv };
}
