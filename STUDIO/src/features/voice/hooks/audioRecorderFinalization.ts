import { RecordingState } from "@/types";
import { reportError } from "@/core/errors/errorReporting";
import { errorService } from "@/core/errors/errorService";
import { logger } from "@/core/logging/logger";
import { aiService } from "@/features/chat/services/aiService";
import { processTranscriptionChunks, type TranscriptionChunk } from "@/lib/textMerger";

interface FinalizeAudioRecorderTranscriptionOptions {
  chunks: TranscriptionChunk[];
  autoRephrase: boolean;
  rephraseTone: string;
  rephraseModel: string;
  setRecordingState: (state: RecordingState) => void;
  setFinalTranscript: (text: string) => void;
  setRephrasedText: (text: string) => void;
  onComplete?: (finalText: string, rephrasedText?: string) => void;
  onError?: (error: string) => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    logger.debug("AudioRecorder", "Copied to clipboard");
    return true;
  } catch (error) {
    const userMessage = errorService.getUserMessage(error);
    logger.error("AudioRecorder", "Failed to copy:", userMessage);
    return false;
  }
}

export async function finalizeAudioRecorderTranscription({
  chunks,
  autoRephrase,
  rephraseTone,
  rephraseModel,
  setRecordingState,
  setFinalTranscript,
  setRephrasedText,
  onComplete,
  onError,
}: FinalizeAudioRecorderTranscriptionOptions) {
  try {
    logger.debug("AudioRecorder", `Starting finalization with ${chunks.length} chunks`);

    const finalText = processTranscriptionChunks(chunks.map((chunk) => chunk.text));

    logger.debug("AudioRecorder", `Final text: "${finalText}"`);
    setFinalTranscript(finalText);

    if (!finalText) {
      logger.debug("AudioRecorder", "No text to process, completing");
      setRecordingState(RecordingState.COMPLETE);
      onComplete?.(finalText);
      return;
    }

    if (!autoRephrase) {
      logger.debug("AudioRecorder", "Auto-rephrase disabled, copying original");
      await copyToClipboard(finalText);
      setRecordingState(RecordingState.COMPLETE);
      onComplete?.(finalText);
      return;
    }

    logger.debug("AudioRecorder", `Starting rephrase with tone: ${rephraseTone}, text length: ${finalText.length}`);
    logger.debug("AudioRecorder", `Text to rephrase: "${finalText.substring(0, 100)}..."`);
    setRecordingState(RecordingState.REPHRASING);

    try {
      const rephraseResult = await aiService.rephrase(
        finalText,
        rephraseTone,
        rephraseModel,
      );

      logger.debug("AudioRecorder", "Rephrase result:", rephraseResult);

      if (rephraseResult.success && rephraseResult.data) {
        logger.debug("AudioRecorder", `Rephrase success: "${rephraseResult.data}"`);
        setRephrasedText(rephraseResult.data);
        await copyToClipboard(rephraseResult.data);
        setRecordingState(RecordingState.COMPLETE);
        onComplete?.(finalText, rephraseResult.data);
        return;
      }

      logger.error("AudioRecorder", "Rephrase failed:", rephraseResult.error);
      reportError(new Error(`Rephrase failed: ${rephraseResult.error}`), {
        action: "rephrase",
        textLength: finalText.length,
        tone: rephraseTone,
        model: rephraseModel,
      });
      await copyToClipboard(finalText);
      setRecordingState(RecordingState.COMPLETE);
      onComplete?.(finalText);
    } catch (error) {
      logger.error("AudioRecorder", "Rephrase exception:", error);

      reportError(
        error instanceof Error ? error : new Error("Rephrase exception"),
        {
          action: "rephrase",
          textLength: finalText.length,
          tone: rephraseTone,
          model: rephraseModel,
        },
      );

      await copyToClipboard(finalText);
      setRecordingState(RecordingState.COMPLETE);
      onComplete?.(finalText);
    }
  } catch (error) {
    const userMessage = errorService.getUserMessage(error);
    logger.error("AudioRecorder", "Error:", error);

    reportError(
      error instanceof Error ? error : new Error(userMessage),
      { action: "finalizeTranscription", chunkCount: chunks.length },
    );

    setRecordingState(RecordingState.ERROR);
    onError?.(userMessage);
  }
}
