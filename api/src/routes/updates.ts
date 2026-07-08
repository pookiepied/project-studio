/**
 * Update manifest endpoint for the STUDIO auto-updater.
 *
 * Returns a Tauri-compatible JSON manifest when a release is staged,
 * or 204 (no content) when no update is available.
 *
 * ── How to stage a release ───────────────────────────────────────────────────
 *
 * 1. Build and sign:
 *      cd STUDIO
 *      npx tauri build
 *      npx tauri signer sign -k ~/.tauri/studio.key \
 *        src-tauri/target/release/bundle/nsis/STUDIO_0.1.1_x64-setup.nsis.zip
 *      # Outputs a base64 signature string — copy it
 *
 * 2. Upload STUDIO_0.1.1_x64-setup.nsis.zip to your R2 bucket / file host.
 *
 * 3. Push the manifest (triggers update for all users immediately):
 *      wrangler kv key put \
 *        --namespace-id=35f6ec05519142ca91278067caa2fba9 \
 *        "studio:latest" \
 *        '{"version":"0.1.1","notes":"What changed.","pub_date":"2026-04-07T00:00:00Z","platforms":{"windows-x86_64":{"signature":"<base64-sig>","url":"https://releases.pookiepied.dev/STUDIO_0.1.1_x64-setup.nsis.zip"}}}'
 *
 * ── How to retract a release ─────────────────────────────────────────────────
 *      wrangler kv key delete \
 *        --namespace-id=35f6ec05519142ca91278067caa2fba9 \
 *        "studio:latest"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { emit } from '../tracking';

type Variables = { caller: Caller };

export const updateRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

updateRoutes.get('/v1/updates/latest', async (c) => {
  const manifest = await c.env.RELEASES_KV.get('studio:latest');

  if (!manifest) {
    emit(c.env, c.executionCtx, {
      event: 'update.check', severity: 'info',
      data: { hasUpdate: false },
    });
    // 204 = no update — Tauri interprets this as "already up to date"
    return new Response(null, { status: 204 });
  }

  try {
    const parsed = JSON.parse(manifest) as { version?: string };
    emit(c.env, c.executionCtx, {
      event: 'update.check', severity: 'info',
      data: { hasUpdate: true, version: parsed.version ?? 'unknown' },
    });
  } catch {
    emit(c.env, c.executionCtx, { event: 'update.check', severity: 'info', data: { hasUpdate: true } });
  }

  // Return raw string — avoids JSON.parse crash if manifest has encoding quirks
  return new Response(manifest, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

updateRoutes.get('/v1/releases/*', async (c) => {
  const r2Key = c.req.path.slice('/v1/releases/'.length);

  if (!r2Key) return new Response('Not found', { status: 404 });

  const object = await c.env.RELEASES_BUCKET.get(r2Key);

  if (!object) return new Response('Release file not found', { status: 404 });

  emit(c.env, c.executionCtx, {
    event: 'update.download', severity: 'info',
    data: { r2Key, sizeBytes: object.size ?? null },
  });

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  if (object.size) headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { status: 200, headers });
});
