import type { MediaResponse } from "@/domain/contracts";
import { encodeBase64 } from "@/platform/encoding/base64";

export function toImageResponse(response: MediaResponse, requestedFormat?: "url" | "b64_json") {
  const items = response.items?.length ? response.items : [response];
  return {
    created: Math.floor(Date.now() / 1000),
    data: items.map((item) => {
      if (requestedFormat === "url" && item.url) return { url: item.url };
      return {
        b64_json: item.base64 ?? (item.bytes ? encodeBase64(item.bytes) : undefined)
      };
    }),
    usage: response.usage
  };
}
