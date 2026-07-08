import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { userAuth } from '../middleware/auth';
import { handleUnknownError } from '../utils/errors';

type Variables = {
  caller: Caller;
};

export const taskRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Get available tasks from catalog
 */
taskRoutes.get('/tasks', userAuth, async (c) => {
  try {
    const catalog = await c.env.KV.get('task_catalog', 'json');
    return c.json({ tasks: catalog || [] });
  } catch (error) {
    const apiError = handleUnknownError(error);
    return c.json(apiError, 500);
  }
});
