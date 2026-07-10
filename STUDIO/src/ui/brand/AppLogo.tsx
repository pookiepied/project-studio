/**
 * AppLogo — the single shared badge for a third-party app's official icon
 * (Composio, etc.). Every place in the app that shows an integration logo
 * (Extensions browse grid, featured cards, manage panel, connect modal,
 * hero banner, chat composer app picker) should render through this
 * component so they share one cache and one fallback behaviour.
 *
 * Backed by the local icon cache (see core/cache/appIconCache.ts),
 * so the remote logo is fetched at most once every 7 days regardless of how
 * many times the badge remounts. Some logo hosts don't send CORS headers,
 * which makes the cache's `fetch()` fail even though the image loads fine
 * as a plain `<img>` — so while the cache is unavailable/still loading, we
 * render `src` directly via `<img>` (a normal image request isn't subject
 * to CORS) and only fall back to `fallback` if that image itself errors.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useCachedIcon } from "@/lib/hooks/useCachedIcon";

export type AppLogoSize = "xs" | "sm" | "md" | "lg" | "xl";

const BADGE: Record<AppLogoSize, string> = {
  xs: "w-5 h-5 rounded-md text-3xs",
  sm: "w-6 h-6 rounded-md text-2xs",
  md: "w-8 h-8 rounded-xl text-sm",
  lg: "w-9 h-9 rounded-xl text-sm",
  xl: "w-[52px] h-[52px] rounded-2xl text-2xl",
};

const IMG_PX: Record<AppLogoSize, number> = { xs: 12, sm: 14, md: 20, lg: 24, xl: 32 };

export interface AppLogoProps {
  /** Remote logo URL. Omit to always render `fallback`. */
  src?: string;
  /** Shown while there's no URL, or the image fails to load. */
  fallback: ReactNode;
  label: string;
  size?: AppLogoSize;
  iconBg?: string;
  iconColor?: string;
  className?: string;
}

export function AppLogo({
  src,
  fallback,
  label,
  size = "md",
  iconBg,
  iconColor,
  className = "",
}: AppLogoProps) {
  const cachedDataUrl = useCachedIcon(src);
  const [imgFailed, setImgFailed] = useState(false);
  const px = IMG_PX[size];

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const displaySrc = cachedDataUrl ?? (!imgFailed ? src : undefined);

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center flex-shrink-0 overflow-hidden font-bold shadow-sm ${BADGE[size]} ${className}`}
      style={{ background: displaySrc ? undefined : iconBg, color: iconColor }}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={label}
          width={px}
          height={px}
          className="object-contain"
          onError={() => setImgFailed(true)}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
