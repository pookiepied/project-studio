import type { Context, Next } from "hono";
import * as v from "valibot";

import {
  submissionTurnSettingsSchema,
  type SubmissionTurnSettings,
} from "../../../contracts/agents.js";
import type { ReasoningChoice } from "../../../contracts/models.js";
import type { ConversationStore } from "../../../conversations/store.js";

/**
 * Reads the turn settings out of a submission and settles them before the run.
 *
 * ---- Why this exists -------------------------------------------------------
 *
 * The model and reasoning level a person picked have to reach the run that
 * answers. Flue's submission payload is `message` and images, nothing else -
 * `DirectAgentPayloadSchema` strips unknown keys - and the agent initializer
 * receives only `{ id, env }`, so nothing a caller adds to the body can cross
 * into the run's config. The choice therefore has to be durable BEFORE the run
 * starts, and the durable place is the conversation index: the run's
 * initializer reads the row and names its model from it.
 *
 * That read is the race this middleware closes. The webview posts the
 * submission, and only after the receipt posts the index row for a first
 * conversation - so a first turn's run could start before its row existed and
 * take the default model. Here, on the way in, the body's `modelId` and
 * `reasoningLevel` are parsed, validated, and written to the index before
 * `next()` admits the run. The initializer can no longer observe the gap:
 * whatever it reads, the row already holds what this turn was sent with.
 *
 * ---- What is validated, and what happens to the fields ---------------------
 *
 * The two fields are parsed through `submissionTurnSettingsSchema`; anything
 * else in the body is ignored, and Flue strips the two from the payload it
 * stores. A body whose settings do not parse is refused before admission - a
 * run launched on a value the contract cannot describe is worse than a
 * refused send. A `modelId` that names no model the harness currently serves
 * is refused the same way: the picker only offers such models, so a mismatch
 * means a connection or model vanished between picking and sending, and a
 * clear 400 beats a run that dies resolving its model.
 *
 * ---- The refusal rule ------------------------------------------------------
 *
 * A first send the harness refuses must create nothing (Task 33). When the
 * row did not exist and this middleware created it, a refusal from downstream
 * removes exactly that row again - the one destructive act available that
 * leaves the invariant intact, and the reason the creation is remembered for
 * the length of one request. A crash between the two leaves a row without a
 * stream, which the conversation routes already name as a tolerated state.
 *
 * ---- Reading the body without disturbing it --------------------------------
 *
 * The body is read through a CLONE (`raw.clone().text()`), never through
 * `req.json()` and never through the raw body itself. Hono's own body readers
 * consume the raw stream, and Flue's agent route clones the same raw request
 * afterwards to parse the payload; a body that has been read even once refuses
 * every further clone with "Body is unusable", and the submission dies with a
 * 500 before admission. A clone leaves the original untouched and may be taken
 * again, so both readers get their own view of the same bytes.
 */
export interface TurnSettingsMiddlewareOptions {
  /** The conversation index: read for existence, written for the settings. */
  readonly conversations: ConversationStore;
  /**
   * Answers whether a model reference is currently served. Wired to the
   * provider catalog at composition, so the check follows the same list the
   * picker was filled from.
   */
  readonly isModelServed: (modelId: string) => Promise<boolean>;
}

const AGENT_SUBMISSION_PATH = /^\/agents\/studio\/([^/]+)$/;

export function createTurnSettingsMiddleware(
  options: TurnSettingsMiddlewareOptions,
): (context: Context, next: Next) => Promise<Response | void> {
  return async (context, next) => {
    if (context.req.method !== "POST") return next();
    const match = AGENT_SUBMISSION_PATH.exec(context.req.path);
    if (match === null) return next();
    const conversationId = match[1];
    if (conversationId === undefined || conversationId === "") return next();

    let body: unknown;
    try {
      // A clone, never the raw body: see the docblock's last section.
      const text = await context.req.raw.clone().text();
      body = text.trim() === "" ? undefined : JSON.parse(text);
    } catch {
      // Not JSON at all is downstream's refusal to produce; settle nothing.
      return next();
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return next();
    }

    const parsed = v.safeParse(submissionTurnSettingsSchema, body);
    if (!parsed.success) {
      return refusal(context, "The turn settings on this submission do not match the contract.");
    }
    const settings = readSettings(parsed.output);
    if (settings.modelId !== undefined && settings.modelId !== null) {
      const served = await options.isModelServed(settings.modelId);
      if (!served) {
        return refusal(
          context,
          `No connected provider currently serves the model "${settings.modelId}". Check the picker or your connections.`,
        );
      }
    }

    const existing = options.conversations.get(conversationId);
    if (existing === undefined) {
      // A first turn: the row is created here, at admission, carrying the
      // settings - the message is in hand, so the title derives from it the
      // same way the receipt path would have.
      const message = readMessage(body);
      if (message === undefined) return next();
      options.conversations.record({
        id: conversationId,
        firstMessage: message,
        ...(settings.modelId === undefined ? {} : { modelId: settings.modelId }),
        ...(settings.reasoningLevel === undefined
          ? {}
          : { reasoningLevel: settings.reasoningLevel }),
        createdAt: Date.now(),
      });
      await next();
      if (context.res.status >= 400) {
        // The send was refused: the row this request created leaves with it.
        options.conversations.removeMany([conversationId]);
      }
      return;
    }

    if (settings.modelId !== undefined || settings.reasoningLevel !== undefined) {
      options.conversations.patch(conversationId, {
        ...(settings.modelId === undefined ? {} : { modelId: settings.modelId }),
        ...(settings.reasoningLevel === undefined
          ? {}
          : { reasoningLevel: settings.reasoningLevel }),
      });
    }
    await next();
  };
}

/** A settings refusal: nothing created, nothing admitted, the reason on the body. */
function refusal(context: Context, message: string): Response {
  return context.json({ error: message, code: "conversations.invalid" }, 400);
}

/**
 * Normalizes the parsed settings into the patch shape: absent stays absent,
 * and null (clear to the default) passes through as a value.
 */
function readSettings(output: SubmissionTurnSettings): {
  modelId?: string | null;
  reasoningLevel?: ReasoningChoice | null;
} {
  const modelId = output.modelId;
  const reasoningLevel = output.reasoningLevel;
  return {
    ...(modelId === undefined ? {} : { modelId }),
    ...(reasoningLevel === undefined ? {} : { reasoningLevel }),
  };
}

/** The message a direct submission carries, when it is a non-empty string. */
function readMessage(body: object): string | undefined {
  const candidate = (body as Record<string, unknown>)["message"];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}
