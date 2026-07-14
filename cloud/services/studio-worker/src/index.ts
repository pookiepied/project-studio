/// <reference types="@cloudflare/workers-types" />

/**
 * Studio Worker
 *
 * Backend logic layer for Studio-specific concerns:
 *   - /preferences  — user preference sync (GET / PUT)
 *
 * Not exposed publicly.  All traffic arrives via the API worker's
 * service binding (env.STUDIO) after JWT authentication has been
 * verified.  The x-user-id header carries the authenticated user's
 * sub claim, injected by the API proxy route.
 */

import { Hono } from 'hono';
import { Env } from './types';
import { preferencesRoutes } from './routes/preferences';

const app = new Hono<{ Bindings: Env }>();

app.route('/', preferencesRoutes);

export default {
  fetch: app.fetch.bind(app),
};
