import { io } from 'socket.io-client';

// Conecta no servidor Node.js
const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3005';

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
});
