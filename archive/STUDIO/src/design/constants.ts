/**
 * Shared design-system constants.
 *
 * Single source of truth for values that were previously duplicated across
 * feature/app files (hero gradient, log-row grid template). Keeping them here
 * lets consumers import one symbol instead of re-declaring the same string.
 */

// Hero gradient for marketing/welcome surfaces (D-408 carve-out: documented hue exception)
/* eslint-disable no-restricted-syntax -- D-408 marketing-surface carve-out: welcome hero gradient, no neutral-token equivalent */
export const HERO_GRADIENT = "linear-gradient(135deg, #ede9fe 0%, #dbeafe 55%, #bae6fd 100%)";
/* eslint-enable no-restricted-syntax */

// Activity log row grid template — shared by ActivityPage header and LogRow body.
export const LOG_GRID_TEMPLATE = "20px minmax(0, 1fr) minmax(0, 1fr) 80px 70px 14px";
