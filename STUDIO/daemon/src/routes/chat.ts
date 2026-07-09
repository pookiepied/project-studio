import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { modelRegistry } from '../services/localModelRegistry';
import { toolCallHandler } from '../services/toolCallHandler';
import { LocalProvider } from '../services/providers/base';
import { LocalProviderRequest } from '../types/index';
import { logger } from '../config/logger';

const router = Router();

const MAX_TOOL_ROUNDS = 10;

interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/**
 * Run every tool the model asked for and return the `role: "tool"` messages to
 * append to the conversation. Shared by the streaming and non-streaming paths so
 * the two cannot drift.
 *
 * A missing `toolCallbackUrl` is not fatal: the model gets a message explaining
 * the tool was unavailable and can tell the user about it.
 */
async function executeToolCalls(
  toolCalls: ToolCall[],
  toolCallbackUrl: string | undefined,
  sessionId: string | undefined
): Promise<any[]> {
  const toolMessages: any[] = [];

  for (const tc of toolCalls) {
    let toolResultContent: string;

    if (toolCallbackUrl) {
      let toolInput: Record<string, any> = {};
      try {
        toolInput = JSON.parse(tc.function.arguments);
      } catch {
        toolInput = {};
      }

      const toolResult = await toolCallHandler.executeToolCall(
        { toolName: tc.function.name, toolInput, sessionId },
        toolCallbackUrl
      );

      toolResultContent = toolResult.success
        ? JSON.stringify(toolResult.result)
        : `Error: ${toolResult.error}`;
    } else {
      toolResultContent = `Tool execution not available: no callback URL provided for tool '${tc.function.name}'`;
    }

    toolMessages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: toolResultContent,
    });
  }

  return toolMessages;
}

interface StreamRoundResult {
  /** Tool calls the model asked for, assembled from their deltas. */
  toolCalls: ToolCall[];
  /** Text the model emitted this round — needed for the assistant history entry. */
  content: string;
}

/**
 * Stream one provider round to the client, forwarding text deltas verbatim while
 * assembling any tool-call deltas.
 *
 * The client (`daemonService.daemonStream`) reads only `choices[0].delta.content`
 * and `usage`, so tool-call deltas and the `finish_reason: "tool_calls"` chunk are
 * consumed here rather than forwarded — they would be noise on the wire. `[DONE]`
 * is swallowed too: only the caller knows whether the turn is really over.
 */
async function streamOneRound(
  provider: LocalProvider,
  providerRequest: LocalProviderRequest,
  res: Response
): Promise<StreamRoundResult> {
  const sourceStream = await provider.streamChat(providerRequest);
  const reader = sourceStream.getReader();
  const textDecoder = new TextDecoder();

  // Accumulate tool calls by their `index`: OpenAI splits one call across many
  // deltas (id/name arrive first, then `arguments` a few characters at a time).
  const partials = new Map<number, ToolCall>();
  let content = '';
  // An SSE frame can split across reads; hold the trailing partial line.
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += textDecoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') continue;

        let data: any;
        try {
          data = JSON.parse(payload);
        } catch {
          continue; // malformed chunk — skip
        }

        // Usage-only chunk (stream_options.include_usage) carries empty choices.
        if (data.usage && !data.choices?.length) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
          continue;
        }

        const delta = data.choices?.[0]?.delta;
        if (!delta) continue;

        for (const tcDelta of delta.tool_calls ?? []) {
          const index: number = tcDelta.index ?? 0;
          const existing = partials.get(index) ?? {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          };
          if (tcDelta.id) existing.id = tcDelta.id;
          if (tcDelta.type) existing.type = tcDelta.type;
          if (tcDelta.function?.name) existing.function.name = tcDelta.function.name;
          if (tcDelta.function?.arguments) existing.function.arguments += tcDelta.function.arguments;
          partials.set(index, existing);
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          content += delta.content;
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls = [...partials.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => tc)
    // A call with no name is an incomplete delta — never execute it.
    .filter((tc) => tc.function.name.length > 0);

  return { toolCalls, content };
}

router.post('/completions', async (req: Request, res: Response) => {
  const requestId = uuidv4();
  const startTime = Date.now();

  try {
    const {
      model,
      messages: initialMessages,
      tools,
      stream = false,
      temperature,
      top_p,
      max_tokens,
      toolCallbackUrl,
      sessionId,
    } = req.body;

    if (!model) {
      return res.status(400).json({ error: 'Model is required' });
    }

    if (!initialMessages || !Array.isArray(initialMessages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    logger.info('chat', `New request: ${requestId}`, { model, stream });

    const provider = await modelRegistry.getProviderForModel(model);
    if (!provider) {
      logger.error('chat', `No provider found for model: ${model}`);
      return res.status(400).json({ error: `Unknown model: ${model}` });
    }

    if (stream) {
      // Streaming runs the same tool loop as the non-streaming path: text deltas
      // are forwarded as they arrive, and whenever the model asks for tools we
      // execute them and start another round on the same response stream. The
      // client sees one continuous text stream. Previously this path piped the
      // provider straight through, so a local model in stream mode silently lost
      // every tool call (audit B4).
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const messages = [...initialMessages];
        let round = 0;

        while (round < MAX_TOOL_ROUNDS) {
          round++;

          const { toolCalls, content } = await streamOneRound(
            provider,
            { model, messages, tools, stream: true, temperature, top_p, max_tokens },
            res
          );

          if (toolCalls.length === 0) break;

          logger.info(
            'chat',
            `Stream tool call round ${round}: ${toolCalls.map((tc) => tc.function.name).join(', ')}`
          );

          messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls } as any);
          messages.push(...(await executeToolCalls(toolCalls, toolCallbackUrl, sessionId)));

          if (round === MAX_TOOL_ROUNDS) {
            logger.warn('chat', `Max tool rounds reached while streaming: ${requestId}`);
          }
        }

        res.write('data: [DONE]\n\n');
        res.end();

        logger.info('chat', `Stream complete: ${requestId}`, {
          latency: Date.now() - startTime,
          rounds: round,
        });
      } catch (error) {
        logger.error('chat', `Stream failed: ${requestId}`, error);
        res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
        res.end();
      }

      return;
    }

    // Non-streaming: run tool call loop until finish_reason is "stop"
    const messages = [...initialMessages];
    let round = 0;
    let finalResult: any = null;

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const providerRequest: LocalProviderRequest = {
        model,
        messages,
        tools,
        stream: false,
        temperature,
        top_p,
        max_tokens,
      };

      const result = await provider.chat(providerRequest);
      const choice = result.choices?.[0];

      if (!choice) {
        finalResult = result;
        break;
      }

      // If the model is done, return the result
      if (choice.finish_reason !== 'tool_calls') {
        finalResult = result;
        break;
      }

      // Model wants to call tools — execute them and continue
      const toolCalls: ToolCall[] = (choice.message as any).tool_calls ?? [];

      if (toolCalls.length === 0) {
        finalResult = result;
        break;
      }

      logger.info('chat', `Tool call round ${round}: ${toolCalls.map((tc) => tc.function.name).join(', ')}`);

      // Add assistant message with tool_calls to history
      messages.push(choice.message as any);
      messages.push(...(await executeToolCalls(toolCalls, toolCallbackUrl, sessionId)));
    }

    if (!finalResult) {
      return res.status(500).json({ error: 'Max tool rounds exceeded without a final response' });
    }

    const latency = Date.now() - startTime;
    logger.info('chat', `Completion: ${requestId}`, { latency, rounds: round });

    return res.json(finalResult);
  } catch (error) {
    logger.error('chat', `Request failed: ${requestId}`, error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

export default router;
