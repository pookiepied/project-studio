import type { IconCache } from "../cache.js";
import {
  ICON_MAX_BYTES,
  ICON_TIMEOUT_MS,
  VALID_ID,
  type Fetcher,
  type IconAnswer,
  type IconSource,
} from "../source.js";

/**
 * lobehub -- the source for model authors, which models.dev is weak at.
 *
 * Measured against the 51 author names that reach a mark in OpenRouter's live
 * catalog: models.dev has 25, this has 34. Together they reach 36. That
 * difference is the entire reason this file exists -- it is not a fallback for
 * when models.dev is down, it covers a genuinely different population. The
 * reverse is also true and is why it is second: of models.dev's 190 logos this
 * has 44, so it would be a poor primary.
 *
 * Two things make it much simpler than the other source:
 *
 * 1. jsDelivr answers **404 for an id it does not have**. There is no
 *    placeholder to hash and no index to keep, so a fetch is the membership
 *    test. Most of the machinery in `models-dev.ts` has no counterpart here.
 * 2. The plain files are already monochrome. lobehub publishes `<name>.svg`
 *    with no fills at all and `<name>-color.svg` beside it; we ask for the
 *    former, so the mark arrives in the shape a CSS mask needs. Verified
 *    across the vendors we draw: no `fill` attribute in any of them.
 *
 * The colour variants are deliberately not used. They exist, they are good,
 * and adopting them is a decision about identity rather than about coverage --
 * a coloured SVG cannot be a mask, so it would change how every mark is
 * painted. See the note in `ProviderMark.tsx` in the webview.
 */

// Pinned to the major, not to `latest`. A major range still picks up new
// brands as they are published -- which is the point of a live source -- while
// a major bump stays a decision someone makes rather than one that arrives.
const BASE = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1/icons/";

/**
 * lobehub names a brand for the lab, we name it for the endpoint or the
 * OpenRouter author, and the two disagree more often than models.dev does.
 *
 * The interesting entries are the ones where lobehub uses the *product* name:
 * Anthropic's mark is filed under `claude`, Moonshot's under `kimi`, xAI's
 * under `grok`. Without these the biggest brands in the catalog would miss.
 */
const ALIASES: Readonly<Record<string, string>> = {
  anthropic: "claude",
  "meta-llama": "meta",
  mistralai: "mistral",
  "x-ai": "grok",
  xai: "grok",
  "z-ai": "zhipu",
  zai: "zhipu",
  zhipuai: "zhipu",
  moonshotai: "kimi",
  moonshot: "kimi",
  "github-copilot": "copilot",
  togetherai: "together",
  "together-ai": "together",
  "ibm-granite": "ibm",
  "fireworks-ai": "fireworks",
  "bytedance-seed": "bytedance",
  amazon: "bedrock",
  "amazon-bedrock": "bedrock",
  rekaai: "reka",
  "arcee-ai": "arcee",
  "aion-labs": "aionlabs",
  microsoft: "azure",
  "azure-cognitive-services": "azure",
  "cloudflare-workers-ai": "cloudflare",
  "cloudflare-ai-gateway": "cloudflare",
  "minimax-cn": "minimax",
  "moonshotai-cn": "kimi",
  "zai-coding-plan": "zhipu",
};

export interface LobehubOptions {
  readonly cache: IconCache;
  readonly fetcher: Fetcher;
}

export function createLobehubSource(options: LobehubOptions): IconSource {
  const { cache, fetcher } = options;

  return {
    name: "lobehub",
    async get(id: string): Promise<IconAnswer> {
      const remoteId = ALIASES[id] ?? id;
      if (!VALID_ID.test(remoteId)) return { kind: "absent" };

      const cached = cache.readText(`${remoteId}.svg`);
      if (cached !== undefined) return { kind: "found", svg: cached };

      try {
        const response = await fetcher({
          url: `${BASE}${remoteId}.svg`,
          author: "user",
          headers: { accept: "image/svg+xml" },
          timeoutMs: ICON_TIMEOUT_MS,
          maxBytes: ICON_MAX_BYTES,
        });
        // 404 is the membership test, and it is a real answer rather than a
        // body we have to recognise. Anything else that is not a 200 is the
        // CDN having a bad day, which must not be remembered as an absence.
        if (response.status === 404) return { kind: "absent" };
        if (response.status !== 200) return { kind: "unavailable" };
        if (!(response.headers["content-type"] ?? "").includes("svg")) {
          return { kind: "absent" };
        }
        cache.writeText(`${remoteId}.svg`, response.body);
        return { kind: "found", svg: response.body };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
