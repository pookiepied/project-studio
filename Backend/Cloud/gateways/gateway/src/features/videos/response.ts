import type { MediaResponse, VideoGenerationResponse } from "@/domain/contracts";
import { encodeBase64 } from "@/platform/encoding/base64";

export function toVideoResponse(response: VideoGenerationResponse) {
  if (response.jobId && !response.media) {
    return { created: nowSeconds(), status: "processing", jobId: response.jobId };
  }

  const media = response.media ?? {};
  const items = media.items?.length ? media.items : [media];
  return {
    created: nowSeconds(),
    data: items.map((item: MediaResponse) => {
      if (item.url) return { url: item.url, media_type: item.mediaType };
      return {
        b64_json: item.base64 ?? (item.bytes ? encodeBase64(item.bytes) : undefined),
        media_type: item.mediaType
      };
    }),
    usage: media.usage
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
