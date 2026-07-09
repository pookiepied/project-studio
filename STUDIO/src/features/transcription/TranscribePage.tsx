import { useEffect, useState } from "react";
import { MicrophoneIcon as Microphone } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { AudioWaveform } from "@/features/voice/components/AudioWaveform";
import { Send, Copy, Success, Refresh, Icon } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { Spinner } from "@/ui/primitives/Spinner";
import { RecordingState } from "@/types";
import { useRecording } from "@/features/voice/context/RecordingContext";
import { useChat } from "@/features/chat/context";
import { useNavigation } from "@/contexts/NavigationContext";
import { useSettings } from "@/contexts/SettingsContext";
import { NotificationService } from "@/core/notifications";
import { TrayService } from "@/core/platform/trayService";
import { formatShortcutKeys } from "@/utils/shortcutFormatter";
import { logger } from "@/core/logging/logger";

/** Split text into natural lines for sequential reveal. */
function toLines(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .flatMap(s => s.split("\n"))
    .map(s => s.trim())
    .filter(Boolean);
}

export const TranscribePage = () => {
  const [copied, setCopied] = useState(false);
  const [sentToChat, setSentToChat] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const { settings } = useSettings();

  const {
    recordingState,
    partialTranscript,
    finalTranscript,
    rephrasedText,
    startRecording,
    stopRecording,
    reset,
    isRecording,
    isProcessing,
    analyserRef,
  } = useRecording();

  const { sendTranscribedText } = useChat();
  const { navigateTo } = useNavigation();

  useEffect(() => {
    const initPermission = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        logger.error("TranscribePage", "Failed to get microphone permission on load", error);
      }
    };
    initPermission();
    NotificationService.requestPermission();
  }, []);

  useEffect(() => {
    const hasText = !!(rephrasedText || finalTranscript);
    TrayService.updateMenu(isRecording, hasText);
  }, [isRecording, rephrasedText, finalTranscript]);

  useEffect(() => {
    const cleanup = TrayService.setupListeners({
      onStartRecording: async () => {
        if (!isRecording && !isProcessing) { reset(); await startRecording(false); }
      },
      onStopRecording: async () => { if (isRecording) await stopRecording(); },
      onCopyText: () => { const t = rephrasedText || finalTranscript; if (t) handleCopy(t); },
      onNewTranscription: () => reset(),
    });
    return cleanup;
  }, [isRecording, isProcessing, rephrasedText, finalTranscript, reset, startRecording, stopRecording]);

  const handleButtonClick = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      logger.error("TranscribePage", "Permission denied when starting recording");
      return;
    }

    if (isRecording) {
      await stopRecording();
    } else {
      reset();
      await startRecording(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.error("TranscribePage", "Failed to copy", error);
    }
  };

  const handleSendToChat = async () => {
    const text = rephrasedText || finalTranscript;
    if (!text) return;
    try {
      await sendTranscribedText(text);
      setSentToChat(true);
      setTimeout(() => { navigateTo("chat"); setSentToChat(false); }, 500);
    } catch (error) {
      logger.error("TranscribePage", "Failed to send to chat", error);
    }
  };

  const getStatusText = () => {
    switch (recordingState) {
      case RecordingState.RECORDING:    return "Listening";
      case RecordingState.PROCESSING:   return "Processing";
      case RecordingState.TRANSCRIBING: return "Transcribing";
      case RecordingState.REPHRASING:   return "Rephrasing";
      case RecordingState.COMPLETE:     return null;
      case RecordingState.ERROR:        return "Error";
      default:                          return null;
    }
  };

  const displayText = rephrasedText || finalTranscript;
  const statusText = getStatusText();
  const shortcutKeys = formatShortcutKeys(settings.recordingShortcut);

  return (
    <>
      <div className="h-full flex flex-col bg-surface-page transition-colors duration-normal overflow-hidden">

        <div className="flex-shrink-0 px-6 pt-6 pb-1">
          <h1 className="text-2xs font-medium tracking-[0.2em] text-muted uppercase">
            Transcribe
          </h1>
        </div>

        {/* Content area — takes all available space, never overlaps bottom controls */}
        <div className="flex-1 min-h-0 relative">
          <AnimatePresence mode="wait">
            {displayText ? (
              <motion.div
                key="result"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 overflow-y-auto scrollbar-auto-hide px-6 pt-5 pb-2"
              >
                {/* Main text — each sentence slides in sequentially from top */}
                <div className="space-y-2">
                  {toLines(displayText).map((line, i) => (
                    <motion.p
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.22, delay: i * 0.06, ease: [0.4, 0, 0.2, 1] }}
                      className="text-base text-primary leading-relaxed"
                    >
                      {line}
                    </motion.p>
                  ))}
                </div>

                {/* Original — hidden by default, toggled via button */}
                {rephrasedText && finalTranscript && (
                  <AnimatePresence>
                    {showOriginal && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                        className="mt-6 pt-5 border-t border-surface-divider overflow-hidden"
                      >
                        <p className="text-3xs font-medium tracking-[0.15em] text-muted uppercase mb-3">
                          Original
                        </p>
                        <div className="space-y-2">
                          {toLines(finalTranscript).map((line, i) => (
                            <motion.p
                              key={i}
                              initial={{ opacity: 0, x: -4 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.18, delay: i * 0.04 }}
                              className="text-sm text-secondary leading-relaxed"
                            >
                              {line}
                            </motion.p>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </motion.div>
            ) : isRecording ? (
              <motion.div
                key="recording"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 overflow-y-auto scrollbar-auto-hide px-6 pt-5 pb-2"
              >
                {partialTranscript ? (
                  <div className="space-y-2">
                    {toLines(partialTranscript).map((line) => (
                      <motion.p
                        key={line}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-base text-muted leading-relaxed italic"
                      >
                        {line}
                      </motion.p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted italic">Listening...</p>
                )}
              </motion.div>
            ) : isProcessing ? (
              <motion.div
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <Spinner size="sm" decorative />
                  {statusText}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <p className="text-sm text-muted">
                  Tap the microphone to start
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-shrink-0 px-6 pb-8">
          <AnimatePresence>
            {displayText && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex items-center justify-center gap-1 mb-5"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={sentToChat ? <Success size="xs" /> : <Send size="xs" />}
                  onClick={handleSendToChat}
                >
                  {sentToChat ? "Sent" : "Send"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={copied ? <Success size="xs" /> : <Copy size="xs" />}
                  onClick={() => handleCopy(displayText)}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
                {rephrasedText && finalTranscript && (
                  <Button
                    variant={showOriginal ? "outline" : "ghost"}
                    size="sm"
                    onClick={() => setShowOriginal(v => !v)}
                  >
                    Original
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Refresh size="xs" />}
                  onClick={() => { reset(); setShowOriginal(false); }}
                >
                  New
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col items-center gap-3">
            <motion.button
              onClick={handleButtonClick}
              disabled={isProcessing}
              whileTap={!isProcessing ? { scale: 0.95 } : {}}
              className={`
                w-12 h-12 flex items-center justify-center rounded-full
                transition-colors duration-normal
                ${isRecording
                  ? "bg-surface-raised border border-surface-border"
                  : isProcessing
                  ? "bg-surface-raised cursor-not-allowed"
                  : "bg-surface-base border border-surface-border shadow-sm hover:shadow-md"
                }
              `}
            >
              {isProcessing ? (
                <Spinner size="md" className="text-muted" />
              ) : isRecording ? (
                <AudioWaveform
                  analyserRef={analyserRef}
                  isRecording={isRecording}
                  barCount={5}
                  barWidthPx={2}
                  gapPx={2}
                  maxHeightPx={16}
                  minHeightPx={2}
                  colorClass="bg-secondary"
                />
              ) : (
                <Icon icon={Microphone} size="md" className="text-secondary" />
              )}
            </motion.button>

            <p className="text-2xs text-muted min-h-[14px]">
              {isRecording ? "Tap to stop" : displayText ? "Record again" : shortcutKeys.length > 0 ? `${shortcutKeys.join(" + ")} to record` : ""}
            </p>
          </div>
        </div>
      </div>
    </>
  );
};
