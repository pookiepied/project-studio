export function buildAudioConstraints(selectedMicrophone?: string): MediaTrackConstraints {
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    sampleRate: 16000,
  };

  if (selectedMicrophone) {
    audioConstraints.deviceId = { exact: selectedMicrophone };
  }

  return audioConstraints;
}

export function createSupportedMediaRecorder(stream: MediaStream): MediaRecorder {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });
  }

  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return new MediaRecorder(stream, {
      mimeType: "audio/webm",
    });
  }

  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return new MediaRecorder(stream, {
      mimeType: "audio/mp4",
    });
  }

  return new MediaRecorder(stream);
}

export function setupSpeechAnalyser(stream: MediaStream): {
  audioContext: AudioContext;
  analyser: AnalyserNode;
} {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);

  return { audioContext, analyser };
}

export function isAPIConfigurationError(error: string): boolean {
  const apiErrorKeywords = [
    "no provider",
    "api not configured",
    "unauthorized",
    "authentication failed",
    "network error",
    "fetch failed",
    "connection refused",
    "api key",
  ];

  const lowerError = error.toLowerCase();
  return apiErrorKeywords.some((keyword) => lowerError.includes(keyword));
}
