import type { Artifact } from "../types/artifacts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStatus(value: unknown): value is Artifact["status"] {
  return value === "success" || value === "partial" || value === "pending" || value === "error";
}

function isCategory(value: unknown): value is Artifact["category"] {
  return value === "general" || value === "coding";
}

export function parseArtifact(code: string): {
  artifact: Artifact | null;
  error: string | null;
} {
  try {
    const parsed = JSON.parse(code.trim());
    if (!isRecord(parsed)) return { artifact: null, error: "Artifact block must be a JSON object." };
    if (parsed.type !== "artifact") return { artifact: null, error: "JSON block is not a Studio artifact." };
    if (parsed.version !== 1) return { artifact: null, error: "Unsupported artifact version." };
    if (typeof parsed.kind !== "string" || parsed.kind.trim().length === 0) {
      return { artifact: null, error: "Artifact kind is required." };
    }
    if (typeof parsed.title !== "string" || parsed.title.trim().length === 0) {
      return { artifact: null, error: "Artifact title is required." };
    }
    if (parsed.status !== undefined && !isStatus(parsed.status)) {
      return { artifact: null, error: "Artifact status is invalid." };
    }
    if (parsed.category !== undefined && !isCategory(parsed.category)) {
      return { artifact: null, error: "Artifact category is invalid." };
    }
    return { artifact: parsed as unknown as Artifact, error: null };
  } catch (error) {
    return {
      artifact: null,
      error: error instanceof Error ? error.message : "Invalid artifact JSON.",
    };
  }
}

export function artifactToMarkdown(artifact: Artifact): string {
  return `\`\`\`artifact\n${JSON.stringify(artifact, null, 2)}\n\`\`\``;
}
