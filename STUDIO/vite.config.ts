import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Path alias — @/* -> src/* (mirrors tsconfig.json paths; web config has its own)
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },

  // Define environment flags for platform detection
  define: {
    __WEB_VERSION__: false,
    __TAURI__: true,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  
  // Pre-bundle Tauri API sub-paths so Vite doesn't trigger a mid-session reload
  // when they're first dynamically imported (which crashes the WebView2 window).
  optimizeDeps: {
    include: [
      '@tauri-apps/api/app',
      '@tauri-apps/plugin-updater',
      '@tauri-apps/plugin-process',
    ],
  },

  // Build optimizations
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom'],
          // Animation library
          'framer-motion': ['framer-motion'],
          // Markdown rendering (largest dependency)
          'markdown': ['react-markdown', 'remark-gfm'],
          // Icons
          'icons': ['@phosphor-icons/react'],
          // Tauri plugins
          'tauri-plugins': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-autostart',
            '@tauri-apps/plugin-fs',
            '@tauri-apps/plugin-global-shortcut',
            '@tauri-apps/plugin-notification',
            '@tauri-apps/plugin-opener',
          ],
        },
      },
    },
    // Desktop app — large chunks load from local disk, not the network.
    chunkSizeWarningLimit: 10000,
  },
}));
