/**
 * Non-streaming chat operations.
 *
 * Covers: one-shot chat(), rephrase(), chatWithImages() for vision models,
 * and message augmentation helpers for image/PDF attachments.
 *
 * Streaming chat is handled by useAgentChat (WebSocket) or the legacy
 * aiService.chatStream (SSE).  This module is transport-independent.
 */

import { apiClient } from "@/lib/api";
import { APIResponse } from "@/types";
import { getRephrasePrompt, RephraseTone } from "@/lib/prompts";
import { cleanAIResponse, isValidResponse } from "@/lib/responseParser";
import { errorService } from "@/core/errors/errorService";
import { logger } from "@/core/logging/logger";
import { FileAttachment } from "@/features/chat/attachments/fileAttachmentService";
import {
  APIChatMessage,
  ChatRequest,
  ChatResponse,
  extractMessageText,
} from "./types";
import {
  arrayBufferToBase64,
  compressLargeImageForProvider,
  compressImageForMultiAttachment,
  pickImageDetail,
} from "@/features/chat/attachments/inputs/image";
import { isLocalModel, extractLocalModelName } from "./daemonService";
import { reportLocalUsage } from "@/features/models/services/localUsageService";

// ---------------------------------------------------------------------------
// One-shot chat
// ---------------------------------------------------------------------------

export async function chat(
  messages: APIChatMessage[],
  model = "auto",
  options: {
    temperature?: number;
    max_tokens?: number;
    localEngineConnected?: boolean;
    signal?: AbortSignal;
    daemonPort?: number;
    direct?: boolean;
  } = {}
): Promise<APIResponse<string>> {
  const { localEngineConnected = false, signal, daemonPort } = options;

  const cloudMessages = isLocalModel(model)
    ? messages.filter((m) => m.role !== "system")
    : messages;

  const request: ChatRequest = {
    model,
    messages: cloudMessages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens,
    local_engine_connected: localEngineConnected,
    ...(options.direct ? { direct: true } : {}),
  };

  const response = await apiClient.post<any>("/chat/completions", request, signal);

  if (!response.success || !response.data) {
    return { success: false, error: response.error };
  }

  // Cloud returned local_inference_required — call daemon with assembled context
  if (response.data.type === "local_inference_required" && daemonPort) {
    const startedAt = Date.now();
    try {
      const dr = await fetch(
        `http://localhost:${daemonPort}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: response.data.model,
            messages: response.data.messages,
            tools: response.data.tools,
            stream: false,
            temperature: options.temperature ?? 0.7,
            ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
          }),
          signal,
        }
      );
      if (!dr.ok) {
        return { success: false, error: `Daemon error: ${await dr.text()}` };
      }
      const data = (await dr.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      // Report local usage to telemetry (model carries the prefix → engine detected).
      reportLocalUsage({ model, startedAt, usage: data.usage });
      return {
        success: true,
        data: data.choices?.[0]?.message?.content ?? "",
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Daemon unreachable",
      };
    }
  }

  const content =
    extractMessageText(response.data.choices?.[0]?.message?.content) ?? "";
  return { success: true, data: content };
}

// ---------------------------------------------------------------------------
// Rephrase
// ---------------------------------------------------------------------------

const CONVERSATIONAL_PATTERNS = [
  /^i['"]m (just a |)language model/i,
  /^as an ai/i,
  /^i am an ai/i,
  /^i don['"]t have feelings/i,
  /^i cannot/i,
  /^i can['"]t/i,
  /^i['"]ll be happy to help/i,
  /^how['"]s your day/i,
  /^how are you doing today/i,
  /^that['"]s a great question/i,
  /^great question/i,
  /^thank you for asking/i,
  /^i['"]m doing well/i,
  /^i work by/i,
];

export async function rephrase(
  text: string,
  tone: RephraseTone | string = RephraseTone.STANDARD,
  model = "groq:llama-3.1-8b-instant"
): Promise<APIResponse<string>> {
  const systemPrompt = getRephrasePrompt(tone as RephraseTone);
  const temperature = tone === RephraseTone.STANDARD ? 0.2 : 0.3;
  const estimatedInputTokens = Math.ceil(text.length / 4);
  const maxTokens = Math.max(2000, Math.min(estimatedInputTokens * 1.5, 8000));

  const request: ChatRequest = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Rewrite/Rephrase the following text according to the style in the system prompt.

IMPORTANT:
- Never answer questions - ONLY rewrite the text
- Never respond to the content like you're having a conversation
- Never add "How can I help you?" or similar conversational responses
- Output ONLY the rewritten text

Text to rewrite:
"""${text}"""`,
      },
    ],
    temperature,
    max_tokens: maxTokens,
    direct: true,
  };

  const response = await apiClient.post<ChatResponse>("/chat/completions", request);

  if (!response.success || !response.data) {
    return { success: false, error: response.error };
  }

  const rawText =
    extractMessageText(response.data.choices[0]?.message?.content) || "";

  if (CONVERSATIONAL_PATTERNS.some((p) => p.test(rawText.trim()))) {
    return {
      success: false,
      error:
        "AI returned a conversational response instead of rephrased text. Please try again.",
    };
  }

  const cleaned = cleanAIResponse(rawText)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

  if (!isValidResponse(cleaned)) {
    return { success: false, error: "AI returned invalid or empty response" };
  }

  return { success: true, data: cleaned };
}

// ---------------------------------------------------------------------------
// Vision chat
// ---------------------------------------------------------------------------

export async function chatWithImages(
  messages: APIChatMessage[],
  model: string,
  attachments: FileAttachment[]
): Promise<APIResponse<ChatResponse>> {
  try {
    if (isLocalModel(model)) {
      return ollamaChatWithImages(
        messages,
        extractLocalModelName(model),
        attachments
      );
    }

    const processed = await injectImagesIntoLastUserMessage(
      messages,
      attachments
    );
    const response = await apiClient.post<ChatResponse>("/chat/completions", {
      model,
      messages: processed,
      temperature: 0.7,
    });
    if (!response.success || !response.data) {
      return { success: false, error: response.error };
    }
    return { success: true, data: response.data };
  } catch (error) {
    logger.error("chatService", "Image chat error", error);
    const c = errorService.categorize(error);
    return { success: false, error: c.userMessage, errorDetails: c };
  }
}

async function ollamaChatWithImages(
  messages: APIChatMessage[],
  model: string,
  attachments: FileAttachment[]
): Promise<APIResponse<ChatResponse>> {
  const startedAt = Date.now();
  try {
    const processed = await injectImagesIntoLastUserMessage(messages, attachments);
    const response = await fetch("http://localhost:11434/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: processed, temperature: 0.7, stream: false }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
      const c = errorService.categorize((err as any).error?.message);
      return { success: false, error: c.userMessage, errorDetails: c };
    }
    const data = await response.json();
    // model here is already prefix-stripped — tag the engine explicitly.
    reportLocalUsage({ model, startedAt, usage: (data as ChatResponse).usage, engine: "ollama" });
    return { success: true, data };
  } catch (error) {
    logger.error("chatService", "Ollama vision error", error);
    const c = errorService.categorize(error);
    return { success: false, error: c.userMessage, errorDetails: c };
  }
}

// ---------------------------------------------------------------------------
// Message augmentation
// ---------------------------------------------------------------------------

export async function augmentMessagesWithImages(
  messages: APIChatMessage[],
  attachments: FileAttachment[]
): Promise<APIChatMessage[]> {
  const imageAttachments = attachments.filter((a) => a.isImage && a.file);
  if (!imageAttachments.length) return messages;
  return injectImagesIntoLastUserMessage(messages, attachments);
}

export async function augmentMessagesWithPDFImages(
  messages: APIChatMessage[],
  attachments: FileAttachment[]
): Promise<APIChatMessage[]> {
  const pdfAttachments = attachments.filter(
    (a) => a.isPDF && a.pdfPageImages?.length
  );
  if (!pdfAttachments.length) return messages;

  const lastUserIndex = findLastUserIndex(messages);
  if (lastUserIndex < 0) return messages;

  const textContent = extractMessageText(messages[lastUserIndex].content);
  const content: APIChatMessage["content"] = [{ type: "text", text: textContent }];

  for (const attachment of pdfAttachments) {
    for (const base64 of attachment.pdfPageImages!) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "auto" },
      });
    }
  }

  return messages.map((m, i) =>
    i === lastUserIndex ? { ...m, content } : m
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLastUserIndex(messages: APIChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

async function injectImagesIntoLastUserMessage(
  messages: APIChatMessage[],
  attachments: FileAttachment[]
): Promise<APIChatMessage[]> {
  const imageAttachments = attachments.filter((a) => a.isImage && a.file);
  if (!imageAttachments.length) return messages;

  const lastUserIndex = findLastUserIndex(messages);
  if (lastUserIndex < 0) return messages;

  const hasMultipleImages = imageAttachments.length > 1;
  const textContent = extractMessageText(messages[lastUserIndex].content);
  const content: APIChatMessage["content"] = [{ type: "text", text: textContent }];

  for (const attachment of imageAttachments) {
    let file = attachment.file!;
    const sizeMB = file.size / (1024 * 1024);

    if (sizeMB > 3) {
      const compressed = await compressLargeImageForProvider(file, sizeMB);
      if (compressed.size < file.size) file = compressed;
    }
    if (hasMultipleImages && sizeMB > 2) {
      const compressed = await compressImageForMultiAttachment(file);
      if (compressed.size < file.size) file = compressed;
    }

    const base64 = await arrayBufferToBase64(await file.arrayBuffer());
    const finalSizeMB = file.size / (1024 * 1024);

    content.push({
      type: "image_url",
      image_url: {
        url: `data:${file.type || "image/jpeg"};base64,${base64}`,
        detail: pickImageDetail(finalSizeMB, hasMultipleImages),
      },
    });
  }

  return messages.map((m, i) =>
    i === lastUserIndex ? { ...m, content } : m
  );
}
