import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4173,
    proxy: {
      "/admin": "http://gateway:8787",
      "/health": "http://gateway:8787",
      "/ready": "http://gateway:8787",
      "/v1": "http://gateway:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
