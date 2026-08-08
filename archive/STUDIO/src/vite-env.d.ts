/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_KEY?: string;
  readonly VITE_ENGINE_API_KEY?: string;
  readonly VITE_SYSTEM_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Tauri API types
interface Window {
  __TAURI__?: {
    window: {
      getCurrent(): {
        minimize(): Promise<void>;
        close(): Promise<void>;
      };
    };
  };
}
