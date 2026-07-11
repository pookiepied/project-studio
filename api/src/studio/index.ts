import { Hono } from 'hono';
import type { Env, Variables } from '../server/types';
import { systemRoutes } from './system';
import { runsRoutes } from './runs';
import { conversationsRoutes } from './conversations';
import { dataRoutes } from './data';
import { registryRoutes } from './registry';

export const studioRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

studioRoutes.route('/runs', runsRoutes);
studioRoutes.route('/conversations', conversationsRoutes);
studioRoutes.route('/data', dataRoutes);
studioRoutes.route('/registry', registryRoutes);
studioRoutes.route('/system', systemRoutes);
