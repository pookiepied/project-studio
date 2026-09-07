import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import type { StudioDatabase } from "../../storage/database.js";
import { RetrievalService, type MergedRetrievalLink } from "../../retrieval/service.js";
import { RetrievalSettingsStore } from "../../retrieval/settings.js";
import { MergedRetrievalResolver } from "../../providers/capability-defaults.js";
import { ConnectionStore } from "../../providers/connection-store.js";
import { ModelCatalog } from "../../providers/model-catalog.js";
import type { CallGate } from "../gate.js";
import { FileAccessLog, registerFilesystemTools } from "../filesystem/index.js";
import type { ImageBudget } from "../filesystem/image-budget.js";
import type { BackgroundJobs } from "../../process/background.js";
import { registerAskTools, type AskToolRegistration } from "../ask/index.js";
import { registerPlanTools, type PlanToolRegistration } from "../plan/index.js";
import { registerGitTools } from "../git/index.js";
import { registerSearchTools } from "../search/index.js";
import { registerShellTools } from "../shell/index.js";
import { registerWebTools } from "../web/index.js";

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
   * What each conversation has already spent on images.
   *
   * Passed in for the same reason as the access log below: the totals are
   * per conversation and this function runs once per run, so a budget created
   * here would forget every picture the moment the turn ended - and the
   * limits it exists to enforce are precisely the ones that accumulate across
   * turns. A composition that omits it holds each image to its own size only.
   */
  readonly imageBudget?: ImageBudget;
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
      ...(options.imageBudget === undefined ? {} : { imageBudget: options.imageBudget }),
    },
  );
  registerSearchTools(gate);
  registerGitTools(gate);
  registerShellTools(gate, options.jobs === undefined ? {} : { jobs: options.jobs });
  if (options.ask !== undefined) {
    registerAskTools(gate, options.ask);
  }
  if (options.plan !== undefined) {
    registerPlanTools(gate, options.plan);
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
