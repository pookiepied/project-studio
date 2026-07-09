import { MicrophoneIcon as Microphone } from "@phosphor-icons/react";
import { useAudioRecorder } from "@/features/voice/hooks/useAudioRecorder";
import { useSettings } from "@/app/contexts/SettingsContext";
import { AudioWaveform } from "./AudioWaveform";
import { composerRoundIconButton, cx } from "@/features/chat/components/composerControlStyles";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function VoiceInput({ onTranscript, disabled = false }: VoiceInputProps) {
  const { settings } = useSettings();

  const recorder = useAudioRecorder({
    autoRephrase: false,
    transcriptionModel: settings.transcriptionModel,
    selectedMicrophone: settings.selectedMicrophone,
    silenceThreshold: settings.vadEnabled ? settings.vadSilenceThreshold : 255,
    onComplete: (original) => {
      if (original.trim()) onTranscript(original);
    },
  });

  const { startRecording, stopRecording, isRecording, isProcessing, analyserRef } = recorder;

  function handleClick() {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording(false);
    }
  }

  if (isProcessing) {
    return (
      <button
        type="button"
        disabled
        className={cx(composerRoundIconButton, "flex-shrink-0 text-gray-400 opacity-60 cursor-not-allowed")}
        title="Transcribing..."
      >
        <div className="h-[16px] w-[16px] border-2 border-current border-t-transparent rounded-full animate-spin" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cx(
        composerRoundIconButton,
        "flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
        isRecording
          ? "text-gray-500"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-surface-border",
      )}
      title={isRecording ? "Stop recording" : "Voice input"}
    >
      {isRecording ? (
        <span className="w-[16px] h-[16px] flex items-center justify-center">
          <AudioWaveform
            analyserRef={analyserRef}
            isRecording={isRecording}
            barCount={4}
            barWidthPx={2}
            gapPx={2}
            maxHeightPx={16}
            minHeightPx={3}
            colorClass="bg-gray-500"
          />
        </span>
      ) : (
        <Microphone size={14} weight="regular" />
      )}
    </button>
  );
}
