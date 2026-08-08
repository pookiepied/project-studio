import { Microphone } from "@/ui/icons";
import { useAudioRecorder } from "@/features/voice/hooks/useAudioRecorder";
import { useSettings } from "@/app/contexts/SettingsContext";
import { AudioWaveform } from "./AudioWaveform";
import { composerRoundIconButton, cx } from "@/features/chat/components/composerControlStyles";
import { IconButton } from "@/ui/primitives/IconButton";

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
      <IconButton
        size="sm"
        disabled
        aria-label="Transcribing..."
        title="Transcribing..."
        className={cx(composerRoundIconButton, "flex-shrink-0 text-disabled opacity-60 cursor-not-allowed")}
      >
        <div className="h-[16px] w-[16px] border-2 border-current border-t-transparent rounded-full animate-spin" />
      </IconButton>
    );
  }

  return (
    <IconButton
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      aria-label={isRecording ? "Stop recording" : "Voice input"}
      title={isRecording ? "Stop recording" : "Voice input"}
      className={cx(
        composerRoundIconButton,
        "flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
        isRecording
          ? "text-muted"
          : "text-disabled hover:bg-surface-base hover:text-secondary dark:hover:bg-surface-border",
      )}
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
            colorClass="bg-secondary"
          />
        </span>
      ) : (
        <Microphone size="sm" />
      )}
    </IconButton>
  );
}
