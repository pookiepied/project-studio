export type StorageCompression = "none" | "gzip";

export async function gzipText(input: string): Promise<ArrayBuffer> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function gunzipText(input: ArrayBuffer | ReadableStream): Promise<string> {
  const stream = input instanceof ReadableStream ? input : new Blob([input]).stream();
  return new Response(stream.pipeThrough(new DecompressionStream("gzip"))).text();
}

export function shouldCompressText(contentType: string, byteLength: number): boolean {
  if (byteLength < 16 * 1024) return false;
  return isTextLikeContentType(contentType);
}

export function isTextLikeContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.startsWith("text/")
    || normalized.includes("json")
    || normalized.includes("xml")
    || normalized.includes("markdown")
    || normalized.includes("yaml")
    || normalized.includes("csv")
    || normalized.includes("javascript")
    || normalized.includes("typescript");
}

