import { Hono } from 'hono';
import { Env, PutPreferencesBody } from '../types';

export const preferencesRoutes = new Hono<{ Bindings: Env }>();

// ── GET /preferences ──────────────────────────────────────────────────────────
// Returns stored preferences for this user.  If the user has no row yet,
// returns empty objects for all groups — the client merges these with its
// local defaults (local wins on first sync).

preferencesRoutes.get('/preferences', async (c) => {
  const userId = c.req.header('x-user-id');
  if (!userId) return c.json({ error: 'Missing x-user-id header' }, 400);

  try {
    const row = await c.env.STUDIO_DB
      .prepare('SELECT models, ui, behavior, updated_at FROM user_preferences WHERE user_id = ?')
      .bind(userId)
      .first<{ models: string; ui: string; behavior: string; updated_at: number }>();

    if (!row) {
      return c.json({ user_id: userId, models: {}, ui: {}, behavior: {}, updated_at: 0 });
    }

    return c.json({
      user_id:    userId,
      models:     JSON.parse(row.models   || '{}'),
      ui:         JSON.parse(row.ui       || '{}'),
      behavior:   JSON.parse(row.behavior || '{}'),
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error('[preferences] GET failed', err);
    return c.json({ error: 'Failed to fetch preferences' }, 500);
  }
});

// ── PUT /preferences ──────────────────────────────────────────────────────────
// Partial upsert — only the groups included in the body are written.
// Groups omitted from the body are left unchanged (merge, not replace).
// The client should send updated_at as the current timestamp so the next
// device can detect which copy is newer.

preferencesRoutes.put('/preferences', async (c) => {
  const userId = c.req.header('x-user-id');
  if (!userId) return c.json({ error: 'Missing x-user-id header' }, 400);

  let body: PutPreferencesBody;
  try {
    body = await c.req.json<PutPreferencesBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    // Load the existing row so we can merge individual groups
    const existing = await c.env.STUDIO_DB
      .prepare('SELECT models, ui, behavior FROM user_preferences WHERE user_id = ?')
      .bind(userId)
      .first<{ models: string; ui: string; behavior: string }>();

    const prev = {
      models:   existing ? JSON.parse(existing.models   || '{}') : {},
      ui:       existing ? JSON.parse(existing.ui       || '{}') : {},
      behavior: existing ? JSON.parse(existing.behavior || '{}') : {},
    };

    // Shallow-merge each group — incoming keys overwrite, missing keys preserved
    const merged = {
      models:   { ...prev.models,   ...(body.models   ?? {}) },
      ui:       { ...prev.ui,       ...(body.ui       ?? {}) },
      behavior: { ...prev.behavior, ...(body.behavior ?? {}) },
    };

    const now = Date.now();

    await c.env.STUDIO_DB
      .prepare(`
        INSERT INTO user_preferences (user_id, models, ui, behavior, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET
          models     = excluded.models,
          ui         = excluded.ui,
          behavior   = excluded.behavior,
          updated_at = excluded.updated_at
      `)
      .bind(
        userId,
        JSON.stringify(merged.models),
        JSON.stringify(merged.ui),
        JSON.stringify(merged.behavior),
        now,
      )
      .run();

    return c.json({ success: true, updated_at: now });
  } catch (err) {
    console.error('[preferences] PUT failed', err);
    return c.json({ error: 'Failed to save preferences' }, 500);
  }
});
