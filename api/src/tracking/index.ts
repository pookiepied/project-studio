/**
 * API worker observability — single import point.
 *
 * Route handlers import from here. Never import from events.ts directly.
 *
 *   import { emit } from '../tracking';
 *   emit(c.env, c.executionCtx, { event: 'job.created', userId, data: { jobId } });
 */

export { emit, categoryOf }           from './events';
export type { APIEvent, APITrackEvent } from './events';
