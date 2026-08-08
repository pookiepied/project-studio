import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const persistTo = mkdtempSync(join(tmpdir(), "studio-data-"));
const port = Number(process.env.STUDIO_DATA_VERIFY_PORT ?? 8700 + Math.floor(Math.random() * 700));
const baseUrl = `http://127.0.0.1:${port}`;
const userId = "verify_user";
const otherUserId = "verify_other_user";

let dev;
let devOutput = "";
try {
  console.log(`Using temporary Wrangler state: ${persistTo}`);
  run(npx, ["wrangler", "d1", "execute", "studio-data", "--local", "--persist-to", persistTo, "--file", "./schema.sql"]);
  console.log("Applied local D1 schema");
  dev = spawn(npx, [
    "wrangler",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    persistTo,
    "--var",
    "ENVIRONMENT:local",
    "--log-level",
    "debug",
  ], { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });

  await waitForWorker(dev);
  console.log("Worker is ready");
  await verifyFlow();
  console.log("PASS local Studio Data integration flow");
} finally {
  await stopDev(dev);
  await removeTempState(persistTo);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed
status: ${result.status}
error: ${result.error?.message ?? "none"}
stdout: ${result.stdout ?? ""}
stderr: ${result.stderr ?? ""}`);
  }
}

async function waitForWorker(child) {
  child.stdout.on("data", (chunk) => {
    devOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    devOutput += chunk.toString();
  });

  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early\n${devOutput}`);
    try {
      const response = await fetchWithTimeout(`${baseUrl}/health`, {}, 1_000);
      if (response.ok) return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`Timed out waiting for wrangler dev\n${devOutput}`);
}

async function verifyFlow() {
  const conversation = await request("/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "Transcript verification" }),
  });
  assert(conversation.id?.startsWith("conv_"), "conversation id was not created");
  await verifyUserIsolation(conversation.id);

  const largeContent = "large tool result line\n".repeat(5_000);
  const append = await request("/transcripts/events", {
    method: "POST",
    body: JSON.stringify({
      events: [
        {
          conversationId: conversation.id,
          turnId: "turn_verify_1",
          source: "frontend",
          kind: "user_message",
          visibility: "renderable",
          content: "hello from integration verification",
        },
        {
          conversationId: conversation.id,
          turnId: "turn_verify_1",
          source: "tool-execution",
          kind: "tool_result",
          visibility: "model",
          toolCallId: "tc_verify_1",
          toolName: "verify_tool",
          summary: "large tool result summary",
          content: largeContent,
        },
      ],
    }),
  }, 201);
  assert(append.events === 2, "transcript append count mismatch");
  assert(append.inserted === 2, "transcript inserted count mismatch");

  const retry = await request("/transcripts/events", {
    method: "POST",
    body: JSON.stringify({
      events: [
        {
          conversationId: conversation.id,
          turnId: "turn_verify_1",
          sequence: 1,
          source: "frontend",
          kind: "user_message",
          visibility: "renderable",
          content: "hello from integration verification",
        },
      ],
    }),
  }, 201);
  assert(retry.inserted === 0 && retry.updated === 1, "transcript retry did not behave idempotently");

  const artifact = await request("/artifacts", {
    method: "POST",
    body: JSON.stringify({
      conversationId: conversation.id,
      turnId: "turn_verify_1",
      executionId: "exec_verify_1",
      toolCallId: "tc_verify_1",
      family: "activity",
      type: "execution_progress",
      status: "awaiting_permission",
      title: "Verifying artifact foundation",
      summary: "Artifact created during local integration verification.",
      modelPresentation: { activityLabel: "Checking artifact persistence" },
      runtimeData: { executionId: "exec_verify_1", toolCallId: "tc_verify_1" },
      placement: { sequence: 3, afterEventId: "turn_verify_1" },
      metadata: { verify: true },
    }),
  }, 201);
  assert(artifact.id?.startsWith("art_"), "artifact root id was not created");
  assert(artifact.current?.id?.startsWith("artv_"), "artifact version id was not created");
  assert(artifact.family === "activity", "artifact family mismatch");
  assert(artifact.current.status === "awaiting_permission", "artifact status mismatch");

  const permission = await request(`/artifacts/${artifact.id}/permissions`, {
    method: "POST",
    body: JSON.stringify({
      conversationId: conversation.id,
      toolCallId: "tc_verify_1",
      permissionRequestId: "perm_verify_1",
      decision: "approved",
      reason: "integration verification",
    }),
  }, 201);
  assert(permission.status === "running", "permission decision did not update artifact status");

  const artifactEvent = await request(`/artifacts/${artifact.id}/events`, {
    method: "POST",
    body: JSON.stringify({
      conversationId: conversation.id,
      eventType: "completed",
      status: "completed",
      title: "Artifact foundation verified",
      summary: "Artifact lifecycle event persisted.",
      transcriptEventId: "ce_verify_artifact_1",
    }),
  }, 201);
  assert(artifactEvent.eventType === "completed", "artifact event was not persisted");

  const updatedArtifact = await request(`/artifacts/${artifact.id}`);
  assert(updatedArtifact.status === "completed", "artifact root status did not update from event");

  const artifactTranscript = await request("/transcripts/events", {
    method: "POST",
    body: JSON.stringify({
      conversationId: conversation.id,
      turnId: "turn_verify_1",
      source: "tool-execution",
      kind: "artifact_completed",
      visibility: "renderable",
      artifactId: artifact.id,
      summary: "Artifact foundation verified inline",
      metadata: { artifactVersionId: updatedArtifact.current.id },
    }),
  }, 201);
  assert(artifactTranscript.inserted === 1, "artifact transcript event was not inserted");

  const otherArtifactTranscript = await fetchWithTimeout(`${baseUrl}/transcripts/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": otherUserId,
    },
    body: JSON.stringify({
      conversationId: conversation.id,
      source: "tool-execution",
      kind: "artifact_reference",
      visibility: "renderable",
      artifactId: artifact.id,
    }),
  }, 10_000);
  assert(otherArtifactTranscript.status === 404, "other user could reference owned artifact in transcript");

  const model = await request(`/transcripts/model?conversationId=${conversation.id}`);
  assert(model.messages.some((message) => message.content.includes("hello from integration")), "model projection missing user message");
  assert(model.toolResults.some((result) => result.toolName === "verify_tool"), "model projection missing tool result summary");

  const events = await request(`/transcripts/events?conversationId=${conversation.id}&limit=10`);
  const toolEvent = events.events.find((event) => event.kind === "tool_result");
  assert(toolEvent?.sidePayloadId, "large tool result was not externalized");

  const payloadResponse = await fetchWithTimeout(`${baseUrl}/transcripts/payloads/${toolEvent.sidePayloadId}`, {
    headers: { "X-User-ID": userId },
  }, 10_000);
  assert(payloadResponse.ok, "side payload fetch failed");
  const payloadText = await payloadResponse.text();
  assert(payloadText === largeContent, "side payload content mismatch");

  const seal = await request("/transcripts/segments/seal", {
    method: "POST",
    body: JSON.stringify({ conversationId: conversation.id, reason: "integration_verify" }),
  });
  assert(seal.sealed >= 1, "manual segment seal did not seal an open segment");

  const segments = await request(`/transcripts/segments?conversationId=${conversation.id}`);
  const sealed = segments.segments.find((segment) => segment.status === "sealed");
  assert(sealed?.objectId, "sealed segment is missing object reference");

  const segmentResponse = await fetchWithTimeout(`${baseUrl}/transcripts/segments/${sealed.id}`, {
    headers: { "X-User-ID": userId },
  }, 10_000);
  assert(segmentResponse.ok, "sealed segment fetch failed");
  const segmentText = await segmentResponse.text();
  assert(segmentText.includes("turn_verify_1"), "sealed segment payload missing event data");

  const exported = await request(`/transcripts/export?conversationId=${conversation.id}&includePayloads=true`);
  assert(exported.format === "studio.transcript.export.v1", "export format mismatch");
  assert(exported.events.length === 3, "export event count mismatch");
  assert(exported.sidePayloads.some((payload) => payload.content === largeContent), "export missing inlined side payload");

  const deleted = await request(`/conversations/${conversation.id}`, { method: "DELETE" });
  assert(deleted.deleted === true, "conversation delete failed");

  const missing = await fetchWithTimeout(`${baseUrl}/conversations/${conversation.id}`, {
    headers: { "X-User-ID": userId },
  }, 10_000);
  assert(missing.status === 404, "deleted conversation still readable");
}

async function verifyUserIsolation(conversationId) {
  const fixedMessageId = `msg_${crypto.randomUUID()}`;
  await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ id: fixedMessageId, role: "user", content: "owned message" }),
  });
  const otherMessage = await fetchWithTimeout(`${baseUrl}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": otherUserId,
    },
    body: JSON.stringify({ id: fixedMessageId, role: "user", content: "cross user overwrite" }),
  });
  assert(otherMessage.status === 404, "other user could access conversation message route");

  const otherConversation = await request("/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "Other user conversation" }),
    headers: { "X-User-ID": otherUserId },
  });
  const uploadToOtherConversation = await fetchWithTimeout(`${baseUrl}/uploads`, {
    method: "POST",
    headers: {
      "X-User-ID": userId,
      "X-Conversation-ID": otherConversation.id,
      "Content-Type": "text/plain",
      "X-File-Name": "forbidden.txt",
    },
    body: "forbidden",
  });
  assert(uploadToOtherConversation.status === 404, "upload accepted another user's conversation");

  const artifactToOtherConversation = await fetchWithTimeout(`${baseUrl}/artifacts`, {
    method: "POST",
    headers: {
      "X-User-ID": userId,
      "X-Conversation-ID": otherConversation.id,
      "Content-Type": "text/plain",
      "X-Artifact-Name": "forbidden.txt",
    },
    body: "forbidden",
  });
  assert(artifactToOtherConversation.status === 404, "artifact accepted another user's conversation");
}

async function request(path, init = {}, expectedStatus = 200) {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": userId,
      ...(init.headers ?? {}),
    },
  }, 15_000);
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status}, expected ${expectedStatus}
response: ${text}
worker output:
${devOutput}`);
  }
  return text ? JSON.parse(text) : null;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopDev(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000),
  ]);
}

async function removeTempState(path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.warn(`WARN could not remove temp state ${path}: ${error.message}`);
        return;
      }
      await delay(500);
    }
  }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
