/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import { emit } from './tracking';

interface Env {
  CHATS_BUCKET: R2Bucket;
  TRACKER?: Fetcher;
}

// ── Gzip helpers ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

async function compress(text: string): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(enc.encode(text));
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function decompress(data: ArrayBuffer): Promise<string> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(data));
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return dec.decode(out);
}

// ── App ───────────────────────────────────────────────────────────────────────
// Private worker — only reachable via service binding from the API worker.
// No JWT verification here; the API handles auth and injects X-User-Id.

const app = new Hono<{ Bindings: Env }>();

function r2Key(userId: string, path: string): string {
  return `users/${userId}/chats/${path}`;
}

app.get('/chats/:path{.+}', async (c) => {
  const userId = c.req.header('X-User-Id');
  if (!userId) return c.json({ error: 'Missing user identity' }, 400);

  try {
    const object = await c.env.CHATS_BUCKET.get(r2Key(userId, c.req.param('path')));
    if (!object) {
      emit(c.env, c.executionCtx, {
        event: 'chat.storage.not_found', severity: 'info',
        userId, data: { path: c.req.param('path') },
      });
      return c.json({ error: 'Not found' }, 404);
    }

    emit(c.env, c.executionCtx, {
      event: 'chat.storage.read', severity: 'info',
      userId, data: { path: c.req.param('path'), size: object.size },
    });

    const text = await decompress(await object.arrayBuffer());
    return new Response(text, { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    emit(c.env, c.executionCtx, {
      event: 'chat.storage.error', severity: 'error',
      userId, data: { path: c.req.param('path'), operation: 'read', error: err?.message ?? String(err) },
    });
    return c.json({ error: 'Storage error' }, 500);
  }
});

app.on('HEAD', '/chats/:path{.+}', async (c) => {
  const userId = c.req.header('X-User-Id');
  if (!userId) return c.body(null, 400);

  try {
    const object = await c.env.CHATS_BUCKET.head(r2Key(userId, c.req.param('path')));
    emit(c.env, c.executionCtx, {
      event: 'chat.storage.checked', severity: 'info',
      userId, data: { path: c.req.param('path'), exists: !!object },
    });
    return c.body(null, object ? 200 : 404);
  } catch (err: any) {
    emit(c.env, c.executionCtx, {
      event: 'chat.storage.error', severity: 'error',
      userId, data: { path: c.req.param('path'), operation: 'head', error: err?.message ?? String(err) },
    });
    return c.body(null, 500);
  }
});

app.put('/chats/:path{.+}', async (c) => {
  const userId = c.req.header('X-User-Id');
  if (!userId) return c.json({ error: 'Missing user identity' }, 400);

  try {
    const body = await c.req.text();
    const compressed = await compress(body);

    await c.env.CHATS_BUCKET.put(r2Key(userId, c.req.param('path')), compressed, {
      httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
    });

    emit(c.env, c.executionCtx, {
      event: 'chat.storage.written', severity: 'info',
      userId, data: { path: c.req.param('path'), sizeBytes: body.length },
    });

    return c.json({ ok: true });
  } catch (err: any) {
    emit(c.env, c.executionCtx, {
      event: 'chat.storage.error', severity: 'error',
      userId, data: { path: c.req.param('path'), operation: 'write', error: err?.message ?? String(err) },
    });
    return c.json({ error: 'Storage error' }, 500);
  }
});

app.delete('/chats/:path{.+}', async (c) => {
  const userId = c.req.header('X-User-Id');
  if (!userId) return c.json({ error: 'Missing user identity' }, 400);

  try {
    await c.env.CHATS_BUCKET.delete(r2Key(userId, c.req.param('path')));

    emit(c.env, c.executionCtx, {
      event: 'chat.storage.deleted', severity: 'info',
      userId, data: { path: c.req.param('path') },
    });

    return c.json({ ok: true });
  } catch (err: any) {
    emit(c.env, c.executionCtx, {
      event: 'chat.storage.error', severity: 'error',
      userId, data: { path: c.req.param('path'), operation: 'delete', error: err?.message ?? String(err) },
    });
    return c.json({ error: 'Storage error' }, 500);
  }
});

export default app;
