export const CORS_CONFIG = {
  allowedOrigins: [
    "https://api.pookiepied.dev",
    "https://studio.pookiepied.dev",
    "https://pookiepied.dev",
    "http://localhost",
    "http://localhost:1420",
    "http://127.0.0.1",
    "http://127.0.0.1:1420",
  ],
  allowedMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
} as const;

export const WORKER_CONFIG = {
  name: "gateway",
  version: "1.0.0",
  apiPrefix: "/v1",
} as const;
