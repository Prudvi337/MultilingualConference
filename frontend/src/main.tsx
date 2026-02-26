/// <reference types="./vite-env.d.ts" />

/**
 * Application Entry Point
 * 
 * NOTE: React.StrictMode is temporarily disabled to avoid connection issues
 * with LiveKit during development. StrictMode causes components to mount twice,
 * which interferes with WebRTC connections.
 * 
 * Re-enable StrictMode after fixing the double-mount issue, or in production
 * (StrictMode only runs in development anyway).
 */

import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  // Temporarily disabled StrictMode to fix LiveKit connection issues
  // <React.StrictMode>
    <App />
  // </React.StrictMode>
);

