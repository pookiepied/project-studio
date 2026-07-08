import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LanguageModel }  from "ai";
import { BaseAdapter }         from "./base";

export interface BedrockAuth {
  /** Simpler auth: bearer token from AWS Identity Center / Bedrock data-plane. */
  bearerToken?: string;
  /** SigV4 auth: standard IAM credentials. */
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class BedrockAdapter extends BaseAdapter {
  protected readonly providerName = "bedrock";
  private readonly p: ReturnType<typeof createAmazonBedrock>;

  constructor(auth: BedrockAuth) {
    super();

    if (auth.bearerToken) {
      // Bearer token auth — inject Authorization header via custom fetch.
      // Bypasses SigV4; useful for Bedrock data-plane with AWS Identity Center.
      const token = auth.bearerToken;
      this.p = createAmazonBedrock({
        region: auth.region ?? "us-east-1",
        accessKeyId: "placeholder",
        secretAccessKey: "placeholder",
        fetch: (url, init) => {
          const headers = new Headers((init as RequestInit)?.headers);
          headers.set("Authorization", `Bearer ${token}`);
          return fetch(url, { ...(init as RequestInit), headers });
        },
      });
    } else {
      this.p = createAmazonBedrock({
        region:          auth.region          ?? "us-east-1",
        accessKeyId:     auth.accessKeyId     ?? "",
        secretAccessKey: auth.secretAccessKey ?? "",
      });
    }
  }

  protected getModel(m: string): LanguageModel { return this.p(m); }

  /** Exposed for use in the embeddings and rerank routes. */
  get provider(): ReturnType<typeof createAmazonBedrock> { return this.p; }
}
