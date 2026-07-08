import type { Env } from "../env";

export async function insertVector(
  env: Env,
  id: string,
  values: number[],
  metadata: Record<string, string | number>
): Promise<void> {
  await env.VECTORIZE.insert([{ id, values, metadata }]);
}

export async function queryVectors(
  env: Env,
  values: number[],
  userId: string,
  topK = 10
): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
  const result = await env.VECTORIZE.query(values, {
    topK,
    filter: { user_id: userId },
    returnMetadata: "all",
  });
  return result.matches.map((m) => ({
    id:       m.id,
    score:    m.score,
    metadata: (m.metadata ?? {}) as Record<string, unknown>,
  }));
}

export async function deleteVector(env: Env, id: string): Promise<void> {
  await env.VECTORIZE.deleteByIds([id]);
}
