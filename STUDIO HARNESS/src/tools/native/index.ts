import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import type { StudioDatabase } from "../../storage/database.js";
import { RetrievalService } from "../../retrieval/service.js";
import { RetrievalSettingsStore } from "../../retrieval/settings.js";
import type { CallGate } from "../gate.js";
import { registerFilesystemTools } from "../filesystem/index.js";
import { registerGitTools } from "../git/index.js";
import { registerSearchTools } from "../search/index.js";
import { registerShellTools } from "../shell/index.js";
import { registerWebTools } from "../web/index.js";
import { registerWorkspaceSummaryTool } from "../workspace-summary.js";

export interface NativeToolRegistrationOptions {
  readonly database: StudioDatabase;
  readonly credentials: SecureCredentialStore;
}

/** Registers every shipped capability through the one application CallGate. */
export function registerNativeTools(
  gate: CallGate,
  options: NativeToolRegistrationOptions,
): void {
  registerFilesystemTools(gate);
  registerSearchTools(gate);
  registerGitTools(gate);
  registerShellTools(gate);
  registerWebTools(
    gate,
    new RetrievalService({
      settings: new RetrievalSettingsStore(options.database),
      credentials: options.credentials,
    }),
  );
  registerWorkspaceSummaryTool(gate);
}
