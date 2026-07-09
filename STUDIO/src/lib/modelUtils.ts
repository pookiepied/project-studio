/**
 * Model utility functions for enhanced model handling
 * Now uses centralized model capability service
 */

import { Model } from "@/features/models/services/modelService";
import { getModelCapabilities, detectVisionSupport, detectToolSupport, detectStreamingSupport } from "@/features/models/services/modelCapabilityService";

/**
 * Check if a model supports vision/image input
 */
export function isVisionModel(model: Model): boolean {
  return detectVisionSupport(model);
}

/**
 * Check if a model supports tool/function calling
 */
export function isToolModel(model: Model): boolean {
  return detectToolSupport(model);
}

/**
 * Check if a model supports streaming
 */
export function isStreamingModel(model: Model): boolean {
  return detectStreamingSupport(model);
}


/**
 * Get comprehensive model capabilities
 */
export function getModelCapabilitiesInfo(model: Model) {
  return getModelCapabilities(model);
}

/**
 * Get supported file types for a model
 */
export function getSupportedFileTypes(supportsVision: boolean): string[] {
  const baseTypes = [".txt", ".md", ".json", ".yaml", ".yml", ".csv", ".xml", ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".sql", ".sh"];
  
  if (supportsVision) {
    return [...baseTypes, ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
  }
  
  return baseTypes;
}

/**
 * Get maximum file size for a model (in MB)
 */
export function getMaxFileSize(model: Model): number {
  if (isVisionModel(model)) {
    return model.maxImageSize || 20; // Default 20MB for images
  }
  
  return 10; // Default 10MB for text files
}

/**
 * Get maximum number of files for a model
 */
export function getMaxFiles(model: Model): number {
  if (isVisionModel(model)) {
    return model.maxImages || 10; // Default 10 images
  }
  
  return 20; // Default 20 text files
}

/**
 * Filter models by capability
 */
export function filterModelsByCapability(
  models: Model[], 
  capability: "vision" | "tools" | "streaming"
): Model[] {
  switch (capability) {
    case "vision":
      return models.filter(isVisionModel);
    case "tools":
      return models.filter(isToolModel);
    case "streaming":
      return models.filter(isStreamingModel);
    default:
      return models;
  }
}

/**
 * Get model display info with capabilities
 */
export function getModelDisplayInfo(model: Model): {
  name: string;
  badges: string[];
  description: string;
} {
  const badges: string[] = [];
  
  if (model.free) badges.push("Free");
  if (isVisionModel(model)) badges.push("Vision");
  if (isToolModel(model)) badges.push("Tools");
  if (model.contextWindow && model.contextWindow > 32000) badges.push("Long Context");
  
  return {
    name: model.name,
    badges,
    description: model.description || `${model.provider} model`
  };
}