import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Vite config for web version
export default defineConfig({
  plugins: [react()],
  
  root: resolve(__dirname, 'web'),
  
  publicDir: resolve(__dirname, 'public'),
  
  // Web-specific entry point
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'web/index.html'),
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
        },
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 600,
  },
  
  // Resolve paths for web
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  
  // Web-specific server config
  server: {
    port: 3000,
    host: '0.0.0.0', // Explicitly bind to all interfaces
    strictPort: true, // Fail if port is already in use
  },
  
  // Define web environment
  define: {
    __WEB_VERSION__: true,
    __TAURI__: false,
  },
});
