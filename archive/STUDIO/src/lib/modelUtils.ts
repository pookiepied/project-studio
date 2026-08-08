/**
 * Model utility functions for enhanced model handling
 * Now uses centralized model capability service
 */

import type { Model } from "@/core/models";
import { detectVisionSupport } from "@/core/models";

/**
 * Check if a model supports vision/image input
 */
export function isVisionModel(model: Model): boolean {
  return detectVisionSupport(model);
}
