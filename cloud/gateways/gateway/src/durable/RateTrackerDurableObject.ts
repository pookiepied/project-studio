/**
 * Atomic per-provider daily request counter.
 *
 * Cloudflare Durable Objects serialize all fetch() calls to a single instance,
 * so read-increment-write is inherently atomic without explicit transactions.
 *
 * HTTP API (all keyed by ?key= query param):
 *   POST /increment?key={providerKey}  →  { count: N }
 *   GET  /count?key={providerKey}      →  { count: N }
 *   DELETE /usage/cleanup              →  { deleted: N }
 */

function todayUtc(): string {
  const d    = new Date();
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export class RateTrackerDurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "DELETE" && url.pathname === "/usage/cleanup") {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      const yesterday = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

      const allKeys = await this.state.storage.list<number>();
      const toDelete: string[] = [];
      for (const k of allKeys.keys()) {
        const datePart = k.split(":").pop();
        if (datePart && datePart.length === 10 && datePart < yesterday) {
          toDelete.push(k);
        }
      }
      if (toDelete.length > 0) await this.state.storage.delete(toDelete);
      return Response.json({ deleted: toDelete.length });
    }

    const key = url.searchParams.get("key");
    if (!key) {
      return new Response(JSON.stringify({ error: "Missing ?key= param" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const storageKey = `${key}:${todayUtc()}`;

    if (request.method === "POST" && url.pathname === "/increment") {
      const current = (await this.state.storage.get<number>(storageKey)) ?? 0;
      const next    = current + 1;
      await this.state.storage.put(storageKey, next);
      return Response.json({ count: next });
    }

    if (request.method === "GET" && url.pathname === "/count") {
      const count = (await this.state.storage.get<number>(storageKey)) ?? 0;
      return Response.json({ count });
    }

    return new Response("Not found", { status: 404 });
  }
}
