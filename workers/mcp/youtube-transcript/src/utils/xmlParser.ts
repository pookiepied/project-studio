import { MAX_TRANSCRIPT_CHARS } from "../constants";

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

interface Json3Data {
  events?: Json3Event[];
}

export function parseJson3Captions(data: Json3Data): string {
  const parts: string[] = [];

  for (const event of data.events ?? []) {
    if (!event.segs) continue;

    const text = event.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\n/g, " ")
      .trim();

    if (text) parts.push(text);
  }

  const joined = parts.join(" ").replace(/\s{2,}/g, " ").trim();
  return joined.slice(0, MAX_TRANSCRIPT_CHARS);
}

// Fallback for endpoints that return XML instead of JSON3.
// Handles: <text start="0.00" dur="1.50">Hello &amp; world</text>
export function parseXmlCaptions(xml: string): string {
  const parts: string[] = [];
  const tagRe = /<text[^>]*>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(xml)) !== null) {
    const decoded = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, " ")
      .trim();

    if (decoded) parts.push(decoded);
  }

  const joined = parts.join(" ").replace(/\s{2,}/g, " ").trim();
  return joined.slice(0, MAX_TRANSCRIPT_CHARS);
}
