import { logger } from "@/core/logging/logger";

interface CleanupAudioRecorderResourcesOptions {
  mediaRecorderRef: React.MutableRefObject<MediaRecorder | null>;
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  checkIntervalRef: React.MutableRefObject<number | null>;
  chunkIntervalRef: React.MutableRefObject<number | null>;
}

export function cleanupAudioRecorderResources({
  mediaRecorderRef,
  audioContextRef,
  analyserRef,
  checkIntervalRef,
  chunkIntervalRef,
}: CleanupAudioRecorderResourcesOptions) {
  logger.debug("AudioRecorder", "Starting cleanup");

  if (checkIntervalRef.current) {
    clearInterval(checkIntervalRef.current);
    checkIntervalRef.current = null;
  }
  if (chunkIntervalRef.current) {
    clearInterval(chunkIntervalRef.current);
    chunkIntervalRef.current = null;
  }

  const mediaRecorder = mediaRecorderRef.current;
  if (mediaRecorder) {
    if ((mediaRecorder as any).checkInterval) {
      clearInterval((mediaRecorder as any).checkInterval);
      delete (mediaRecorder as any).checkInterval;
    }
    if ((mediaRecorder as any).chunkInterval) {
      clearInterval((mediaRecorder as any).chunkInterval);
      delete (mediaRecorder as any).chunkInterval;
    }

    if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
      try {
        mediaRecorder.stop();
      } catch (error) {
        logger.warn("AudioRecorder", "Error stopping MediaRecorder:", error);
      }
    }

    if (mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach((track) => {
        track.stop();
        logger.debug("AudioRecorder", `Stopped track: ${track.kind}`);
      });
    }

    mediaRecorder.ondataavailable = null;
    mediaRecorder.onerror = null;
    mediaRecorder.onstop = null;
    mediaRecorder.onstart = null;

    mediaRecorderRef.current = null;
  }

  const audioContext = audioContextRef.current;
  if (audioContext && audioContext.state !== "closed") {
    try {
      audioContext.close();
      logger.debug("AudioRecorder", "Closed AudioContext");
    } catch (error) {
      logger.warn("AudioRecorder", "Error closing AudioContext:", error);
    }
    audioContextRef.current = null;
  }

  analyserRef.current = null;
  logger.debug("AudioRecorder", "Cleanup complete");
}
