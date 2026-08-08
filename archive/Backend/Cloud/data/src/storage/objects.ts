import type { Env } from "../system/env";
import { gzipText, gunzipText, shouldCompressText, type StorageCompression } from "./compression";
import { sha256Hex } from "./hash";

export type ObjectBucket = "conversations" | "uploads" | "generated";
export type StoredObjectResourceType =
  | "upload"
  | "artifact"
  | "artifact_payload"
  | "artifact_preview"
  | "transcript-segment"
  | "side-payload"
  | "context-snapshot"
  | "generated-output";

export interface StoredObjectRecord {
  id: string;
  userId: string;
  conversationId?: string | null;
  bucket: ObjectBucket;
  storageKey: string;
  resourceType: StoredObjectResourceType;
  resourceId?: string | null;
  contentType: string;
  compression: StorageCompression;
  sizeBytes: number;
  compressedSizeBytes?: number | null;
  uncompressedSizeBytes?: number | null;
  contentHash?: string | null;
  metadata?: Record<string, unknown>;
}

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

export async function putManagedObject(
  env: Env,
  input: {
    userId: string;
    conversationId?: string | null;
    bucket: ObjectBucket;
    resourceType: StoredObjectResourceType;
    resourceId?: string | null;
    contentType: string;
    body: ArrayBuffer | string;
    compress?: boolean | "auto";
    metadata?: Record<string, unknown>;
  },
): Promise<StoredObjectRecord> {
  const objectId = `obj_${crypto.randomUUID()}`;
  const storageKey = objectKey(input.userId, input.bucket, objectId);
  const rawBytes = typeof input.body === "string" ? new TextEncoder().encode(input.body).buffer : input.body;
  const rawLength = rawBytes.byteLength;
  const shouldGzip = input.compress === true || (input.compress === "auto" && typeof input.body === "string" && shouldCompressText(input.contentType, rawLength));
  const storedBody = shouldGzip && typeof input.body === "string" ? await gzipText(input.body) : rawBytes;
  const compression: StorageCompression = shouldGzip && typeof input.body === "string" ? "gzip" : "none";
  const contentHash = `sha256:${await sha256Hex(rawBytes)}`;

  await putObject(env, input.bucket, storageKey, storedBody, input.contentType);
  const record: StoredObjectRecord = {
    id: objectId,
    userId: input.userId,
    conversationId: input.conversationId,
    bucket: input.bucket,
    storageKey,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    contentType: input.contentType,
    compression,
    sizeBytes: storedBody.byteLength,
    compressedSizeBytes: compression === "gzip" ? storedBody.byteLength : null,
    uncompressedSizeBytes: rawLength,
    contentHash,
    metadata: input.metadata ?? {},
  };
  await insertObjectRecord(env, record);
  return record;
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

export async function deleteManagedObject(env: Env, userId: string, objectId: string): Promise<boolean> {
  const record = await readObjectRecord(env, userId, objectId);
  if (!record) return false;
  await deleteObject(env, record.bucket, record.storageKey);
  await env.DATA_DB.prepare("DELETE FROM storage_objects WHERE id = ? AND user_id = ?")
    .bind(objectId, userId)
    .run();
  return true;
}

export async function readObjectRecord(env: Env, userId: string, objectId: string): Promise<StoredObjectRecord | null> {
  const row = await env.DATA_DB.prepare(
    `SELECT id, user_id AS userId, conversation_id AS conversationId, bucket, storage_key AS storageKey,
      resource_type AS resourceType, resource_id AS resourceId, content_type AS contentType, compression,
      size_bytes AS sizeBytes, compressed_size_bytes AS compressedSizeBytes,
      uncompressed_size_bytes AS uncompressedSizeBytes, content_hash AS contentHash, metadata
     FROM storage_objects WHERE id = ? AND user_id = ?`,
  ).bind(objectId, userId).first<StoredObjectRecord & { metadata: string }>();
  if (!row) return null;
  return { ...row, metadata: parseMetadata(row.metadata) };
}

export async function getManagedObject(
  env: Env,
  userId: string,
  objectId: string,
): Promise<{ record: StoredObjectRecord; body: BodyInit } | null> {
  const record = await readObjectRecord(env, userId, objectId);
  if (!record) return null;
  const object = await getObject(env, record.bucket, record.storageKey);
  if (!object) return null;
  if (record.compression === "gzip") {
    const body = await gunzipText(object.body);
    await verifyContentHash(record, body);
    return { record, body };
  }
  const body = await object.arrayBuffer();
  await verifyContentHash(record, body);
  return { record, body };
}

async function insertObjectRecord(env: Env, record: StoredObjectRecord): Promise<void> {
  await env.DATA_DB.prepare(
    `INSERT INTO storage_objects
      (id,user_id,conversation_id,bucket,storage_key,resource_type,resource_id,content_type,
       compression,size_bytes,compressed_size_bytes,uncompressed_size_bytes,content_hash,metadata)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    record.id,
    record.userId,
    record.conversationId ?? null,
    record.bucket,
    record.storageKey,
    record.resourceType,
    record.resourceId ?? null,
    record.contentType,
    record.compression,
    record.sizeBytes,
    record.compressedSizeBytes ?? null,
    record.uncompressedSizeBytes ?? null,
    record.contentHash ?? null,
    JSON.stringify(record.metadata ?? {}),
  ).run();
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function verifyContentHash(record: StoredObjectRecord, body: ArrayBuffer | string): Promise<void> {
  if (!record.contentHash?.startsWith("sha256:")) return;
  const actual = `sha256:${await sha256Hex(body)}`;
  if (actual !== record.contentHash) throw new Error("object_integrity_mismatch");
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
