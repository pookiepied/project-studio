import { MODES }                    from "../services/router/modes";
import type { GatewayEnv }          from "../env";
import { addCORSHeaders }           from "../middleware/cors";
import { MODES_CONFIG_KV_KEY }      from "./adminModes";

export async function handleModes(env: GatewayEnv): Promise<Response> {
  let modes = MODES as typeof MODES;

  try {
    const raw = await env.MODELS_KV.get(MODES_CONFIG_KV_KEY);
    if (raw) {
      const overrides = JSON.parse(raw) as Record<string, { modelId: string; description: string }>;
      modes = MODES.map((m) => {
        const o = overrides[m.id];
        if (!o) return m;
        return { ...m, modelId: o.modelId, description: o.description };
      });
    }
  } catch {
    // KV unavailable — serve hardcoded defaults
  }

  const response = new Response(JSON.stringify({ data: modes }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  return addCORSHeaders(response);
}
