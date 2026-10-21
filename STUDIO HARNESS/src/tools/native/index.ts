import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import type { StudioDatabase } from "../../storage/database.js";
import { RetrievalService, type MergedRetrievalLink } from "../../gateway/retrieval/service.js";
import { RetrievalSettingsStore } from "../../gateway/retrieval/settings.js";
import { MergedRetrievalResolver } from "../../gateway/connections/capability-defaults.js";
import { ConnectionStore } from "../../gateway/connections/connection-store.js";
import { ModelCatalog } from "../../gateway/connections/model-catalog.js";
import type { CallGate } from "../gate.js";
import { FileAccessLog, registerFilesystemTools } from "../filesystem/index.js";
import type { BackgroundJobs } from "../../process/background.js";
import type { MediaJobs } from "../../gateway/media/jobs.js";
import { registerAskTools, type AskToolRegistration } from "../ask/index.js";
import { registerDiscoverTools, type DiscoverToolRegistration } from "../discover/index.js";
import { registerPlanTools, type PlanToolRegistration } from "../plan/index.js";
import { registerGitTools } from "../git/index.js";
import { registerSearchTools } from "../search/index.js";
import { registerShellTools } from "../shell/index.js";
import { registerWebTools } from "../web/index.js";
import { registerMediaTools, type MediaToolRegistration } from "../media/index.js";
import { registerDocumentTools } from "../documents/index.js";
import { registerLibraryTools } from "../library/index.js";
import type { LibraryStore } from "../../library/store.js";

export interface NativeToolRegistrationOptions {
  readonly database: StudioDatabase;
  readonly credentials: SecureCredentialStore;
  /**
   * Whether the calling conversation's model accepts image input, or undefined
   * when that is not known. Answered from the model catalog; read by `read`,
   * which returns pictures instead of refusing them only while the model can
   * see them. Undefined is never treated as false - a catalog that has not
   * described the model is not evidence that the model is blind.
   */
  readonly acceptsImages?: (conversationId: string) => boolean | undefined;
  /**
   * Where background commands are kept.
   *
   * Passed in for the same reason as the access log and the image budget: a
   * job outlives the turn that started it, and a registry built here would be
   * discarded with the run - taking with it the only handle on a process that
   * is still going. A composition that omits it offers no background mode and
   * says so when one is asked for.
   */
  readonly jobs?: BackgroundJobs;
  /**
   * Where generation jobs are kept, for the jobs tool that reads them.
   *
   * Passed beside `media` because the two read it at different depths: the
   * generation tools dispatch through the service, and the jobs tool reads
   * the registry - listing, progress, Stop - exactly as it reads the
   * commands' registry beside it. Carried separately rather than pulled
   * through the service, because a service built without a registry answers
   * by throwing, and the tool's question is "is there one", not "what did
   * you do without one".
   */
  readonly mediaJobs?: MediaJobs;
  /** The generation tools; absent in a harness built without media. */
  readonly media?: MediaToolRegistration;
  /**
   * The library, for the search and keep tools. Optional because a harness
   * built without one (a test composition) has nothing to search; the
   * environment block names the tool only when the store is composed.
   */
  readonly library?: LibraryStore;
  /**
   * The read history the filesystem family enforces read-before-modify with.
   *
   * Passed in rather than built here, because this function runs once per run
   * and the history belongs to the conversation: a log created here forgot
   * every read the moment the turn ended, so the second message had to re-read
   * what the first one already had. A composition that omits it gets a fresh
   * log, which is the old behaviour and is right for a test that takes one
   * turn.
   */
  readonly accessLog?: FileAccessLog;
  /**
   * The discovery mechanism, and the reason it is not optional.
   *
   * Everything else here can be absent because what it needs is genuinely
   * absent: no broker, no question tool; no store, no plan tool. Discovery
   * needs nothing this composition does not already have, and the inventory
   * in the system block names it - a prompt that says its tool names "can be
   * requested in full through the discover tool" has made a promise, and a
   * composition without the capability would break ADR 0024's rule from the
   * far side, where a named capability does not exist. So discover is not
   * optional, and the inventory's wording is allowed to lean on it.
   */
  readonly discover: DiscoverToolRegistration;
  /**
   * The ask family's channel and closing-turn state.
   *
   * Optional because it needs a broker to ask through: a composition that
   * omits it offers no question tool rather than one nobody can answer. The
   * closing state is per-run and dies with the run that created it.
   */
  readonly ask?: AskToolRegistration;
  /**
   * The plan family's merge-and-read.
   *
   * Optional because it needs the plan store to write into: a composition
   * that omits it offers no plan tool rather than one that writes nowhere.
   * Unlike `ask` this holds no waiting channel - a plan neither parks nor
   * expires - so the dependency is the merge itself.
   */
  readonly plan?: PlanToolRegistration;
}

/** Registers every shipped capability through the one application CallGate. */
export function registerNativeTools(
  gate: CallGate,
  options: NativeToolRegistrationOptions,
): void {
  registerFilesystemTools(
    gate,
    options.accessLog ?? new FileAccessLog(),
    // A ternary rather than a bare field: the option is optional-without-
    // undefined, and passing an explicit undefined would widen the type
    // instead of omitting it.
    {
      ...(options.acceptsImages === undefined ? {} : { acceptsImages: options.acceptsImages }),
    },
  );
  registerSearchTools(gate);
  registerGitTools(gate);
  registerShellTools(gate, {
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
    ...(options.mediaJobs === undefined ? {} : { mediaJobs: options.mediaJobs }),
  });
  registerDiscoverTools(gate, options.discover);
  if (options.ask !== undefined) {
    registerAskTools(gate, options.ask);
  }
  if (options.plan !== undefined) {
    registerPlanTools(gate, options.plan);
  }
  if (options.library !== undefined) {
    registerLibraryTools(gate, options.library);
  }
  if (options.media !== undefined) {
    registerMediaTools(gate, options.media);
    // The document tool reads through the same service, and exists exactly
    // when the generation tools do: a harness with no media has no provider
    // to read a page through.
    registerDocumentTools(gate, { media: options.media.media });
  }
  registerWebTools(
    gate,
    new RetrievalService({
      settings: new RetrievalSettingsStore(options.database),
      credentials: options.credentials,
      merged: mergedRetrievalLink(options.database, options.credentials),
    }),
  );
}

/**
 * Joins the web tools to the merged provider store, so a `webSearch` /
 * `webFetch` default set in settings decides which search or reader answers.
 */
function mergedRetrievalLink(
  database: StudioDatabase,
  credentials: SecureCredentialStore,
): MergedRetrievalLink | undefined {
  try {
    const connections = new ConnectionStore({
      db: database,
      credentials,
    });
    const merged = new MergedRetrievalResolver({
      connections,
      catalog: new ModelCatalog({ db: database, connections }),
      credentials,
    });
    return {
      selectionFor: (capability) => merged.selectionFor(capability),
      keyFor: (vendorId) => merged.keyFor(vendorId),
    };
  } catch {
    // Without the link the tools fall back to their own legacy settings,
    // which is the behaviour they have always had.
    return undefined;
  }
}
