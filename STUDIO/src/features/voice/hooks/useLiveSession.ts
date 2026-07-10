import { useState, useRef, useCallback, useEffect, type RefObject } from "react";
import { apiClient } from "@/lib/api";
import { aiService, APIChatMessage } from "@/features/chat/services/aiService";
import { logger } from "@/core/logging/logger";
import type { VoiceCaptionState } from "@/core/platform/voiceCaptionTypes";

export type SessionState =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

interface LiveSessionOptions {
  model?: string;
  ttsModel?: string;
  transcriptionModel?: string;
  /** TTS playback volume: 0–1. Default 0.8. */
  volume?: number;
}

interface LiveSessionReturn {
  sessionState: SessionState;
  transcript: string;
  aiText: string;
  voiceCaption: VoiceCaptionState | null;
  isMicMuted: boolean;
  isSpeakerMuted: boolean;
  sessionSeconds: number;
  error: string | null;
  startSession: () => Promise<void>;
  endSession: () => void;
  toggleMicMute: () => void;
  toggleSpeakerMute: () => void;
  analyserRef: RefObject<AnalyserNode | null>;
}

const SILENCE_THRESHOLD = 8;
const SPEECH_START_FRAMES = 5;  // frames above threshold before "speech started" (~600ms, filters coughs)
const SILENCE_END_MS = 1400;    // ms of silence after speech → send turn
const VAD_INTERVAL_MS = 120;

const VOICE_SYSTEM_PROMPT = `You are a warm, empathetic voice assistant. Your responses are spoken aloud.

Rules:
1. 1–3 natural sentences maximum. No filler or padding.
2. No markdown, lists, or code. Plain prose only.
3. Be kind, composed, and conversational. Speak like a close friend.
4. Deliver the core answer in the first sentence.
5. For complex tasks: say "I can't do that here, but switch to Chat and I'll jump right on it."
6. Skip affirmations like "Sure" or "Great." Get straight to the point.`;

function extractSentences(buffer: string): { sentences: string[]; remaining: string } {
  const sentences: string[] = [];
  let remaining = buffer;

  const sentenceRe = /[^.!?]+[.!?]+\s*/g;
  let match: RegExpExecArray | null;

  while ((match = sentenceRe.exec(buffer)) !== null) {
    const sentence = match[0].trim();
    if (sentence.length >= 12) {
      sentences.push(sentence);
      remaining = buffer.slice(match.index + match[0].length);
    }
  }

  return { sentences, remaining };
}

export function useLiveSession(options: LiveSessionOptions = {}): LiveSessionReturn {
  const {
    model = "auto",
    ttsModel = "google:en-US-Neural2-J",
    transcriptionModel = "groq:whisper-large-v3-turbo",
    volume = 0.8,
  } = options;

  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [aiText, setAiText] = useState("");
  const [voiceCaption, setVoiceCaption] = useState<VoiceCaptionState | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  // Each entry is a promise that resolves to a blob URL (or null on error).
  // Promises are pushed the instant a sentence is extracted — HTTP fetch starts
  // immediately and runs in parallel with playback of the previous sentence.
  const audioPromiseQueueRef = useRef<Array<{ text: string; urlPromise: Promise<string | null> }>>([]);
  const isPlayingTTSRef = useRef(false);
  // Incrementing this counter invalidates all in-flight fetches on stopTTS.
  const ttsGenerationRef = useRef(0);
  const isMicMutedRef = useRef(false);
  const isSpeakerMutedRef = useRef(false);
  const sessionStateRef = useRef<SessionState>("idle");
  const conversationRef = useRef<APIChatMessage[]>([]);
  const volumeRef = useRef(volume);

  // Keep volume ref in sync and apply to any currently-playing audio element
  useEffect(() => {
    volumeRef.current = volume;
    if (activeAudioRef.current) {
      activeAudioRef.current.volume = volume;
    }
  }, [volume]);

  // VAD state
  const speechFramesRef = useRef(0);
  const speechStartedRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const updateSessionState = useCallback((state: SessionState) => {
    sessionStateRef.current = state;
    setSessionState(state);
  }, []);

  // ── TTS pipeline (parallel fetch + sequential playback) ──────────────────
  //
  // fetchAudio fires immediately when a sentence arrives — it does NOT wait
  // for the previous sentence to finish playing. The HTTP request for sentence
  // N+1 runs while sentence N is still being spoken, so by the time playback
  // of N ends the audio for N+1 is already (or almost) ready.

  const fetchAudio = useCallback(
    (text: string, generation: number): Promise<string | null> =>
      apiClient
        .postBinary("/audio/speech", { model: ttsModel, input: text })
        .then(async (res) => {
          if (ttsGenerationRef.current !== generation) return null;
          if (!res.ok) return null;
          const blob = await res.blob();
          if (ttsGenerationRef.current !== generation) return null;
          return URL.createObjectURL(blob);
        })
        .catch(() => null),
    [ttsModel]
  );

  // playFromQueue is called either when a new sentence arrives (if idle) or
  // recursively from onended. It awaits the next promise — which may already
  // be settled if the fetch finished while the previous sentence was playing.
  const playFromQueue = useCallback(async () => {
    if (audioPromiseQueueRef.current.length === 0) {
      isPlayingTTSRef.current = false;
      if (sessionStateRef.current === "speaking") {
        updateSessionState("listening");
      }
      return;
    }

    isPlayingTTSRef.current = true;
    const item = audioPromiseQueueRef.current.shift()!;
    const url = await item.urlPromise;

    // Stop was called while awaiting — bail out cleanly.
    if (!isPlayingTTSRef.current) {
      if (url) URL.revokeObjectURL(url);
      return;
    }

    if (!url || isSpeakerMutedRef.current) {
      playFromQueue();
      return;
    }

    const audio = new Audio(url);
    audio.volume = volumeRef.current;
    activeAudioRef.current = audio;

    const words = item.text.trim().split(/\s+/).filter(Boolean);
    const updateCaption = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : Math.max(1.2, words.length * 0.42);
      const progress = Math.min(0.98, Math.max(0, audio.currentTime / duration));
      const wordIndex = Math.min(words.length - 1, Math.floor(progress * words.length));
      setVoiceCaption({ text: item.text, wordIndex: Math.max(0, wordIndex) });
    };

    const advance = () => {
      URL.revokeObjectURL(url);
      activeAudioRef.current = null;
      setVoiceCaption(null);
      playFromQueue();
    };
    audio.ontimeupdate = updateCaption;
    audio.onplaying = updateCaption;
    audio.onended = advance;
    audio.onerror = advance;

    await audio.play().catch(() => advance());
  }, [updateSessionState]);

  const stopTTS = useCallback(() => {
    ttsGenerationRef.current++;          // invalidate all in-flight fetches
    audioPromiseQueueRef.current = [];   // drop pending promises
    isPlayingTTSRef.current = false;
    setVoiceCaption(null);
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.onended = null;
      activeAudioRef.current.onerror = null;
      activeAudioRef.current = null;
    }
  }, []);

  const enqueueTTS = useCallback(
    (text: string) => {
      if (!text.trim() || isSpeakerMutedRef.current) return;
      // Fire the HTTP request NOW — parallel to whatever is currently playing.
      const gen = ttsGenerationRef.current;
      audioPromiseQueueRef.current.push({ text, urlPromise: fetchAudio(text, gen) });
      if (!isPlayingTTSRef.current) {
        playFromQueue();
      }
    },
    [fetchAudio, playFromQueue]
  );

  // ── AI streaming ──────────────────────────────────────────────────────────

  const sendToAI = useCallback(
    async (userText: string) => {
      if (!userText.trim()) {
        updateSessionState("listening");
        return;
      }

      updateSessionState("processing");
      setAiText("");
      setVoiceCaption(null);

      const userMessage: APIChatMessage = { role: "user", content: userText };
      conversationRef.current = [...conversationRef.current, userMessage];

      const messages: APIChatMessage[] = [
        { role: "system", content: VOICE_SYSTEM_PROMPT },
        ...conversationRef.current,
      ];

      abortControllerRef.current = new AbortController();
      let fullResponse = "";
      let textBuffer = "";

      try {
        updateSessionState("speaking");

        const stream = aiService.chatStream(
          messages,
          model,
          0.6,
          false,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          abortControllerRef.current.signal
        );

        for await (const token of stream) {
          fullResponse += token;
          textBuffer += token;
          setAiText(fullResponse);

          const { sentences, remaining } = extractSentences(textBuffer);
          textBuffer = remaining;
          for (const sentence of sentences) {
            enqueueTTS(sentence);
          }
        }

        // Flush remaining buffer
        if (textBuffer.trim().length > 0) {
          enqueueTTS(textBuffer.trim());
        }

        if (fullResponse) {
          conversationRef.current = [
            ...conversationRef.current,
            { role: "assistant", content: fullResponse },
          ];
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          logger.error("LiveSession", "AI stream error", err);
        }
        if (sessionStateRef.current !== "idle") {
          updateSessionState("listening");
        }
      }
    },
    [model, enqueueTTS, updateSessionState]
  );

  // ── VAD + recording ───────────────────────────────────────────────────────

  const transcribeAndSend = useCallback(
    async (chunks: Blob[]) => {
      if (chunks.length === 0) return;
      if (isMicMutedRef.current) {
        updateSessionState("listening");
        return;
      }

      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size < 1000) {
        updateSessionState("listening");
        return;
      }

      const audioFile = new File([blob], "audio.webm", { type: "audio/webm" });

      try {
        const result = await aiService.transcribe(audioFile, transcriptionModel);
        if (result.success && result.data?.trim()) {
          setTranscript(result.data);
          await sendToAI(result.data);
        } else {
          updateSessionState("listening");
        }
      } catch {
        updateSessionState("listening");
      }
    },
    [transcriptionModel, sendToAI, updateSessionState]
  );

  const restartRecording = useCallback(() => {
    if (!streamRef.current) return;
    try {
      const mr = new MediaRecorder(streamRef.current, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.start(100);
      mediaRecorderRef.current = mr;
    } catch {
      try {
        const mr = new MediaRecorder(streamRef.current!);
        audioChunksRef.current = [];
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mr.start(100);
        mediaRecorderRef.current = mr;
      } catch (err) {
        logger.error("LiveSession", "Failed to restart recorder", err);
      }
    }
  }, []);

  const startVAD = useCallback(() => {
    speechFramesRef.current = 0;
    speechStartedRef.current = false;
    silenceStartRef.current = null;

    vadIntervalRef.current = setInterval(() => {
      const state = sessionStateRef.current;
      if (state !== "listening" && state !== "speaking") return;

      const analyser = analyserRef.current;
      if (!analyser) return;

      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const hasSpeech = avg > SILENCE_THRESHOLD;

      if (hasSpeech) {
        speechFramesRef.current++;
        silenceStartRef.current = null;

        if (!speechStartedRef.current && speechFramesRef.current >= SPEECH_START_FRAMES) {
          speechStartedRef.current = true;
          // Interrupt AI if it's currently speaking
          if (state === "speaking") {
            abortControllerRef.current?.abort();
            stopTTS();
            updateSessionState("listening");
          }
        }
      } else {
        speechFramesRef.current = 0;

        if (speechStartedRef.current && state === "listening") {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current >= SILENCE_END_MS) {
            // End of turn — collect chunks and send
            speechStartedRef.current = false;
            silenceStartRef.current = null;

            const mr = mediaRecorderRef.current;
            if (mr && mr.state === "recording") {
              mr.stop();
              mr.onstop = () => {
                const chunks = [...audioChunksRef.current];
                audioChunksRef.current = [];
                transcribeAndSend(chunks).finally(() => {
                  if (sessionStateRef.current !== "idle") {
                    restartRecording();
                  }
                });
              };
            } else {
              // Recorder isn't active (prior turn's async chain hasn't restarted it yet).
              // Discard the noise and restart cleanly so the session stays live.
              audioChunksRef.current = [];
              if (sessionStateRef.current !== "idle") {
                restartRecording();
              }
            }
          }
        }
      }
    }, VAD_INTERVAL_MS);
  }, [stopTTS, transcribeAndSend, restartRecording, updateSessionState]);

  // ── Session lifecycle ─────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    if (sessionState !== "idle") return;
    updateSessionState("connecting");
    setError(null);
    setTranscript("");
    setAiText("");
    setVoiceCaption(null);
    conversationRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      restartRecording();
      updateSessionState("listening");

      startVAD();

      // Session timer
      setSessionSeconds(0);
      sessionTimerRef.current = setInterval(() => {
        setSessionSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setError(msg);
      updateSessionState("error");
    }
  }, [sessionState, updateSessionState, restartRecording, startVAD]);

  const endSession = useCallback(() => {
    // Stop VAD
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    // Stop timer
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    // Abort AI
    abortControllerRef.current?.abort();
    // Stop TTS
    stopTTS();
    // Stop recording
    if (mediaRecorderRef.current?.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    // Stop stream tracks
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Close audio context
    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    audioChunksRef.current = [];
    conversationRef.current = [];
    setSessionSeconds(0);
    setVoiceCaption(null);
    updateSessionState("idle");
  }, [stopTTS, updateSessionState]);

  const toggleMicMute = useCallback(() => {
    isMicMutedRef.current = !isMicMutedRef.current;
    setIsMicMuted(isMicMutedRef.current);
  }, []);

  const toggleSpeakerMute = useCallback(() => {
    isSpeakerMutedRef.current = !isSpeakerMutedRef.current;
    setIsSpeakerMuted(isSpeakerMutedRef.current);
    if (isSpeakerMutedRef.current) stopTTS();
  }, [stopTTS]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionStateRef.current !== "idle") {
        endSession();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sessionState,
    transcript,
    aiText,
    voiceCaption,
    isMicMuted,
    isSpeakerMuted,
    sessionSeconds,
    error,
    startSession,
    endSession,
    toggleMicMute,
    toggleSpeakerMute,
    analyserRef,
  };
}
