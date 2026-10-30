import { createStudioUuid } from "../contracts/uuid.js";
import { isRecord } from "../serve/stdio.js";

/**
 * The in-component ask (P1-4): input Studio does not send until the person,
 * not the model, has said yes.
 *
 * The shape is the one Codex's computer host proved: the call is refused
 * with `{ approvalRequest: { app, displayName, riskLevel, allowPersistentApproval } }`
 * before anything is sent, and only an explicit accept lets it through. Here
 * the accept arrives as an approval id in `_meta`, which only the harness
 * writes and only after the permission kernel asked the person - a model can
 * neither see the channel nor fill it. A request that asks for longer than
 * the category allows is refused by the kernel rather than shortened.
 *
 * The book holds no grants. How long an answer lasts is the kernel's: a
 * person who said "this conversation" is not asked again because the kernel
 * finds their grant and allows without asking. What this keeps is the one
 * thing the kernel cannot see - that a refused call's id was answered, and
 * for which process - so the next call that reaches the same process may go.
 */

export type ApprovalCategory = "browser" | "password_manager" | "terminal" | "password_field" | "open_path" | "clipboard_read";

export type GrantLimit = "once" | "conversation" | "always";

interface CategoryPolicy {
  readonly riskLevel: "medium" | "high";
  /** The longest an answer may last; `always` is what Codex calls a persistent approval. */
  readonly maxDuration: GrantLimit;
  /** How the person reads it: "Allow Studio's input to reach <this>?" */
  readonly noun: string;
}

export const APPROVAL_POLICY: Readonly<Record<ApprovalCategory, CategoryPolicy>> = {
  browser: { riskLevel: "medium", maxDuration: "always", noun: "a web browser" },
  clipboard_read: { riskLevel: "medium", maxDuration: "always", noun: "the clipboard" },
  open_path: { riskLevel: "high", maxDuration: "conversation", noun: "a file or program opened by path" },
  terminal: { riskLevel: "high", maxDuration: "conversation", noun: "a terminal" },
  password_manager: { riskLevel: "high", maxDuration: "once", noun: "a password manager" },
  password_field: { riskLevel: "high", maxDuration: "once", noun: "a password field" },
};

/** What input would reach, as the driver or the arguments say. Process identity, never window text. */
export interface ApprovalTarget {
  readonly category: ApprovalCategory;
  /** The process name, or "" for a category known from the arguments alone. */
  readonly app: string;
  readonly pid: number;
  readonly processStarted: string;
}

/** The request a refused call carries, for the harness to put to the person. */
export interface ApprovalRequest {
  readonly id: string;
  readonly category: ApprovalCategory;
  readonly app: string;
  readonly displayName: string;
  readonly riskLevel: "medium" | "high";
  readonly allowPersistentApproval: boolean;
  readonly maxDuration: GrantLimit;
}

/** How long an asked request waits for its answer to come back. */
const REQUEST_TTL_MS = 10 * 60 * 1000;

/** How long an answered request lets the next matching call through. */
const HELD_TTL_MS = 2 * 60 * 1000;

/** The most requests and held approvals kept; the oldest go first. */
const MAX_ENTRIES = 32;

interface Entry {
  readonly actor: string;
  readonly target: ApprovalTarget;
  readonly at: number;
}

function same(a: ApprovalTarget, b: ApprovalTarget): boolean {
  return a.category === b.category && a.app === b.app && a.pid === b.pid && a.processStarted === b.processStarted;
}

function bounded<T>(map: Map<string, T>): void {
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value ?? "");
}

/** The target a driver's `sensitivity` answer names, or undefined when it names nothing Studio asks about. */
export function targetFrom(value: unknown): ApprovalTarget | undefined {
  if (!isRecord(value)) return undefined;
  const app = typeof value["app"] === "string" ? value["app"].slice(0, 64) : "";
  const pid = typeof value["pid"] === "number" ? value["pid"] : 0;
  const processStarted = typeof value["processStarted"] === "string" ? value["processStarted"] : "";
  // A password field outranks the app it is in: its answer may last least.
  if (value["password"] === true) return { category: "password_field", app, pid, processStarted };
  const category = value["category"];
  if (category === "browser" || category === "password_manager" || category === "terminal") return { category, app, pid, processStarted };
  return undefined;
}

/** The approval id the harness wrote into `_meta`, if any. */
export function approvalIdFrom(meta: unknown): string | undefined {
  if (!isRecord(meta)) return undefined;
  const id = meta["studio/approval"];
  return typeof id === "string" && id !== "" ? id : undefined;
}

export class ApprovalBook {
  readonly #asked = new Map<string, Entry>();
  readonly #held = new Map<string, Entry>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * An id the harness says the person accepted. Honoured only for the actor
   * it was asked for; an id from someone else's call, or an expired one,
   * holds nothing.
   */
  accept(id: string | undefined, actor: string): void {
    if (id === undefined) return;
    const asked = this.#asked.get(id);
    this.#asked.delete(id);
    if (asked === undefined || asked.actor !== actor || this.#now() - asked.at > REQUEST_TTL_MS) return;
    this.#held.set(id, { ...asked, at: this.#now() });
    bounded(this.#held);
  }

  /** Spends one held approval for this actor and this exact process, if there is one. */
  take(actor: string, target: ApprovalTarget): boolean {
    for (const [id, held] of this.#held) {
      if (this.#now() - held.at > HELD_TTL_MS) { this.#held.delete(id); continue; }
      if (held.actor === actor && same(held.target, target)) {
        this.#held.delete(id);
        return true;
      }
    }
    return false;
  }

  /** A new request for the person, remembered so its answer can be recognised. */
  ask(actor: string, target: ApprovalTarget): ApprovalRequest {
    const id = createStudioUuid();
    this.#asked.set(id, { actor, target, at: this.#now() });
    bounded(this.#asked);
    const policy = APPROVAL_POLICY[target.category];
    return {
      id,
      category: target.category,
      app: target.app,
      displayName: target.app === "" ? policy.noun : `${target.app} (${policy.noun})`,
      riskLevel: policy.riskLevel,
      allowPersistentApproval: policy.maxDuration === "always",
      maxDuration: policy.maxDuration,
    };
  }
}
