import type { GatewayEnv }       from "../env";
import { logger }                 from "../logger";
import { handleTranscription }    from "./audio";

// Internal STT relay — reachable only via Cloudflare service binding.
// Called by youtube-transcript-mcp so it can use provider credentials
// without duplicating secrets. Routes through handleTranscription so all
// provider validation, model catalog checks, and rate limiting run as normal.

export async function handleInternalStt(
  request: Request,
  env: GatewayEnv
): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid multipart form data." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const file = formData.get("file");
  const qualifiedModel = formData.get("model") as string | null;

  if (!file || typeof file === "string") {
    return new Response(
      JSON.stringify({ error: "Missing 'file' field." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const audioFile = file as File;

  if (!qualifiedModel) {
    return new Response(
      JSON.stringify({ error: "Missing 'model' field." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const language = formData.get("language") as string | null;
  const filename = audioFile.name || "audio.webm";

  const proxyForm = new FormData();
  proxyForm.append("file", audioFile, filename);
  proxyForm.append("model", qualifiedModel);
  proxyForm.append("response_format", "json");
  if (language) proxyForm.append("language", language);

  const internalReq = new Request(
    "http://internal/v1/audio/transcriptions",
    { method: "POST", body: proxyForm },
  );

  logger.info("internalStt: delegating to handleTranscription", {
    model: qualifiedModel,
    language: language ?? "auto",
    size: audioFile.size,
  });

  return handleTranscription(internalReq, env);
}
