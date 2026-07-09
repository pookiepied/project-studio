import { useState, useRef, useCallback, useEffect } from "react";
import { RecordingState } from "@/types";
import { aiService } from "@/features/chat/services/aiService";
import { processTranscriptionChunks, TranscriptionChunk } from "@/utils/textMerger";
import { reportError } from "@/core/errors/errorReporting";
import { errorService } from "@/core/errors/errorService";
import { NotificationService } from "@/core/notifications";
import { logger } from "@/core/logging/logger";

interface AudioRecorderOptions {
  chunkDuration?: number; // seconds
  onTranscriptionUpdate?: (text: string) => void;
  onComplete?: (finalText: string, rephrasedText?: string) => void;
  onError?: (error: string) => void;
  autoRephrase?: boolean;
  rephraseTone?: string;
  transcriptionModel?: string;
  rephraseModel?: string;
  selectedMicrophone?: string; // Device ID for specific microphone (undefined = default)
  // VAD settings
  silenceThreshold?: number; // 0-255, volume threshold for silence detection
  maxChunks?: number; // Maximum number of chunks to keep in memory (default: 100)
}

export function useAudioRecorder(options: AudioRecorderOptions = {}) {
  const {
    chunkDuration = 10,
    onTranscriptionUpdate,
    onComplete,
    onError,
    autoRephrase = true,
    rephraseTone = "standard",
    transcriptionModel = "groq:whisper-large-v3-turbo",
    rephraseModel = "groq:llama-3.1-8b-instant",
    selectedMicrophone, // undefined = use default microphone
    silenceThreshold = 5, // 0-255 scale (5 is very quiet)
    maxChunks = 100, // Limit to prevent memory issues (100 chunks = ~16 minutes at 10s each)
  } = options;

  const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [rephrasedText, setRephrasedText] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const transcriptionChunksRef = useRef<TranscriptionChunk[]>([]);
  const chunkCounterRef = useRef(0);
  const chunkStartTimeRef = useRef(0);
  const chunkHadSpeechRef = useRef(false);
  const checkIntervalRef = useRef<number | null>(null);
  const chunkIntervalRef = useRef<number | null>(null);
  // Set to true the moment stopRecording is called so in-flight transcribeChunk
  // calls don't reset state back to RECORDING after finalization.
  const isStoppedRef = useRef(false);
  // Counts transcribeChunk calls that are still awaiting their API response.
  // stopRecording loops on this instead of the stale `recordingState` closure value.
  const pendingTranscriptionsRef = useRef(0);

  /**
   * Cleanup function to stop recording and release resources
   */
  const cleanup = useCallback(() => {
    logger.debug('AudioRecorder', "Starting cleanup");

    // Clear intervals
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    // Stop and cleanup MediaRecorder
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder) {
      // Clear stored intervals
      if ((mediaRecorder as any).checkInterval) {
        clearInterval((mediaRecorder as any).checkInterval);
        delete (mediaRecorder as any).checkInterval;
      }
      if ((mediaRecorder as any).chunkInterval) {
        clearInterval((mediaRecorder as any).chunkInterval);
        delete (mediaRecorder as any).chunkInterval;
      }

      // Stop recording if active
      if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
        try {
          mediaRecorder.stop();
        } catch (error) {
          logger.warn('AudioRecorder', "Error stopping MediaRecorder:", error);
        }
      }

      // Stop all media tracks
      if (mediaRecorder.stream) {
        mediaRecorder.stream.getTracks().forEach((track) => {
          track.stop();
          logger.debug('AudioRecorder', `Stopped track: ${track.kind}`);
        });
      }

      // Clear event handlers to prevent memory leaks
      mediaRecorder.ondataavailable = null;
      mediaRecorder.onerror = null;
      mediaRecorder.onstop = null;
      mediaRecorder.onstart = null;

      mediaRecorderRef.current = null;
    }

    // Close AudioContext
    const audioContext = audioContextRef.current;
    if (audioContext && audioContext.state !== "closed") {
      try {
        audioContext.close();
        logger.debug('AudioRecorder', "Closed AudioContext");
      } catch (error) {
        logger.warn('AudioRecorder', "Error closing AudioContext:", error);
      }
      audioContextRef.current = null;
    }

    // Clear analyser reference
    analyserRef.current = null;

    logger.debug('AudioRecorder', "Cleanup complete");
  }, []);

  /**
   * Cleanup on component unmount
   */
  useEffect(() => {
    return () => {
      logger.debug('AudioRecorder', "Component unmounting, cleaning up");
      cleanup();
    };
  }, [cleanup]);

  /**
   * Check if audio contains speech (Voice Activity Detection)
   */
  const isSpeechDetected = useCallback((): boolean => {
    const analyser = analyserRef.current;
    if (!analyser) return true; // If no analyser, assume speech

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Calculate average volume (0-255 scale)
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;

    // Update if speech detected
    if (average > silenceThreshold) {
      chunkHadSpeechRef.current = true; // Mark that this chunk has speech
      return true;
    }

    return false;
  }, [silenceThreshold]);

  /**
   * Start recording audio
   */
  const startRecording = useCallback(async (showNotification: boolean = false) => {
    try {
      // Build audio constraints
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      };

      // Add device constraint if specific microphone selected
      if (selectedMicrophone) {
        audioConstraints.deviceId = { exact: selectedMicrophone };
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      // Set up Web Audio API for VAD with error handling
      let audioContext: AudioContext;
      let source: MediaStreamAudioSourceNode;
      let analyser: AnalyserNode;
      
      try {
        audioContext = new AudioContext();
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
      } catch (error) {
        logger.error('AudioRecorder', 'Failed to set up Web Audio API for VAD:', error);
        // Continue without VAD - just mark all chunks as having speech
        audioContextRef.current = null;
        analyserRef.current = null;
      }

      // Create MediaRecorder with proper format detection
      let mediaRecorder: MediaRecorder;
      
      // Check for supported MIME types and create MediaRecorder accordingly
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
        });
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/webm",
        });
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/mp4",
        });
      } else {
        // Fallback to default (browser will choose best available)
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = mediaRecorder;
      transcriptionChunksRef.current = [];
      chunkCounterRef.current = 0;
      chunkStartTimeRef.current = Date.now();
      chunkHadSpeechRef.current = false;
      isStoppedRef.current = false;
      pendingTranscriptionsRef.current = 0;

      // Handle data available - complete recording chunk
      mediaRecorder.ondataavailable = (event) => {
        try {
          if (event.data.size > 0) {
            logger.debug('AudioRecorder', `Complete chunk available: ${event.data.size} bytes`);
            logger.debug('AudioRecorder', `Original MIME type: ${event.data.type}`);
            
            const hadSpeech = chunkHadSpeechRef.current;
            const chunkStartTime = chunkStartTimeRef.current;
            const chunkEndTime = Date.now();
            
            // Process the chunk if it had speech
            if (hadSpeech) {
              logger.debug('AudioRecorder', `Processing chunk with speech`);
              
              // Create a File object (not Blob) with clean MIME type
              // File constructor allows us to override the MIME type properly
              const audioFile = new File([event.data], "audio.webm", { 
                type: "audio/webm",
                lastModified: Date.now()
              });
              
              logger.debug('AudioRecorder', `Created File with MIME type: ${audioFile.type}`);
              
              transcribeChunk(audioFile, chunkStartTime, chunkEndTime).catch((error) => {
                logger.error('AudioRecorder', `Transcription error:`, error);
              });
            } else {
              logger.debug('AudioRecorder', `Skipping silent chunk`);
            }
          }
        } catch (error) {
          logger.error('AudioRecorder', 'Error in ondataavailable handler:', error);
          onError?.("Audio processing error occurred");
        }
      };

      // Handle MediaRecorder errors
      mediaRecorder.onerror = (event) => {
        logger.error('AudioRecorder', 'MediaRecorder error:', event);
        setRecordingState(RecordingState.ERROR);
        onError?.("Recording error occurred");
      };

      // Handle MediaRecorder state changes
      mediaRecorder.onstart = () => {
        logger.debug('AudioRecorder', 'MediaRecorder started');
      };

      mediaRecorder.onstop = () => {
        logger.debug('AudioRecorder', 'MediaRecorder stopped');
      };

      // Validate MediaRecorder before starting
      if (!mediaRecorder || typeof mediaRecorder.start !== 'function') {
        throw new Error('MediaRecorder not properly initialized');
      }

      // Start recording WITHOUT timeslice
      mediaRecorder.start();
      setRecordingState(RecordingState.RECORDING);

      // Show notification if requested (hotkey only)
      if (showNotification) {
        NotificationService.showRecordingStarted();
      }

      // Manually stop/start every chunkDuration to get complete files
      const chunkInterval = setInterval(() => {
        // Check if we should still be recording
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
          logger.debug('AudioRecorder', `Interval stopped - recorder state: ${mediaRecorderRef.current?.state || 'null'}`);
          clearInterval(chunkInterval);
          return;
        }

        logger.debug('AudioRecorder', `Stopping to get complete chunk`);
        
        // Stop to trigger ondataavailable with complete file
        try {
          mediaRecorder.stop();
        } catch (error) {
          logger.error('AudioRecorder', 'Error stopping MediaRecorder for chunk:', error);
          clearInterval(chunkInterval);
          return;
        }
        
        // Wait a bit for ondataavailable to fire
        setTimeout(() => {
          // Double-check we're still supposed to be recording
          if (!mediaRecorderRef.current || !mediaRecorderRef.current.stream.active) {
            logger.debug('AudioRecorder', `Not restarting - stream inactive or recorder cleared`);
            return;
          }
          
          // Check if stop was called (intervals would be cleared)
          if (!checkIntervalRef.current || !chunkIntervalRef.current) {
            logger.debug('AudioRecorder', `Not restarting - intervals were cleared (user stopped recording)`);
            return;
          }
          
          logger.debug('AudioRecorder', `Restarting for next chunk`);
          
          // Reset state for next chunk
          chunkStartTimeRef.current = Date.now();
          chunkHadSpeechRef.current = false;
          
          // Start again
          try {
            if (mediaRecorder && typeof mediaRecorder.start === 'function') {
              mediaRecorder.start();
            } else {
              logger.error('AudioRecorder', 'MediaRecorder not available for restart');
              clearInterval(chunkInterval);
            }
          } catch (error) {
            logger.error('AudioRecorder', `Error restarting:`, error);
            clearInterval(chunkInterval);
          }
        }, 100);
      }, chunkDuration * 1000);

      // Check periodically for speech activity (for VAD)
      const checkInterval = setInterval(() => {
        if (!mediaRecorderRef.current || mediaRecorder.state !== "recording") {
          return;
        }

        // Check speech activity
        isSpeechDetected(); // Update chunkHadSpeechRef

        // If VAD is effectively disabled (threshold too high), always mark as having speech
        if (silenceThreshold >= 255) {
          chunkHadSpeechRef.current = true;
        }

        const now = Date.now();
        const chunkElapsed = (now - chunkStartTimeRef.current) / 1000;
        logger.debug('AudioRecorder', `VAD Check: elapsed=${chunkElapsed.toFixed(1)}s, hadSpeech=${chunkHadSpeechRef.current}`);
      }, 500); // Check every 500ms

      // Store intervals in refs for cleanup
      checkIntervalRef.current = checkInterval;
      chunkIntervalRef.current = chunkInterval;

      // Also store on mediaRecorder for backward compatibility
      (mediaRecorder as any).checkInterval = checkInterval;
      (mediaRecorder as any).chunkInterval = chunkInterval;
    } catch (error) {
      const userMessage = errorService.getUserMessage(error);
      logger.error('AudioRecorder', "Start error:", error);
      
      // Report error
      reportError(
        error instanceof Error ? error : new Error(userMessage),
        { action: "startRecording", silenceThreshold, chunkDuration, selectedMicrophone }
      );
      
      setRecordingState(RecordingState.ERROR);
      onError?.(userMessage);
    }
    // transcribeChunk is component-local (declared below; including would create infinite re-bind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkDuration, isSpeechDetected, silenceThreshold, selectedMicrophone, onError]);

  /**
   * Stop recording audio
   */
  const stopRecording = useCallback(async () => {
    const mediaRecorder = mediaRecorderRef.current;

    if (!mediaRecorder) return;

    // Signal all in-flight transcribeChunk calls not to reset state to RECORDING.
    isStoppedRef.current = true;

    logger.debug('AudioRecorder', "Stopping recording");

    // Clear intervals FIRST to prevent auto-restart
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    // Also clear from mediaRecorder object
    if ((mediaRecorder as any).checkInterval) {
      clearInterval((mediaRecorder as any).checkInterval);
      delete (mediaRecorder as any).checkInterval;
    }
    if ((mediaRecorder as any).chunkInterval) {
      clearInterval((mediaRecorder as any).chunkInterval);
      delete (mediaRecorder as any).chunkInterval;
    }

    // Set state to processing BEFORE stopping to prevent UI issues
    setRecordingState(RecordingState.PROCESSING);

    // Stop recording (final chunk will be sent via ondataavailable)
    if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
      try {
        mediaRecorder.stop();
      } catch (error) {
        logger.warn('AudioRecorder', "Error stopping recorder:", error);
      }
    }

    // Wait for final chunk to be captured
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Stop all tracks
    if (mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach((track) => {
        track.stop();
        logger.debug('AudioRecorder', `Stopped track: ${track.kind}`);
      });
    }

    // Close audio context
    const audioContext = audioContextRef.current;
    if (audioContext && audioContext.state !== "closed") {
      try {
        await audioContext.close();
        logger.debug('AudioRecorder', "Closed AudioContext");
      } catch (error) {
        logger.warn('AudioRecorder', "Error closing AudioContext:", error);
      }
    }

    // Clear the mediaRecorder ref to prevent any further operations
    mediaRecorderRef.current = null;

    // Wait for any in-flight transcribeChunk API calls to finish before we
    // finalize. Uses a ref counter (not stale React state) so the check is live.
    const maxWaitTime = 8000; // 8-second failsafe
    const pollInterval = 100;
    let waitedTime = 0;

    logger.debug('AudioRecorder', `Waiting for ${pendingTranscriptionsRef.current} pending transcription(s)…`);

    while (pendingTranscriptionsRef.current > 0 && waitedTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      waitedTime += pollInterval;
      logger.debug('AudioRecorder', `Still waiting… pending=${pendingTranscriptionsRef.current} elapsed=${waitedTime}ms`);
    }

    if (waitedTime >= maxWaitTime) {
      logger.warn('AudioRecorder', `Timeout waiting for transcriptions (${maxWaitTime}ms), finalizing anyway`);
    } else {
      logger.debug('AudioRecorder', `All transcriptions done after ${waitedTime}ms`);
    }

    // Additional small wait to ensure the last chunk is added to the array
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Merge all transcriptions
    await finalizeTranscription();
    // finalizeTranscription is component-local (declared below; re-bind on recordingState only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingState]);

  /**
   * Transcribe a single audio chunk
   */
  const transcribeChunk = async (audioFile: File, startTime: number, endTime: number) => {
    pendingTranscriptionsRef.current += 1;
    try {
      logger.debug('AudioRecorder', `Starting transcription for chunk ${chunkCounterRef.current} (${audioFile.size} bytes, type: ${audioFile.type})`);
      setRecordingState(RecordingState.TRANSCRIBING);

      const result = await aiService.transcribe(audioFile, transcriptionModel);

      if (result.success && result.data) {
        logger.debug('AudioRecorder', `Success: "${result.data}"`);
        const chunk: TranscriptionChunk = {
          id: `chunk-${chunkCounterRef.current++}`,
          text: result.data,
          startTime,
          endTime,
        };

        transcriptionChunksRef.current.push(chunk);

        // Limit chunk accumulation to prevent memory issues
        if (transcriptionChunksRef.current.length > maxChunks) {
          logger.warn('AudioRecorder', `Chunk limit reached (${maxChunks}), removing oldest chunks`);
          // Keep only the most recent maxChunks
          transcriptionChunksRef.current = transcriptionChunksRef.current.slice(-maxChunks);
        }

        // Update partial transcript
        const merged = processTranscriptionChunks(
          transcriptionChunksRef.current.map((c) => c.text)
        );
        logger.debug('AudioRecorder', `Merged transcript: "${merged}"`);
        setPartialTranscript(merged);
        onTranscriptionUpdate?.(merged);
      } else {
        logger.error('AudioRecorder', `Failed:`, result.error);
        
        // Check if it's an API configuration error
        const errorMessage = result.error || "Transcription failed";
        if (isAPIConfigurationError(errorMessage)) {
          // Show user-friendly API configuration error
          onError?.("API not configured. Please configure your API settings to use transcription features.");
        } else {
          // Show generic transcription error
          onError?.(errorMessage);
        }
        
        // Report transcription error
        reportError(new Error(result.error || "Transcription failed"), {
          action: "transcribeChunk",
          chunkId: chunkCounterRef.current,
          fileSize: audioFile.size,
          fileType: audioFile.type,
        });
      }

      // Only resume RECORDING state if stopRecording hasn't been called yet.
      // If it has, an in-flight API response must not pull the UI back out of
      // PROCESSING / COMPLETE / ERROR into RECORDING (the stuck-mic bug).
      if (!isStoppedRef.current) {
        setRecordingState(RecordingState.RECORDING);
      }
    } catch (error) {
      logger.error('AudioRecorder', "Error:", error);

      reportError(
        error instanceof Error ? error : new Error("Transcription error"),
        { action: "transcribeChunk", chunkId: chunkCounterRef.current }
      );
    } finally {
      pendingTranscriptionsRef.current = Math.max(0, pendingTranscriptionsRef.current - 1);
    }
  };

  /**
   * Check if error is related to API configuration
   */
  const isAPIConfigurationError = (error: string): boolean => {
    const apiErrorKeywords = [
      'no provider',
      'api not configured',
      'unauthorized',
      'authentication failed',
      'network error',
      'fetch failed',
      'connection refused',
      'api key'
    ];

    const lowerError = error.toLowerCase();
    return apiErrorKeywords.some(keyword => lowerError.includes(keyword));
  };

  /**
   * Safely copy text to clipboard with error handling
   */
  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      logger.debug('AudioRecorder', `Copied to clipboard`);
      return true;
    } catch (error) {
      const userMessage = errorService.getUserMessage(error);
      logger.error('AudioRecorder', `Failed to copy:`, userMessage);
      // Don't report to error service - clipboard is optional feature
      // User can still see and use the text even if clipboard fails
      return false;
    }
  };

  /**
   * Finalize transcription and optionally rephrase
   */
  const finalizeTranscription = async () => {
    try {
      logger.debug('AudioRecorder', `Starting finalization with ${transcriptionChunksRef.current.length} chunks`);

      // Merge all chunks
      const finalText = processTranscriptionChunks(
        transcriptionChunksRef.current.map((c) => c.text)
      );

      logger.debug('AudioRecorder', `Final text: "${finalText}"`);
      setFinalTranscript(finalText);

      if (!finalText) {
        logger.debug('AudioRecorder', `No text to process, completing`);
        setRecordingState(RecordingState.COMPLETE);
        onComplete?.(finalText);
        return;
      }

      // Rephrase if enabled
      if (autoRephrase) {
        logger.debug('AudioRecorder', `Starting rephrase with tone: ${rephraseTone}, text length: ${finalText.length}`);
        logger.debug('AudioRecorder', `Text to rephrase: "${finalText.substring(0, 100)}..."`);
        setRecordingState(RecordingState.REPHRASING);

        try {
          const rephraseResult = await aiService.rephrase(
            finalText,
            rephraseTone,
            rephraseModel
          );

          logger.debug('AudioRecorder', `Rephrase result:`, rephraseResult);
          
          if (rephraseResult.success && rephraseResult.data) {
            logger.debug('AudioRecorder', `Rephrase success: "${rephraseResult.data}"`);
            setRephrasedText(rephraseResult.data);

            // Copy to clipboard (with error handling)
            await copyToClipboard(rephraseResult.data);

            setRecordingState(RecordingState.COMPLETE);
            onComplete?.(finalText, rephraseResult.data);
          } else {
            logger.error('AudioRecorder', `Rephrase failed:`, rephraseResult.error);
            
            // Report rephrase error but still show original text
            reportError(new Error(`Rephrase failed: ${rephraseResult.error}`), {
              action: "rephrase",
              textLength: finalText.length,
              tone: rephraseTone,
              model: rephraseModel,
            });
            
            // Fall back to original text
            await copyToClipboard(finalText);
            setRecordingState(RecordingState.COMPLETE);
            onComplete?.(finalText);
          }
        } catch (error) {
          logger.error('AudioRecorder', `Rephrase exception:`, error);
          
          // Report unexpected rephrase error
          reportError(
            error instanceof Error ? error : new Error("Rephrase exception"),
            {
              action: "rephrase",
              textLength: finalText.length,
              tone: rephraseTone,
              model: rephraseModel,
            }
          );
          
          // Fall back to original text
          await copyToClipboard(finalText);
          setRecordingState(RecordingState.COMPLETE);
          onComplete?.(finalText);
        }
      } else {
        logger.debug('AudioRecorder', `Auto-rephrase disabled, copying original`);
        // Copy original to clipboard (with error handling)
        await copyToClipboard(finalText);

        setRecordingState(RecordingState.COMPLETE);
        onComplete?.(finalText);
      }
    } catch (error) {
      const userMessage = errorService.getUserMessage(error);
      logger.error('AudioRecorder', "Error:", error);
      
      // Report error
      reportError(
        error instanceof Error ? error : new Error(userMessage),
        { action: "finalizeTranscription", chunkCount: transcriptionChunksRef.current.length }
      );
      
      setRecordingState(RecordingState.ERROR);
      onError?.(userMessage);
    }
  };

  /**
   * Reset recorder state
   */
  const reset = useCallback(() => {
    setRecordingState(RecordingState.IDLE);
    setPartialTranscript("");
    setFinalTranscript("");
    setRephrasedText("");
    transcriptionChunksRef.current = [];
    chunkCounterRef.current = 0;
  }, []);

  return {
    recordingState,
    partialTranscript,
    finalTranscript,
    rephrasedText,
    startRecording, // Now accepts showNotification parameter
    stopRecording,
    reset,
    isRecording: recordingState === RecordingState.RECORDING,
    isProcessing:
      recordingState === RecordingState.PROCESSING ||
      recordingState === RecordingState.TRANSCRIBING ||
      recordingState === RecordingState.REPHRASING,
    analyserRef,
  };
}
