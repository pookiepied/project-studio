import { AwsClient } from "aws4fetch";
import { Env } from "../env";
import { logger } from "../logger";

/**
 * Generate a cryptographically-signed presigned URL for temporary R2 object access.
 *
 * The URL is:
 * - Publicly accessible but cryptographically signed
 * - Time-limited (signature expires automatically)
 * - Single-object only (cannot be used to access other objects)
 * - Self-validating (R2 validates signature and expiration)
 *
 * No manual deletion or revocation needed — signature becomes invalid after expiration.
 */
export async function generateR2PresignedUrl(
  env: Env,
  bucket: string,
  key: string,
  expirationSeconds: number = 600
): Promise<string | null> {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID) {
    return null;
  }

  try {
    const client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    });

    // R2 URL format: bucket-name.account-id.r2.cloudflarestorage.com/{object-key}
    // Add X-Amz-Expires to URL BEFORE signing — it must be included in the signature
    const r2Url = `https://${bucket}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}?X-Amz-Expires=${expirationSeconds}`;
    const request = new Request(r2Url, { method: "GET" });

    // Sign the request for query parameter presigned URL
    // aws4fetch will add X-Amz-Date, X-Amz-Algorithm, X-Amz-Credential, X-Amz-Signature, etc.
    const signedRequest = await client.sign(request, {
      aws: { signQuery: true },
    });

    // The signed URL is valid for a default period (typically 7 days in AWS)
    // To specify custom expiration, we need to add X-Amz-Expires before signing
    // For now, using default expiration which should be acceptable for temporary images
    return signedRequest.url.toString();
  } catch (err: any) {
    logger.error("generateR2PresignedUrl: failed", { error: err?.message });
    return null;
  }
}
