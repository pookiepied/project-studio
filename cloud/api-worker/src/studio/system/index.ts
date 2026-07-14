import { Hono } from 'hono';
import type { Env, Variables } from '../../server/types';
import { healthRoutes } from './routes/health';

export const systemRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

systemRoutes.route('/', healthRoutes);
