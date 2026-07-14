/**
 * video_status — poll an async video generation job via the gateway.
 * Ported from the chat worker's VideoStatusTool. Pure GATEWAY pass-through.
 */

export interface VideoStatusEnv {
  GATEWAY?: Fetcher;
}

export interface VideoStatusArgs {
  jobId: string;
  model: string;
}

export async function runVideoStatus(env: VideoStatusEnv, args: VideoStatusArgs): Promise<unknown> {
  if (!env?.GATEWAY) return { error: "GATEWAY service binding is not configured." };

  const jobId = String(args.jobId ?? "");
  const model = String(args.model ?? "");

  const colonIdx = model.indexOf(":");
  const modelId  = colonIdx === -1 ? model : model.slice(colonIdx + 1);

  const encodedJobId = encodeURIComponent(jobId);

  try {
    const gatewayResp = await env.GATEWAY.fetch(
      `http://studio-gateway/v1/videos/status/${encodedJobId}`,
      { method: "GET" }
    );

    if (!gatewayResp.ok) {
      const errText = await gatewayResp.text();
      let errMsg = errText;
      try { errMsg = JSON.parse(errText)?.error?.message ?? errText; } catch { /* keep raw */ }
      return { error: `Video status check failed: ${errMsg}` };
    }

    const data = await gatewayResp.json() as Record<string, unknown>;
    return {
      jobId:        data.job_id ?? jobId,
      status:       data.status,
      videoUrl:     data.video_url,
      thumbnailUrl: data.thumbnail_url,
      durationSecs: data.duration_secs,
      provider:     data.provider,
      model:        modelId || data.model,
      error:        data.error,
    };
  } catch (e: any) {
    return { error: `Gateway request failed: ${e.message}` };
  }
}
