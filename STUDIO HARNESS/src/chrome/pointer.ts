import type { Page } from "playwright-core";

// The same rounded arrow silhouette and colours as StudioCursor in the client.
const PATH = "M0.6 0.3C-0.25 0 -0.85 0.65 -0.56 1.64L3.47 17.2C3.78 18.58 5.2 18.76 5.93 17.54L9.71 11.72C10 11.26 10.4 10.99 10.88 10.79L17.25 8.54C18.59 8.04 18.61 6.7 17.25 6.18Z";
const STUDIO_MARK = `M27.75 24.639
  C30.3 23.167 27.65 15.4 26.7 10.35 C25.55 6.45 28.35 3 32 3 C35.65 3 38.45 6.45 37.3 10.35 C36.35 15.4 33.7 23.167 36.25 24.639
  C38.8 26.111 44.201 19.933 48.099 16.585 C50.902 13.639 55.29 14.339 57.115 17.5 C58.94 20.661 57.352 24.811 53.399 25.765 C48.551 27.467 40.5 29.056 40.5 32
  C40.5 34.944 48.551 36.533 53.399 38.235 C57.352 39.189 58.94 43.339 57.115 46.5 C55.29 49.661 50.902 50.361 48.099 47.415 C44.201 44.067 38.8 37.889 36.25 39.361
  C33.7 40.833 36.35 48.6 37.3 53.65 C38.45 57.55 35.65 61 32 61 C28.35 61 25.55 57.55 26.7 53.65 C27.65 48.6 30.3 40.833 27.75 39.361
  C25.2 37.889 19.799 44.067 15.901 47.415 C13.098 50.361 8.71 49.661 6.885 46.5 C5.06 43.339 6.648 39.189 10.601 38.235 C15.449 36.533 23.5 34.944 23.5 32
  C23.5 29.056 15.449 27.467 10.601 25.765 C6.648 24.811 5.06 20.661 6.885 17.5 C8.71 14.339 13.098 13.639 15.901 16.585 C19.799 19.933 25.2 26.111 27.75 24.639Z`;

function cursor(scale: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="-22 -22 56 56"><defs><radialGradient id="glow"><stop stop-color="#399fff" stop-opacity=".52"/><stop offset="1" stop-color="#2385ff" stop-opacity="0"/></radialGradient></defs><circle r="22" fill="url(#glow)"/><path transform="scale(${scale})" d="${PATH}" fill="#192330" stroke="#eef6ff" stroke-width="1.45" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 22 22, auto`;
}

const CSS = `:root, :root * { cursor: ${cursor(1)} !important; }
@media (prefers-reduced-motion: no-preference) {
  :root:has(:active), :root:has(:active) * { cursor: ${cursor(0.83)} !important; }
}`;

export async function showChromePointer(page: Page, marker: string): Promise<void> {
  await page.evaluate(({ marker, css, icon }) => {
    const existing = document.getElementById(marker);
    if (existing !== null) {
      existing.dispatchEvent(new Event("studio-renew"));
      return;
    }
    const host = document.createElement("span");
    host.id = marker;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const shadow = host.attachShadow({ mode: "closed" });
    const pulse = document.createElement("span");
    pulse.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;width:14px;height:14px;border:2px solid #399fff;border-radius:50%;opacity:0";
    let motion: Animation | undefined;
    const release = (event: PointerEvent) => {
      if (!event.isTrusted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      motion?.cancel();
      pulse.style.left = `${event.clientX}px`;
      pulse.style.top = `${event.clientY}px`;
      motion = pulse.animate([
        { opacity: 0.9, transform: "translate(-50%, -50%) scale(.55)" },
        { opacity: 0, transform: "translate(-50%, -50%) scale(2)" },
      ], { duration: 220, easing: "ease-out" });
    };
    let timer: number;
    const detach = () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerup", release, true);
      motion?.cancel();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((current) => current !== sheet);
      host.remove();
    };
    const renew = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(detach, 95_000);
    };
    host.addEventListener("studio-detach", detach, { once: true });
    host.addEventListener("studio-renew", renew);
    const badge = document.createElement("span");
    badge.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:7px;pointer-events:none;background:#14253c;color:#f1f7ff;border:1px solid #498aff;border-radius:999px;padding:6px 12px;font:500 12px system-ui;white-space:nowrap";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 64 64");
    svg.setAttribute("width", "13");
    svg.setAttribute("height", "13");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", icon);
    path.setAttribute("fill", "#76b7ff");
    svg.append(path);
    badge.append(svg, "Chrome is being controlled by Studio");
    shadow.append(badge, pulse);
    document.documentElement.append(host);
    document.addEventListener("pointerup", release, true);
    renew();
  }, { marker, css: CSS, icon: STUDIO_MARK });
}

export async function hideChromePointer(page: Page, marker: string): Promise<void> {
  await page.evaluate((id) => document.getElementById(id)?.dispatchEvent(new Event("studio-detach")), marker);
}
