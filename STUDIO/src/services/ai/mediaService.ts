/**
 * Audio transcription and text-to-speech.
 *
 * Routes to cloud providers (Groq Whisper, etc.) or local Faster Whisper
 * depending on the model prefix.
 */

import { invoke } from "@tauri-apps/api/core";
import { apiClient } from "../../utils/api";
import { APIResponse } from "../../types";
import * as fasterWhisperService from "@/features/transcription/services/fasterWhisper";
import { TranscribeResponse } from "./types";
import { isFasterWhisperModel, extractFasterWhisperModelName } from "./daemonService";

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export async function transcribe(
  audioFile: File | Blob,
  model = "groq:whisper-large-v3-turbo"
): Promise<APIResponse<string>> {
  if (isFasterWhisperModel(model)) {
    const modelName = extractFasterWhisperModelName(model);
    try {
      const tempPath = await saveAudioToTemp(audioFile);
      const result = await fasterWhisperService.transcribeWithFasterWhisper(
        tempPath,
        { modelName, task: "transcribe" }
      );
      return result.success && result.data
        ? { success: true, data: result.data.text }
        : { success: false, error: result.error };
    } catch (error) {
      return {
        success: false,
        error: `Faster Whisper transcription failed: ${error}`,
      };
    }
  }

  // Cloud transcription
  const file =
    audioFile instanceof File
      ? audioFile
      : new File([audioFile], "audio.webm", { type: "audio/webm" });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", model);
  formData.append("language", "en");
  formData.append("temperature", "0");

  const response = await apiClient.postFormData<TranscribeResponse>(
    "/audio/transcriptions",
    formData
  );

  if (!response.success || !response.data) {
    return { success: false, error: response.error };
  }
  return { success: true, data: response.data.text };
}

// ---------------------------------------------------------------------------
// Text-to-Speech
// ---------------------------------------------------------------------------

export async function tts(
  text: string,
  voice = "alloy",
  model = "openai:tts-1"
): Promise<APIResponse<ArrayBuffer>> {
  const response = await apiClient.post<ArrayBuffer>(
    "/audio/speech",
    { model, input: text, voice }
  );
  if (!response.success || !response.data) {
    return { success: false, error: response.error };
  }
  return { success: true, data: response.data };
}

// ---------------------------------------------------------------------------
// Temp file helper (Tauri)
// ---------------------------------------------------------------------------

export async function saveAudioToTemp(
  audioFile: File | Blob
): Promise<string> {
  const arrayBuffer = await audioFile.arrayBuffer();
  return invoke<string>("save_audio_to_temp", {
    audioData: Array.from(new Uint8Array(arrayBuffer)),
    extension: "webm",
  });
}
