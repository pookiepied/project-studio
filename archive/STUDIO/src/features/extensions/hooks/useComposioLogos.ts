import { useEffect, useState } from "react";
import { listComposioApps } from "@/features/extensions/services/composioService";

// Module-level so every consumer (app picker, featured cards, browse grid)
// shares one in-flight request instead of each mount re-fetching the catalogue.
let logosPromise: Promise<Map<string, string>> | null = null;

function loadLogos(): Promise<Map<string, string>> {
  if (!logosPromise) {
    logosPromise = listComposioApps()
      .then(({ items }) => new Map(items.map((app) => [app.appId.toLowerCase(), app.logo])))
      .catch(() => new Map<string, string>());
  }
  return logosPromise;
}

/** Maps Composio `appId` (lowercased) to its logo URL, fetched once per session. */
export function useComposioLogos(): Map<string, string> {
  const [logos, setLogos] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    loadLogos().then((result) => {
      if (!cancelled) setLogos(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return logos;
}
