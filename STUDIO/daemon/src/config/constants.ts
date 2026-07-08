export const DAEMON_PORT = parseInt(process.env.LOCAL_PROVIDER_PORT || '11435', 10);
export const DAEMON_HOST = 'localhost';

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
export const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234';

export const DAEMON_VERSION = '1.0.0';

export const DAEMON_TIMEOUTS = {
  MODEL_DISCOVERY: 5000,
  PROVIDER_CHECK: 3000,
  CHAT_COMPLETION: 120000,
} as const;

export const STREAMING_CONFIG = {
  HEARTBEAT_INTERVAL: 30000,
  CHUNK_SIZE: 1024,
} as const;
