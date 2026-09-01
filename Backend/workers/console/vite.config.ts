import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  root: "ui",
  // Stated rather than inferred: the nearest tsconfig to ui/ is the worker's,
  // which has no `jsx` setting, so esbuild fell back to the classic transform
  // and the bundle referenced a global React that React 19 does not provide.
  esbuild: { jsx: "automatic" },
  plugins: [react(), tailwind()],
  build: {
    // Served by the worker through the ASSETS binding, behind Access.
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  server: {
    // `pnpm dev` runs the UI alone; API calls go to a local wrangler dev.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
