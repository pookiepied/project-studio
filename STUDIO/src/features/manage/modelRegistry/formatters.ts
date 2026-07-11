import type { RegistryModel, RegistryPricing } from "./types";

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
}

export function formatPricing(pricing: RegistryPricing): string {
  if (pricing.status === "not_applicable") return "N/A";
  if (pricing.kind === "token" || pricing.kind === "embedding") {
    return `in ${money(pricing.inputPerMillion)} / out ${money(pricing.outputPerMillion)} per 1M`;
  }
  if (pricing.price === null || pricing.price === undefined) {
    return `${pricing.status.split("_").join(" ")} / ${pricing.billingUnit.split("_").join(" ")}`;
  }
  return `${money(pricing.price)} / ${pricing.billingUnit.split("_").join(" ")}`;
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return `$${formatNumber(value)}`;
}

export function categoryLabel(category: string): string {
  return category.replace(".", " / ").split("_").join(" ");
}

export function modelSearchText(model: RegistryModel): string {
  return [
    model.id,
    model.provider,
    model.providerModelId,
    model.displayName,
    model.registry.category,
    model.registry.developer,
    model.registry.family,
    model.capabilities.modalities.join(" "),
    model.registry.pricing.kind,
    model.registry.pricing.billingUnit
  ].join(" ").toLowerCase();
}
