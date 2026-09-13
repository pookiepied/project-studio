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
        // Three chunks for the three parts of the rendering stack, because
        // they are needed at three different moments: markdown by the first
        // reply, the highlighter by the first code fence, the maths
        // typesetter by the first formula - and the last two are fetched on
        // demand (`Deferred`, `useMath`). Each changes only when a dependency
        // is bumped, so a remote device keeps them cached across ordinary
        // app changes. `katex` is listed before `render` so its plugin lands
        // with the typesetter rather than with the markdown it plugs into.
        codeSplitting: {
          groups: [
            {
              name: 'katex',
              test: /node_modules[\/](katex|rehype-katex|remark-math|micromark-extension-math|mdast-util-math)[\/]/,
            },
            {
              name: 'highlight',
              test: /node_modules[\/](react-syntax-highlighter|refractor|highlight\.js|lowlight)[\/]/,
            },
            {
              name: 'render',
              test: /node_modules[\/](react-markdown|remark-|rehype-|micromark|mdast-|hast-|unified)/,
            },
          ],
        },

      },
    },
  },
})
