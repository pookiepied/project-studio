/**
 * Regression test for audit B4 — local-model STREAMING must execute tool calls.
 *
 * Before the fix, the `stream: true` branch piped the provider's SSE straight to
 * the client and never looked at `delta.tool_calls`, so a local model that asked
 * for a tool got its request silently dropped and the user saw an empty answer.
 *
 * Runs against `dist/`, so: `npm test` (which builds first). No network — the
 * provider and the tool callback are both stubbed.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const registry = require('../dist/services/localModelRegistry.js');
const handler = require('../dist/services/toolCallHandler.js');

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

const streamOf = (frames) =>
  new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });

/** Parses the response the way the real client (daemonService.daemonStream) does. */
function readAsClient(raw) {
  let text = '';
  let usage = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    const data = JSON.parse(payload);
    if (data.usage) usage = data.usage;
    const content = data.choices?.[0]?.delta?.content;
    if (content) text += content;
  }
  return { text, usage, doneCount: (raw.match(/\[DONE\]/g) || []).length };
}

async function postStreaming(body) {
  const chatRouter = require('../dist/routes/chat.js').default;
  const app = express();
  app.use(express.json());
  app.use('/v1/chat', chatRouter);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: true, ...body }),
    });
    return await res.text();
  } finally {
    server.close();
  }
}

test('streaming executes tool calls and streams the follow-up answer', async () => {
  let rounds = 0;
  registry.modelRegistry.getProviderForModel = async () => ({
    async streamChat() {
      rounds++;
      if (rounds === 1) {
        // `arguments` is split across deltas, and the JSON is cut mid-object —
        // this is what a real provider does, and what the old code could not handle.
        return streamOf([
          sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{"tz"' } }] } }] }),
          sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"UTC"}' } }] } }] }),
          sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n',
        ]);
      }
      return streamOf([
        sse({ choices: [{ delta: { content: 'It is ' } }] }),
        sse({ choices: [{ delta: { content: '12:00 UTC.' } }] }),
        sse({ usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [] }),
        'data: [DONE]\n\n',
      ]);
    },
  });

  const executed = [];
  handler.toolCallHandler.executeToolCall = async (req) => {
    executed.push(req);
    return { success: true, result: { time: '12:00' } };
  };

  const raw = await postStreaming({
    model: 'local:ollama:fake',
    messages: [{ role: 'user', content: 'what time is it?' }],
    tools: [{ type: 'function', function: { name: 'get_time' } }],
    toolCallbackUrl: 'http://example.invalid/cb',
    sessionId: 's1',
  });

  const { text, usage, doneCount } = readAsClient(raw);

  assert.equal(executed.length, 1, 'the tool should have been executed');
  assert.equal(executed[0].toolName, 'get_time');
  assert.deepEqual(executed[0].toolInput, { tz: 'UTC' }, 'split JSON arguments must be reassembled');
  assert.equal(executed[0].sessionId, 's1');

  assert.equal(rounds, 2, 'a second provider round should follow the tool result');
  assert.equal(text, 'It is 12:00 UTC.', 'client should receive the post-tool answer');
  assert.equal(usage?.completion_tokens, 5, 'usage chunk should be forwarded');
  assert.equal(doneCount, 1, 'exactly one [DONE] terminates the client stream');
});

test('streaming without a tool callback still terminates cleanly', async () => {
  let rounds = 0;
  registry.modelRegistry.getProviderForModel = async () => ({
    async streamChat() {
      rounds++;
      if (rounds === 1) {
        return streamOf([
          sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'nope', arguments: '{}' } }] } }] }),
          'data: [DONE]\n\n',
        ]);
      }
      return streamOf([
        sse({ choices: [{ delta: { content: 'I could not run that tool.' } }] }),
        'data: [DONE]\n\n',
      ]);
    },
  });

  const raw = await postStreaming({
    model: 'local:ollama:fake',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    // no toolCallbackUrl
  });

  const { text, doneCount } = readAsClient(raw);
  assert.equal(rounds, 2, 'the model still gets a chance to respond to the failure');
  assert.equal(text, 'I could not run that tool.');
  assert.equal(doneCount, 1);
});
