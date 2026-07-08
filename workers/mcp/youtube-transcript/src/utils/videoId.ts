const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// youtube.com path segments that precede a video ID
const PATH_PREFIX_SEGMENTS = new Set(["shorts", "embed", "live", "v", "e"]);

export function extractVideoId(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;

  let parsed: URL;
  try {
    const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  // youtu.be/<ID>
  if (hostname === "youtu.be") {
    const id = parsed.pathname.slice(1).split("?")[0].split("/")[0];
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  // Must be a youtube.* domain — covers youtube.com, youtube.co.uk,
  // m.youtube.com, music.youtube.com, country TLDs, etc.
  if (!hostname.includes("youtube.")) return null;

  // ?v=<ID>  (standard watch URL)
  const vParam = parsed.searchParams.get("v");
  if (vParam && VIDEO_ID_RE.test(vParam)) return vParam;

  // /shorts/<ID>, /embed/<ID>, /live/<ID>, /v/<ID>, /e/<ID>
  const parts = parsed.pathname.split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    if (PATH_PREFIX_SEGMENTS.has(parts[i])) {
      const id = parts[i + 1].split("?")[0];
      if (VIDEO_ID_RE.test(id)) return id;
    }
  }

  return null;
}
