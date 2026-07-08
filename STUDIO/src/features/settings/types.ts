// Settings types — moved from src/types/index.ts per T5.5 (D-527 shim pattern).

import { RephraseTone } from "@/utils/prompts";

export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  // Audio settings
  selectedMicrophone?: string; // Device ID for specific microphone (undefined = use system default)
  autoRephrase: boolean;
  rephraseTone: RephraseTone;

  // VAD settings
  vadEnabled: boolean;
  vadSilenceThreshold: number; // 0-255

  // Model settings
  transcriptionModel: string;
  rephraseModel: string;
  defaultChatModel: string;
  ttsModel: string; // Text-to-speech model
  imageModel: string; // Image generation model (passed to image_generate tool)
  videoModel: string; // Video generation model (passed to video_generate tool)

  // Local LLM settings
  ollamaEnabled: boolean; // Whether to show Ollama models in UI
  ollamaBaseUrl: string; // Default: http://localhost:11434
  lmstudioEnabled: boolean; // Whether to enable LM Studio
  lmstudioBaseUrl: string; // Default: http://localhost:1234
  localProviderEnabled: boolean; // Overall local provider daemon flag
  localProviderPort: number; // Default: 11435

  // Local transcription settings
  fasterWhisperEnabled: boolean; // Whether to enable Faster Whisper

  // Keyboard shortcuts
  recordingShortcut: string[];
  voiceShortcut: string[]; // Empty array = disabled; triggers voice session from anywhere
  voiceVolume: number;     // 0–100, TTS audio volume during voice sessions

  // UI settings
  theme: ThemePreference;
  startOnBoot: boolean;
  minimizeToTray: boolean;
  showNotifications: boolean;
  notifyConversationDone: boolean;
  overlayOpacity: number; // 0–100, idle-state opacity for the Pulse island
  showFloatingIsland: boolean; // Master toggle for the Pulse overlay

  // API settings
  apiBaseUrl: string;

  // Agent mode
  autopilotMode: boolean;
}
