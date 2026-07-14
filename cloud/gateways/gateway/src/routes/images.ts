import type { GatewayEnv }   from "../env";
import { createErrorResponse } from "../middleware/response";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function handleImageServe(imageId: string, env: GatewayEnv): Promise<Response> {
  if (!env.IMAGES_BUCKET) {
    return createErrorResponse("Storage not configured.", 503, "service_unavailable");
  }
  if (!UUID_RE.test(imageId)) {
    return createErrorResponse("Invalid image ID.", 400, "bad_request");
  }

  const object = await env.IMAGES_BUCKET.get(`images/${imageId}`);
  if (!object) {
    return createErrorResponse("Image not found or expired.", 404, "not_found");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=86400, immutable");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(object.body, { headers });
}

export async function handleImageDelete(imageId: string, env: GatewayEnv): Promise<Response> {
  if (!env.IMAGES_BUCKET) {
    return createErrorResponse("Storage not configured.", 503, "service_unavailable");
  }
  if (!UUID_RE.test(imageId)) {
    return createErrorResponse("Invalid image ID.", 400, "bad_request");
  }

  await env.IMAGES_BUCKET.delete(`images/${imageId}`);
  return new Response(null, { status: 204 });
}

export async function cleanupExpiredImages(env: GatewayEnv): Promise<void> {
  if (!env.IMAGES_BUCKET) return;

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let cursor: string | undefined;

  do {
    const listed = await env.IMAGES_BUCKET.list({ prefix: "images/", limit: 200, cursor });
    const toDelete: string[] = [];

    for (const obj of listed.objects) {
      const uploadedAt = obj.uploaded?.getTime() ?? 0;
      if (uploadedAt > 0) {
        if (uploadedAt < cutoff) toDelete.push(obj.key);
      } else {
        const head = await env.IMAGES_BUCKET.head(obj.key);
        const createdAt = head?.customMetadata?.createdAt;
        if (!createdAt || parseInt(createdAt, 10) < cutoff) toDelete.push(obj.key);
      }
    }

    if (toDelete.length > 0) {
      await Promise.all(toDelete.map((k) => env.IMAGES_BUCKET!.delete(k)));
    }

    cursor = listed.truncated ? (listed as any).cursor : undefined;
  } while (cursor);
}

export async function cleanupExpiredTempImages(env: GatewayEnv): Promise<void> {
  if (!env.TEMP_IMAGES_BUCKET) return;

  const now = Date.now();
  let cursor: string | undefined;

  do {
    const listed = await env.TEMP_IMAGES_BUCKET.list({ prefix: "temp-images/", limit: 200, cursor });
    const toDelete: string[] = [];

    for (const obj of listed.objects) {
      const uploadedAt = obj.uploaded?.getTime() ?? 0;
      const staleByAge = uploadedAt > 0 && now - uploadedAt > 30 * 60 * 1000;

      if (staleByAge) {
        toDelete.push(obj.key);
      } else {
        const head = await env.TEMP_IMAGES_BUCKET.head(obj.key);
        const expiresAt = head?.customMetadata?.expiresAt;
        if (expiresAt && parseInt(expiresAt, 10) < now) toDelete.push(obj.key);
      }
    }

    if (toDelete.length > 0) {
      await Promise.all(toDelete.map((k) => env.TEMP_IMAGES_BUCKET!.delete(k)));
    }

    cursor = listed.truncated ? (listed as any).cursor : undefined;
  } while (cursor);
}
