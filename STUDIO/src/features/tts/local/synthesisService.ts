/**
 * Edge TTS Synthesis Service
 * Runs the installed venv's speak.py once per call — same one-shot
 * subprocess-per-request pattern as Faster Whisper's transcriptionService.
 * Edge TTS has no documented rate limit for this kind of light, sequential
 * use, so callers are expected to synthesize chunk-by-chunk rather than
 * firing a large burst of concurrent requests (see textChunker.ts + the
 * queued playback in useTTS/useLiveSession).
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/core/logging/logger';
import { loadConfig, getVenvPythonPath, getScriptsDir } from './config';

function utf8ToBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Synthesize a single chunk of text into an mp3 Blob using the local
 * Edge TTS installation. Throws if Edge TTS isn't installed or synthesis
 * fails — callers should catch and fall back / surface an error.
 */
export async function synthesizeSpeech(
  text: string,
  voiceId: string,
  rate: string = '+0%'
): Promise<Blob> {
  const config = await loadConfig();
  if (!config.installed) {
    throw new Error('Edge TTS is not installed. Enable it in Settings > Local Services.');
  }

  const pythonPath = await getVenvPythonPath();
  const scriptsDir = await getScriptsDir();

  const result = await invoke<string>('execute_shell_command', {
    command: pythonPath,
    args: [`${scriptsDir}/speak.py`, utf8ToBase64(text), voiceId, rate],
  });

  let parsed: { success: boolean; audio_base64?: string; error?: string };
  try {
    parsed = JSON.parse(result);
  } catch {
    throw new Error('Edge TTS returned an unreadable response');
  }

  if (!parsed.success || !parsed.audio_base64) {
    logger.error('EdgeTtsSynthesis', 'Synthesis failed', { error: parsed.error });
    throw new Error(parsed.error || 'Speech synthesis failed');
  }

  return new Blob([base64ToBytes(parsed.audio_base64)], { type: 'audio/mpeg' });
}

/** model id format used across settings.ttsModel: "edge-tts:<voiceId>" */
const EDGE_TTS_PREFIX = 'edge-tts:';

export function isEdgeTtsModel(model: string | undefined | null): boolean {
  return !!model && model.startsWith(EDGE_TTS_PREFIX);
}

export function voiceIdFromModel(model: string): string {
  return model.slice(EDGE_TTS_PREFIX.length);
}

export function modelFromVoiceId(voiceId: string): string {
  return `${EDGE_TTS_PREFIX}${voiceId}`;
}
