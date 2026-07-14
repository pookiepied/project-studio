/// <reference types="@cloudflare/workers-types" />

export type Category = "identity" | "preference" | "project" | "event" | "knowledge";
export const CATEGORIES = ["identity", "preference", "project", "event", "knowledge"] as const;

export type SourceType = "stated" | "inferred" | "observed";
export const SOURCE_TYPES = ["stated", "inferred", "observed"] as const;

export type DecayRate = "none" | "slow" | "medium" | "fast";
export const DECAY_RATES = ["none", "slow", "medium", "fast"] as const;

export interface ProfileEntry {
  content: string;
  importance: number;
}

export interface ProfileFacts {
  identity: ProfileEntry[];
  preference: ProfileEntry[];
}
