export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  responseFormat?: "url" | "b64_json";
  response_format?: "url" | "b64_json";
  quality?: string;
  background?: string;
  outputFormat?: string;
  output_format?: string;
  outputCompression?: number;
  output_compression?: number;
  user?: string;
}

export interface ImageEditRequest extends ImageGenerationRequest {
  images: ArrayBuffer[];
  mask?: ArrayBuffer;
  inputFidelity?: "low" | "high";
  input_fidelity?: "low" | "high";
}

export interface MediaResponse {
  bytes?: ArrayBuffer;
  base64?: string;
  url?: string;
  mediaType?: string;
  items?: MediaResponse[];
  usage?: unknown;
}

export interface VideoGenerationRequest {
  model: string;
  prompt?: string;
  image?: string;
  n?: number;
  aspectRatio?: string;
  aspect_ratio?: string;
  resolution?: string;
  duration?: number;
  fps?: number;
  seed?: number;
  generateAudio?: boolean;
  generate_audio?: boolean;
}

export interface VideoGenerationResponse {
  jobId?: string;
  media?: MediaResponse;
}
