// Gateway tracking — single import point for gateway and chat routes.

export { emit, categoryOf }           from './events';
export type { AIEvent, AITrackEvent } from './events';

export { recordUsage }                from './usage';
export type { TrackingParams }        from './usage';

export { estimateCostUsd }            from './pricing';

export { fetchAllCredits }            from './credits/index';
export type { CreditProvider, ProviderCreditResult } from './credits/base';
