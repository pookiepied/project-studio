// Transcription types — moved from src/types/index.ts per T5.5 (D-527 shim pattern).

export enum RecordingState {
  IDLE = "idle",
  RECORDING = "recording",
  PROCESSING = "processing",
  TRANSCRIBING = "transcribing",
  REPHRASING = "rephrasing",
  COMPLETE = "complete",
  ERROR = "error",
}
