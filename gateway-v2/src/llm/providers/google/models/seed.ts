import type { ModelInfo } from "../../../../core/capabilities";
import {
  createGoogleChatModel,
  createGoogleEmbeddingModel,
  createGoogleImageModel
} from "./metadata";

export const GOOGLE_SEED_MODELS: ModelInfo[] = [
  createGoogleChatModel("gemini-3.5-flash"),
  createGoogleChatModel("gemini-3.1-pro-preview"),
  createGoogleChatModel("gemini-3-flash-preview"),
  createGoogleChatModel("gemini-3-pro-preview"),
  createGoogleChatModel("gemini-2.5-pro"),
  createGoogleChatModel("gemini-2.5-flash"),
  createGoogleChatModel("gemini-2.5-flash-lite"),
  createGoogleEmbeddingModel("gemini-embedding-001"),
  createGoogleEmbeddingModel("gemini-embedding-2"),
  createGoogleImageModel("gemini-3-pro-image-preview", true),
  createGoogleImageModel("gemini-3.1-flash-image-preview", true),
  createGoogleImageModel("gemini-2.5-flash-image", true),
  createGoogleImageModel("imagen-4.0-generate-001", false),
  createGoogleImageModel("imagen-4.0-fast-generate-001", false)
];
