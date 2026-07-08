/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import { Env } from './types';
import { registerCors } from './middleware/cors';
import health from './routes/health';
import google from './routes/google';
import refresh from './routes/refresh';
import logout from './routes/logout';
import me from './routes/me';
import whitelist from './routes/admin/whitelist';
import apiKeys from './routes/apiKeys';

const app = new Hono<{ Bindings: Env }>();

registerCors(app);

app.route('/', health);
app.route('/', google);
app.route('/', refresh);
app.route('/', logout);
app.route('/', me);
app.route('/', whitelist);
app.route('/', apiKeys);

export default app;
