import type { RegistryModel } from "../../registry/schema";
import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import {
  getModelRegistryForEnv,
  getRegistryModelForEnv,
  mergeRegistryModels,
  readPersistedRegistryModels,
  writePersistedRegistryModels
} from "../../registry";
import { validateRegistry } from "../../registry/validate";

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
  const persistedWithoutModel = persisted.filter((candidate) => candidate.id !== model.id);
  const nextPersisted = [...persistedWithoutModel, model].sort((a, b) => a.id.localeCompare(b.id));
  const nextModels = mergeRegistryModels(registry.models.filter((candidate) => candidate.id !== model.id), nextPersisted);
  validateRegistry({ ...registry, models: nextModels });
  await writePersistedRegistryModels(env, nextPersisted);
  return nextPersisted;
}

export async function replacePersistedRegistryModels(env: GatewayEnv, models: RegistryModel[]): Promise<RegistryModel[]> {
  const registry = await getModelRegistryForEnv(env);
  const nextModels = mergeRegistryModels(registry.models, models);
  validateRegistry({ ...registry, models: nextModels });
  const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id));
  await writePersistedRegistryModels(env, sorted);
  return sorted;
}
