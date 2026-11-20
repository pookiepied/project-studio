import { ExtendError } from "../extend/errors.js";
import type { ManagementEndpoint } from "../customization/management.js";

/**
 * The harness's memory routes, reached over loopback from the bundled
 * studio-memory server.
 *
 * The same shape as the customization relay and for the same reason: the
 * database lives in the harness, so this process owns nothing and speaks the
 * conversation-scoped routes. The conversation id it sends is the one the
 * harness wrote into the call's `_meta`; the route resolves the project from
 * it, so nothing this process sends can widen what the call may see.
 */

export interface MemoryView {
  readonly id: string;
  readonly scope: "personal" | "project";
  readonly projectId: string | null;
  readonly kind: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly priority: number;
  readonly author: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ProjectView {
  readonly id: string;
  readonly name: string;
}

export interface MemoryListView {
  readonly items: readonly MemoryView[];
  readonly total: number;
  readonly project: ProjectView | null;
}

/** One entry of a batch: what happened to it, or why it was refused. */
export interface MemoryEntryView {
  readonly ok: boolean;
  readonly id?: string;
  readonly error?: string;
  readonly existed?: boolean;
  readonly item?: MemoryView;
  readonly similar?: readonly MemoryView[];
}

export interface MemoryBatchView {
  readonly results: readonly MemoryEntryView[];
  readonly project: ProjectView | null;
}

export interface ProfileView {
  readonly name: string;
  readonly preferredName: string;
  readonly about: string;
  readonly replyStyle: string;
}

const TIMEOUT_MS = 15_000;

function reasonOf(reason: unknown): string {
  if (!(reason instanceof Error)) return String(reason);
  const cause = reason.cause;
  return cause instanceof Error ? cause.message : reason.message;
}

export class MemoryRelay {
  readonly #endpoint: ManagementEndpoint;
  readonly #fetch: typeof fetch;

  constructor(endpoint: ManagementEndpoint, fetcher: typeof fetch = fetch) {
    this.#endpoint = endpoint;
    this.#fetch = (input, init) => fetcher(input, init);
  }

  search(
    conversationId: string,
    query: { readonly query?: string; readonly kind?: string; readonly scope?: string; readonly limit?: number },
  ): Promise<MemoryListView> {
    const search = new URLSearchParams();
    if (query.query !== undefined) search.set("query", query.query);
    if (query.kind !== undefined) search.set("kind", query.kind);
    if (query.scope !== undefined) search.set("scope", query.scope);
    if (query.limit !== undefined) search.set("limit", String(query.limit));
    const suffix = search.size === 0 ? "" : `?${search.toString()}`;
    return this.#json("GET", `${this.#base(conversationId)}/items${suffix}`, "searching memory");
  }

  save(conversationId: string, items: readonly Record<string, unknown>[]): Promise<MemoryBatchView> {
    return this.#json("POST", `${this.#base(conversationId)}/items`, "saving memories", { items });
  }

  update(conversationId: string, changes: readonly Record<string, unknown>[]): Promise<MemoryBatchView> {
    return this.#json("PATCH", `${this.#base(conversationId)}/items`, "updating memories", { changes });
  }

  forget(conversationId: string, ids: readonly string[]): Promise<MemoryBatchView> {
    return this.#json("POST", `${this.#base(conversationId)}/items/forget`, "forgetting memories", { ids });
  }

  profile(conversationId: string): Promise<{ readonly profile: ProfileView }> {
    return this.#json("GET", `${this.#base(conversationId)}/profile`, "reading the profile");
  }

  setProfile(conversationId: string, change: Record<string, unknown>): Promise<{ readonly profile: ProfileView }> {
    return this.#json("PUT", `${this.#base(conversationId)}/profile`, "updating the profile", change);
  }

  #base(conversationId: string): string {
    return `/api/memory/conversations/${encodeURIComponent(conversationId)}`;
  }

  #json<T>(method: string, path: string, step: string, payload?: unknown): Promise<T> {
    const withoutBody = payload === undefined;
    return this.#fetch(`${this.#endpoint.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#endpoint.credential}`,
        ...(withoutBody ? {} : { "content-type": "application/json" }),
      },
      ...(withoutBody ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then(async (response) => {
      if (!response.ok) {
        const detail = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
        const reason = typeof detail?.error === "string"
          ? detail.error
          : `the memory interface answered ${String(response.status)}`;
        throw new ExtendError("internal", { message: `${step}: ${reason}` });
      }
      const text = await response.text();
      return (text === "" ? {} : JSON.parse(text)) as T;
    }, (reason: unknown) => {
      throw new ExtendError("internal", {
        message: `${step}: the harness's memory interface could not be reached: ${reasonOf(reason)}`,
      });
    });
  }
}
