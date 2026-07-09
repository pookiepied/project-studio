import { createContext, useContext, ReactNode, type RefObject } from "react";
import { useAudioRecorder } from "@/features/voice/hooks/useAudioRecorder";
import { useSettings } from "@/contexts/SettingsContext";
import { NotificationService } from "@/core/notifications";
import { RecordingState } from "@/types";

interface RecordingContextType {
  recordingState: RecordingState;
  partialTranscript: string;
  finalTranscript: string;
  rephrasedText: string;
  startRecording: (showNotification?: boolean) => Promise<void>;
  stopRecording: () => Promise<void>;
  reset: () => void;
  isRecording: boolean;
  isProcessing: boolean;
  analyserRef: RefObject<AnalyserNode | null>;
}

const RecordingContext = createContext<RecordingContextType | null>(null);

interface RecordingProviderProps {
  children: ReactNode;
  onComplete?: (original: string, rephrased?: string) => void;
  onError?: (error: string) => void;
}

export const RecordingProvider = ({
  children,
  onComplete,
  onError,
}: RecordingProviderProps) => {
  const { settings } = useSettings();

  const recorder = useAudioRecorder({
    autoRephrase: settings.autoRephrase,
    rephraseTone: settings.rephraseTone,
    transcriptionModel: settings.transcriptionModel,
    rephraseModel: settings.rephraseModel,
    selectedMicrophone: settings.selectedMicrophone, // Pass microphone selection
    silenceThreshold: settings.vadEnabled ? settings.vadSilenceThreshold : 255,
    onComplete: async (original, rephrased) => {
      // Show notification using the original NotificationService (handles both Tauri and web)
      if (settings.showNotifications) {
        await NotificationService.showNative(
          "STUDIO",
          rephrased ? "Transcription and rephrasing complete" : "Transcription complete"
        );
      }
      
      // Call parent callback
      onComplete?.(original, rephrased);
    },
    onError: (error) => {
      onError?.(error);
    },
  });

  return (
    <RecordingContext.Provider value={recorder}>
      {children}
    </RecordingContext.Provider>
  );
};

export const useRecording = (): RecordingContextType => {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error("useRecording must be used within RecordingProvider");
  }
  return context;
};
