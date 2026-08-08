export async function checkDatabase(db: D1Database): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  await db.prepare("SELECT 1 AS ok").first();
  return { ok: true, latencyMs: Date.now() - started };
}
