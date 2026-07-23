export interface EmbeddingsRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
  user?: string;
}

export interface EmbeddingsResponse {
  object: "list";
  model: string;
  data: Array<{
    object: "embedding";
    index: number;
    embedding: number[];
  }>;
  usage?: unknown;
}
