import { getTransport } from "../../../core/transport";
import { mapProviderError } from "../../../core/errors";
import type { HandlerContext } from "../../../core/registry";
import type { CreditsSnapshot } from "../../credits/credits";

// OpenRouter exposes a real balance endpoint that most providers do not:
//   GET /api/v1/credits → { data: { total_credits, total_usage } }  (both USD)
// Through CF AI Gateway this is `.../openrouter/credits`. Remaining balance is the difference.
interface OpenRouterCreditsResponse {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
}

export async function openrouterCredits(context: HandlerContext): Promise<CreditsSnapshot> {
  try {
    const transport = getTransport("openrouter", context.env);
    const response = await transport.fetch(`${transport.baseURL}/credits`, {
      headers: transport.headers
    });

    if (!response.ok) {
      throw new Error(`OpenRouter credits request failed with HTTP ${response.status}.`);
    }

    const body = (await response.json()) as OpenRouterCreditsResponse;
    const totalCredits = body.data?.total_credits;
    const totalUsage = body.data?.total_usage;
    const remaining =
      typeof totalCredits === "number" && typeof totalUsage === "number" ? totalCredits - totalUsage : undefined;

    return {
      provider: "openrouter",
      supported: true,
      balance: {
        currency: "USD",
        totalCredits,
        totalUsage,
        remaining
      }
    };
  } catch (error) {
    throw mapProviderError(error);
  }
}
