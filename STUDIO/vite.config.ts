import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Tauri expects a fixed dev port and no terminal clearing.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // Ignore Cargo build artifacts — on Windows the compiler locks .dll
      // files, causing EBUSY errors in Vite's file watcher.
      ignored: ['**/src-tauri/target/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Tauri on Windows uses WebView2 (Chromium); elsewhere WKWebView (Safari).
    // `main.tsx` awaits at the top level, which needs Safari 15 or later;
    // the same bundle is served to other devices, so this is the floor for
    // their browsers too.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rolldownOptions: {
      output: {
        // The rendering stack (markdown, maths, code highlighting) changes
        // only when a dependency is bumped. Kept in its own chunk so a
        // remote device keeps it cached across ordinary app changes.
        codeSplitting: {
          groups: [
            {
              name: 'render',
              test: /node_modules[\/](react-markdown|remark-|rehype-|katex|micromark|mdast-|hast-|unified|react-syntax-highlighter|refractor|highlight\.js|lowlight)/,
            },
          ],
        },
      },
    },
  },
})
