/**
 * Public surface of core/models: only what callers outside this folder consume.
 * Files inside the folder import each other by relative path and must not go
 * through here.
 */

export type { Model, ModelsResponse, ProviderInfo } from "./types";
export { migrateModelId } from "./modelIdMigration";
export { detectContextWindow, detectVisionSupport } from "./modelCapabilityService";
