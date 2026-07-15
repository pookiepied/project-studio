import { readFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const transcripts = readFileSync(new URL("../src/server/routes/transcripts.ts", import.meta.url), "utf8");
const conversations = readFileSync(new URL("../src/server/routes/conversations.ts", import.meta.url), "utf8");
const uploads = readFileSync(new URL("../src/server/routes/uploads.ts", import.meta.url), "utf8");
const artifacts = readFileSync(new URL("../src/server/routes/artifacts.ts", import.meta.url), "utf8");
const objects = readFileSync(new URL("../src/storage/objects.ts", import.meta.url), "utf8");
const identity = readFileSync(new URL("../src/server/identity.ts", import.meta.url), "utf8");

const checks = [
  ["storage_objects table", schema.includes("CREATE TABLE IF NOT EXISTS storage_objects")],
  ["conversation_events side payload", schema.includes("side_payload_id TEXT")],
  ["conversation_events segment", schema.includes("segment_id TEXT")],
  ["side payload table", schema.includes("CREATE TABLE IF NOT EXISTS transcript_side_payloads")],
  ["segment table", schema.includes("CREATE TABLE IF NOT EXISTS transcript_segments")],
  ["gzip-only schema modes", schema.includes("CHECK (compression IN ('none','gzip'))") && !schema.toLowerCase().includes("zstd")],
  ["managed object gzip metadata", objects.includes("compressedSizeBytes") && objects.includes("uncompressedSizeBytes")],
  ["managed object delete cleanup", objects.includes("DELETE FROM storage_objects")],
  ["artifact roots table", schema.includes("CREATE TABLE IF NOT EXISTS artifact_roots")],
  ["artifact versions table", schema.includes("CREATE TABLE IF NOT EXISTS artifact_versions")],
  ["artifact events table", schema.includes("CREATE TABLE IF NOT EXISTS artifact_events")],
  ["artifact permission decisions table", schema.includes("CREATE TABLE IF NOT EXISTS artifact_permission_decisions")],
  ["artifact lifecycle states", schema.includes("'awaiting_permission'") && schema.includes("'streaming'") && schema.includes("'rejected'")],
  ["artifact transcript event kinds", schema.includes("'artifact_created'") && schema.includes("'artifact_permission_requested'")],
  ["transcript export endpoint", transcripts.includes('transcriptsRoute.get("/export"')],
  ["side payload endpoint", transcripts.includes('transcriptsRoute.get("/payloads/:id"')],
  ["segment seal endpoint", transcripts.includes('transcriptsRoute.post("/segments/seal"')],
  ["inactive segment seal endpoint", transcripts.includes('transcriptsRoute.post("/segments/seal-inactive"')],
  ["conversation delete transcript cleanup", conversations.includes("DELETE FROM conversation_events")],
  ["conversation delete object cleanup", conversations.includes("deleteManagedObject")],
  ["shared identity helper", identity.includes("requireOwnedConversation") && identity.includes("readOwnedArtifact")],
  ["message conflict user scoped", conversations.includes("WHERE messages.user_id = excluded.user_id")],
  ["conversation id conflict guarded", conversations.includes('c.json({ error: "id_conflict" }, 409)')],
  ["upload conversation ownership", uploads.includes("requireOwnedConversation")],
  ["artifact conversation ownership", artifacts.includes("requireOwnedConversation")],
  ["artifact previous ownership", artifacts.includes("readOwnedArtifact")],
  ["artifact root/version route", artifacts.includes("artifact_roots") && artifacts.includes("artifact_versions")],
  ["artifact permission route", artifacts.includes('artifactsRoute.post("/:id/permissions"')],
  ["artifact event route", artifacts.includes('artifactsRoute.post("/:id/events"')],
  ["artifact content route", artifacts.includes('artifactsRoute.get("/:id/content"')],
  ["transcript artifact ownership", transcripts.includes("artifact_not_found") && transcripts.includes("artifact_conversation_mismatch")],
  ["append segment accounting only new rows", transcripts.includes("const newEvents = preparedEvents.filter((item) => item.isNew)")],
  ["empty segment update guarded", transcripts.includes("if (!preparedEvents.length) return")],
  ["retry preserves existing event content", transcripts.includes("content=COALESCE(excluded.content, conversation_events.content)")],
  ["side payload cleanup on append failure", transcripts.includes("cleanupSidePayload")],
  ["managed object hash verification", objects.includes("verifyContentHash")],
];

const sample = "studio transcript gzip verification";
const roundTrip = gunzipSync(gzipSync(sample)).toString("utf8") === sample;
checks.push(["gzip round trip", roundTrip]);

const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}

for (const [name] of checks) console.log(`PASS ${name}`);
