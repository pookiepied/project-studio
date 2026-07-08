import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { modelRegistry } from '../services/localModelRegistry';
import { toolCallHandler } from '../services/toolCallHandler';
import { LocalProviderRequest } from '../types/index';
import { logger } from '../config/logger';

const router = Router();

const MAX_TOOL_ROUNDS = 10;

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
      // Streaming: pipe directly from provider, tool calls not supported in streaming mode yet
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const providerRequest: LocalProviderRequest = {
          model,
          messages: initialMessages,
          tools,
          stream: true,
          temperature,
          top_p,
          max_tokens,
        };

        const sourceStream = await provider.streamChat(providerRequest);
        const reader = sourceStream.getReader();
        const textDecoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = textDecoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));
                res.write(`data: ${JSON.stringify(data)}\n\n`);
              } catch {
                // ignore malformed chunk
              }
            }
          }
        }

        reader.releaseLock();
        res.write('data: [DONE]\n\n');
        res.end();

        logger.info('chat', `Stream complete: ${requestId}`, { latency: Date.now() - startTime });
      } catch (error) {
        logger.error('chat', `Stream failed: ${requestId}`, error);
        res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
        res.end();
      }

      return;
    }

    // Non-streaming: run tool call loop until finish_reason is "stop"
    let messages = [...initialMessages];
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
      const toolCalls: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }> = (choice.message as any).tool_calls ?? [];

      if (toolCalls.length === 0) {
        finalResult = result;
        break;
      }

      logger.info('chat', `Tool call round ${round}: ${toolCalls.map(tc => tc.function.name).join(', ')}`);

      // Add assistant message with tool_calls to history
      messages.push(choice.message as any);

      // Execute each tool call
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

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResultContent,
        } as any);
      }
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
