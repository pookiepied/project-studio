/**
 * ChatsStorage worker observability — single import point.
 *
 * Route handlers import from here. Never import from events.ts directly.
 *
 *   import { emit } from './tracking';
 *   emit(c.env, c.executionCtx, { event: 'chat.storage.read', userId, data: { size } });
 */

export { emit, categoryOf }                 from './events';
export type { ChatsEvent, ChatsTrackEvent } from './events';
