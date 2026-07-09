import { useState, useRef, useCallback } from "react";
import { aiService } from "../services/ai/aiService";
import { errorService } from "../core/errors/errorService";

interface UseVoiceInputOptions {
  transcriptionModel: string;
  onTranscribed: (text: string) => Promise<void>;
  onError: (msg: string) => void;
  onLoadingChange: (loading: boolean) => void;
}

export function useVoiceInput({
  transcriptionModel,
  onTranscribed,
  onError,
  onLoadingChange,
}: UseVoiceInputOptions) {
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const sendVoiceMessage = useCallback(async () => {
    if (isRecordingVoice) {
      mediaRecorderRef.current?.stop();
      setIsRecordingVoice(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        onLoadingChange(true);
        try {
          const res = await aiService.transcribe(blob, transcriptionModel);
          if (res.success && res.data) {
            await onTranscribed(res.data);
          } else {
            onError(errorService.getUserMessage(res.error));
          }
        } finally {
          onLoadingChange(false);
          stream.getTracks().forEach((t) => t.stop());
          audioChunksRef.current = [];
        }
      };

      mr.start();
      setIsRecordingVoice(true);
    } catch {
      onError("Microphone access denied.");
    }
  }, [isRecordingVoice, transcriptionModel, onTranscribed, onError, onLoadingChange]);

  const sendTranscribedText = useCallback(
    async (text: string) => {
      if (text.trim()) await onTranscribed(text);
    },
    [onTranscribed]
  );

  return { isRecordingVoice, sendVoiceMessage, sendTranscribedText };
}
