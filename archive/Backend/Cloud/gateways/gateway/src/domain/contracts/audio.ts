export interface TranscriptionRequest {
  model: string;
  audio: ArrayBuffer;
  mediaType?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
  timestampGranularities?: Array<"word" | "segment">;
}

export interface TranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: unknown[];
}

export interface SpeechRequest {
  model: string;
  input: string;
  voice: string;
  responseFormat?: string;
  response_format?: string;
  instructions?: string;
  speed?: number;
  language?: string;
}

export interface SpeechResponse {
  audio: ArrayBuffer;
  mediaType: string;
}
