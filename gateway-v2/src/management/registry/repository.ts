import type { RegistryModel } from "../../registry/schema";
import { getModelRegistry, getRegistryModel } from "../../registry";

export function listRegistryModels(): RegistryModel[] {
  return getModelRegistry().models;
}

export function readRegistryModel(id: string): RegistryModel | undefined {
  return getRegistryModel(id);
}

export function exportRegistry() {
  return getModelRegistry();
}
