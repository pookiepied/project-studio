import { createHash } from "crypto";
import { promises as fs } from "fs";

export interface FileRevision { algorithm: "sha256"; hash: string; size_bytes: number; modified_ms: number }

export function revisionFromBuffer(data: Buffer, modifiedMs: number): FileRevision {
  return { algorithm: "sha256", hash: createHash("sha256").update(data).digest("hex"), size_bytes: data.length, modified_ms: Math.floor(modifiedMs) };
}

export async function getFileRevision(path: string): Promise<FileRevision> {
  const [data, stat] = await Promise.all([fs.readFile(path), fs.stat(path)]);
  return revisionFromBuffer(data, stat.mtimeMs);
}

export function expectedHash(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as any).hash === "string") return (value as any).hash;
  return undefined;
}

export function staleResult(expected: unknown, current: FileRevision): Record<string, unknown> | undefined {
  const hash = expectedHash(expected);
  if (!hash || hash === current.hash) return undefined;
  return { error: "stale_file", message: "The file changed after it was read. Read the relevant range again before mutating it.", expected_hash: hash, current_revision: current };
}
