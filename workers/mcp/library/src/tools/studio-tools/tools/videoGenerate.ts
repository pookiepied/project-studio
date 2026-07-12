/**
 * video_generate — submit an async video generation job via the gateway.
 * Ported from the chat worker's VideoGenerateTool. Pure GATEWAY pass-through.
 */

export interface VideoGenEnv {
  GATEWAY?: Fetcher;
}

export interface VideoGenerateArgs {
  model: string;
  prompt: string;
  source_image?: string;
  aspect_ratio?: string;
  duration?: number;
}

export async function runVideoGenerate(env: VideoGenEnv, args: VideoGenerateArgs): Promise<unknown> {
  if (!env?.GATEWAY) return { error: "GATEWAY service binding is not configured." };

  const model  = String(args.model ?? "");
  const prompt = String(args.prompt ?? "");
  const { source_image, aspect_ratio, duration } = args;

  const colonIdx = model.indexOf(":");
  const provider = colonIdx === -1 ? "fal" : model.slice(0, colonIdx);
  const modelId  = colonIdx === -1 ? model : model.slice(colonIdx + 1);

  const requestBody: Record<string, unknown> = { provider, modelId, prompt };
  if (aspect_ratio) requestBody.aspect_ratio = aspect_ratio;
  if (duration)     requestBody.duration     = duration;
  if (source_image) requestBody.source_image = source_image;

  try {
    const gatewayResp = await env.GATEWAY.fetch("http://studio-gateway/v1/videos/generate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(requestBody),
    });

    if (!gatewayResp.ok) {
      const errText = await gatewayResp.text();
      let errMsg = errText;
      try { errMsg = JSON.parse(errText)?.error?.message ?? errText; } catch { /* keep raw */ }
      return { error: `Video generation failed: ${errMsg}` };
    }

    const data = await gatewayResp.json() as Record<string, unknown>;
    return {
      jobId:    data.job_id,
      status:   data.status,
      provider,
      falModel: `${provider}:${modelId}`,
    };
  } catch (e: any) {
    return { error: `Gateway request failed: ${e.message}` };
  }
}
