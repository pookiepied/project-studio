/**
 * Behaviour 1 of the harness entry: the admission bootstrap.
 *
 * This is a side-effect module on purpose, and `src/server.ts` must import
 * it FIRST. The composition root reads `PROJECT_STUDIO_ADMISSION_CREDENTIAL`
 * from the environment while the app module evaluates - and in the built
 * artifact the app module evaluates during the static import phase, before
 * the entry's own body runs. Reading the frame here, at this module's own
 * evaluation, is what guarantees the credential is in place before the
 * composition ever sees the process.
 *
 * The frame is one JSON object - `credential`, `clientId`, `sessionId` -
 * read to end-of-file from the descriptor the Host names over
 * `PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD` (fd 4 on Unix via `command-fds`,
 * fd 0 on Windows). The credential NEVER lands in an environment variable or
 * on argv; it is published as the three `PROJECT_STUDIO_ADMISSION_*`
 * variables the composition reads, which the Host's environment allowlist
 * guarantees contain nothing shadowing them. A malformed frame throws before
 * anything starts: a harness that starts without admission is a harness
 * listening with no door.
 *
 * No descriptor named - a dev run, or a test harness that passes the
 * credential by environment - and this module is a no-op, exactly as the
 * entry always behaved.
 */
import { closeSync, readFileSync } from "node:fs";

import { AdmissionError } from "../admission/errors.js";

interface AdmissionBootstrap {
  readonly credential: string;
  readonly clientId: string;
  readonly sessionId: string;
}

function isAdmissionBootstrap(value: object): value is AdmissionBootstrap {
  return (
    "credential" in value &&
    typeof value["credential"] === "string" &&
    "clientId" in value &&
    typeof value["clientId"] === "string" &&
    "sessionId" in value &&
    typeof value["sessionId"] === "string"
  );
}

const raw = process.env.PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD;
if (raw !== undefined) {
  const bootstrapFd = Number.parseInt(raw, 10);
  if (!Number.isInteger(bootstrapFd) || bootstrapFd < 0) {
    throw new AdmissionError("bootstrap_invalid", {
      message:
        "PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD is set but is not a non-negative integer.",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(bootstrapFd, "utf8"));
  } catch (error) {
    // A frame that is not JSON is an invalid frame, not a crash with a
    // third-party stack: the refusal names the contract it broke.
    throw new AdmissionError("bootstrap_invalid", {
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }
  if (bootstrapFd > 2) closeSync(bootstrapFd);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !isAdmissionBootstrap(parsed)
  ) {
    throw new AdmissionError("bootstrap_invalid");
  }
  process.env.PROJECT_STUDIO_ADMISSION_CREDENTIAL = parsed["credential"];
  process.env.PROJECT_STUDIO_ADMISSION_CLIENT_ID = parsed["clientId"];
  process.env.PROJECT_STUDIO_ADMISSION_SESSION_ID = parsed["sessionId"];
}
