export interface FetchProvider {
  readonly name: string;
  fetch(input: { url: string; max_chars?: number; offset?: number }): Promise<NormalizedFetchResponse>;
}

export interface NormalizedFetchResponse {
  readonly url: string;
  readonly final_url?: string;
  readonly title?: string;
  readonly content: string;
  readonly content_type?: string;
  readonly truncated: boolean;
  readonly offset: number;
  readonly has_more: boolean;
  readonly next_offset?: number;
  readonly provider: string;
  readonly fetched_at: string;
}
