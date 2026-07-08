/**
 * Web Version Entry Point
 * Reuses existing React components with web-specific adapters
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../src/App';

// Match the desktop entry's self-hosted typography stack.
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces/opsz-italic.css";
import "@fontsource/dm-mono/300.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/300-italic.css";
import "@fontsource/dm-mono/400-italic.css";
import '../src/styles/typography.css';

// Web-specific styles
import '../src/index.css';

// Initialize web version
// Note: Logger service not available at this early stage, using console for initialization only

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        // Service worker registered successfully
      })
      .catch((registrationError) => {
        // Service worker registration failed
      });
  });
}

// Mount React app
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
