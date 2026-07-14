import type { Env } from "../system/env";

export type ObjectBucket = "conversations" | "uploads" | "generated";

export function objectKey(userId: string, category: ObjectBucket, id: string): string {
  return `${userId}/${category}/${id}`;
}

export async function putObject(
  env: Env,
  bucket: ObjectBucket,
  key: string,
  body: ReadableStream | ArrayBuffer | string,
  contentType: string,
): Promise<void> {
  await bucketFor(env, bucket).put(key, body, {
    httpMetadata: { contentType },
  });
}

export async function getObject(
  env: Env,
  bucket: ObjectBucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return bucketFor(env, bucket).get(key);
}

export async function deleteObject(
  env: Env,
  bucket: ObjectBucket,
  key: string,
): Promise<void> {
  await bucketFor(env, bucket).delete(key);
}

function bucketFor(env: Env, bucket: ObjectBucket): R2Bucket {
  switch (bucket) {
    case "conversations":
      return env.CONVERSATIONS;
    case "uploads":
      return env.UPLOADS;
    case "generated":
      return env.GENERATED;
  }
}
