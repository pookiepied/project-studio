import { useEffect, useState } from "react";
import { getCachedIcon } from "../services/extensions/appIconCache";

/** Resolves `url` through the local icon cache and returns a data-URL once ready. */
export function useCachedIcon(url: string | undefined): string | undefined {
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    setDataUrl(undefined);
    if (!url) return;
    let cancelled = false;
    getCachedIcon(url).then((result) => {
      if (!cancelled) setDataUrl(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return dataUrl;
}
