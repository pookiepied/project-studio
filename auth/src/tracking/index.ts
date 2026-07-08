/**
 * Auth worker observability — single import point.
 *
 * Route handlers import from here. Never import from events.ts directly.
 *
 *   import { emit } from './tracking';
 *   emit(c.env, c.executionCtx, { event: 'auth.login.success', userId: user.id });
 */

export { emit, categoryOf }             from './events';
export type { AuthEvent, AuthTrackEvent } from './events';
