/**
 * Constants barrel — the import surface for app-wide static values.
 *
 * Per the §2 placement rule, app-wide constants live in `src/core/config/constants/`,
 * split across app.ts / network.ts / ui.ts / models.ts / splashTiming.ts. Feature-only
 * constants stay co-located in their `features/<x>/constants.ts` (§2 rule 4).
 *
 * Only the values with cross-folder consumers are re-exported here. Siblings may be
 * deep-imported directly (as App.tsx does for splashTiming); the aggregate `CONSTANTS`
 * object and default export were back-compat shims with no remaining consumer (RT-020).
 *
 * Split out of the historical `config/constants.ts` monolith during Phase 5 (T5.1).
 */

export { TOKEN_LIMITS, CACHE_CONFIG } from "./app";
export { STORAGE_KEYS } from "./network";
