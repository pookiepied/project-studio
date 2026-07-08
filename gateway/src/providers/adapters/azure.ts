import { createAzure }        from "@ai-sdk/azure";
import type { LanguageModel } from "ai";
import { BaseAdapter }        from "./base";

export class AzureAdapter extends BaseAdapter {
  protected readonly providerName = "azure";
  private readonly p: ReturnType<typeof createAzure>;
  /** modelId → Azure deployment name */
  private readonly deploymentMap: Record<string, string>;

  constructor(
    resourceName: string,
    apiKey: string,
    apiVersion: string,
    deploymentMap: Record<string, string>,
  ) {
    super();
    this.deploymentMap = deploymentMap;
    this.p = createAzure({ resourceName, apiKey, apiVersion });
  }

  /**
   * Translates our model ID to the Azure deployment name.
   * Falls back to the raw ID so misconfigured deployments fail with a
   * clear Azure error rather than a cryptic internal one.
   */
  protected getModel(m: string): LanguageModel {
    const deployment = this.deploymentMap[m] ?? m;
    return this.p(deployment);
  }

  /** Exposed for use in the embeddings and TTS/Whisper routes. */
  get provider(): ReturnType<typeof createAzure> { return this.p; }

  resolveDeployment(modelId: string): string {
    return this.deploymentMap[modelId] ?? modelId;
  }
}
