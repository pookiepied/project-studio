export interface SearchProvider {
  readonly name: string;
  search(input: { query: string; max_results?: number; [k: string]: unknown }): Promise<NormalizedSearchResponse>;
}

export interface NormalizedSearchResponse {
  readonly results: Array<{
    readonly title: string;
    readonly url: string;
    readonly content: string;
    readonly score?: number;
  }>;
  readonly provider: string;
  readonly requestId?: string;
}
