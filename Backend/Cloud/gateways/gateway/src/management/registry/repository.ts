import type { RegistryModel } from "../../registry/schema";
import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import {
  getModelRegistry,
  getModelRegistryForEnv,
  getRegistryModelForEnv,
  mergeRegistryModels,
  readPersistedDeletedModelIds,
  readPersistedRegistryModels,
  writePersistedRegistryModels
} from "../../registry";
import { validateRegistry } from "../../registry/validate";
import { GatewayError } from "../../core/errors";

export async function listRegistryModels(env: GatewayEnv): Promise<RegistryModel[]> {
  return (await getModelRegistryForEnv(env)).models;
}

export async function readRegistryModel(env: GatewayEnv, id: string): Promise<RegistryModel | undefined> {
  return getRegistryModelForEnv(env, id);
}

export async function exportRegistry(env: GatewayEnv) {
  return getModelRegistryForEnv(env);
}

export async function upsertRegistryModel(env: GatewayEnv, model: RegistryModel): Promise<RegistryModel[]> {
  const registry = await getModelRegistryForEnv(env);
  const persisted = await readPersistedRegistryModels(env);
  const deletedModelIds = await readPersistedDeletedModelIds(env);
  const persistedWithoutModel = persisted.filter((candidate) => candidate.id !== model.id);
  const nextPersisted = [...persistedWithoutModel, model].sort((a, b) => a.id.localeCompare(b.id));
  const nextDeletedModelIds = deletedModelIds.filter((id) => id !== model.id);
  const nextModels = mergeRegistryModels(
    registry.models.filter((candidate) => candidate.id !== model.id),
    nextPersisted,
    nextDeletedModelIds
  );
  validateRegistry({ ...registry, models: nextModels });
  await writePersistedRegistryModels(env, nextPersisted, nextDeletedModelIds);
  return nextPersisted;
}

export async function replacePersistedRegistryModels(env: GatewayEnv, models: RegistryModel[]): Promise<RegistryModel[]> {
  const registry = await getModelRegistryForEnv(env);
  const deletedModelIds = await readPersistedDeletedModelIds(env);
  const importedModelIds = new Set(models.map((model) => model.id));
  const nextDeletedModelIds = deletedModelIds.filter((id) => !importedModelIds.has(id));
  const nextModels = mergeRegistryModels(registry.models, models, nextDeletedModelIds);
  validateRegistry({ ...registry, models: nextModels });
  const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id));
  await writePersistedRegistryModels(env, sorted, nextDeletedModelIds);
  return sorted;
}

export async function deleteRegistryModel(env: GatewayEnv, id: string): Promise<{ deletedModelIds: string[]; persistedModels: RegistryModel[] }> {
  const registry = await getModelRegistryForEnv(env);
  const existing = await getRegistryModelForEnv(env, id);
  if (!existing) {
    throw new GatewayError("MODEL_NOT_FOUND", "Registry model was not found.");
  }

  const baseHasModel = getModelRegistry().models.some((model) => model.id === id);
  const persisted = await readPersistedRegistryModels(env);
  const deletedModelIds = await readPersistedDeletedModelIds(env);
  const nextPersisted = persisted.filter((model) => model.id !== id);
  const nextDeletedModelIds = baseHasModel ? Array.from(new Set([...deletedModelIds, id])).sort() : deletedModelIds;
  const nextModels = mergeRegistryModels(getModelRegistry().models, nextPersisted, nextDeletedModelIds);
  validateRegistry({ ...registry, models: nextModels });
  await writePersistedRegistryModels(env, nextPersisted, nextDeletedModelIds);
  return { deletedModelIds: nextDeletedModelIds, persistedModels: nextPersisted };
}
