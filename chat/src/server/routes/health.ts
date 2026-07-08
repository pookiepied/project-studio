import { VERSION, WORKER_NAME } from "@gateway/config/constants";
import { HealthResponse } from "../types";
import { addCORSHeaders } from "@gateway/middleware/cors";
import { Env } from "../../env";

/**
 * Probe each storage binding to detect misconfigured or degraded deployments.
 * All probes run in parallel — total latency is the slowest individual probe.
 * Returns a map of binding names → "ok" | "error".
 */
async function probeBindings(env: Env): Promise<Record<string, "ok" | "error">> {
  const probes: Array<{ name: string; probe: () => Promise<unknown> }> = [
    {
      name: "CHAT_DB",
      probe: () => env.CHAT_DB.prepare("SELECT 1").first(),
    },
    {
      name: "MODELS_KV",
      // Lightweight read — key almost certainly absent, but any non-throw response means KV is reachable.
      probe: () => env.MODELS_KV.get("__health_check__"),
    },
    {
      name: "MCP_KV",
      probe: () => env.MCP_KV.get("__health_check__"),
    },
  ];

  if (env.TRACKER) {
    probes.push({
      name: "TRACKER",
      probe: () => env.TRACKER!.fetch("https://tracker/health"),
    });
  }

  if (env.CREDITS_KV) {
    probes.push({
      name: "CREDITS_KV",
      probe: () => env.CREDITS_KV!.get("__health_check__"),
    });
  }

  const results = await Promise.allSettled(probes.map((p) => p.probe()));

  const bindings: Record<string, "ok" | "error"> = {};
  for (let i = 0; i < probes.length; i++) {
    bindings[probes[i].name] = results[i].status === "fulfilled" ? "ok" : "error";
  }
  return bindings;
}

export async function handleHealth(env: Env): Promise<Response> {
  const bindings = await probeBindings(env);
  const anyError = Object.values(bindings).some((s) => s === "error");

  const health: HealthResponse = {
    status: anyError ? "degraded" : "ok",
    worker: WORKER_NAME,
    timestamp: new Date().toISOString(),
    version: VERSION,
    bindings,
  };

  const response = new Response(JSON.stringify(health), {
    // Return 200 even when degraded so load balancers keep the instance alive.
    // Consumers should inspect the `status` field and `bindings` map.
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });

  return addCORSHeaders(response);
}
