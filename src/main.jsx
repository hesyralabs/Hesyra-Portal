import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { io } from 'socket.io-client'
import './index.css'
import App from './App.jsx'

// ─── Socket.io Singleton ──────────────────────────────────────
// The server proxies /api but socket.io is on port 3001 directly in dev.
const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  transports: ['websocket', 'polling'],
});

// Make accessible globally so contexts can subscribe
window.__hesyraSocket = socket;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
