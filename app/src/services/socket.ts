import { io } from 'socket.io-client';

// Conecta no servidor Node.js
export const socket = io('http://127.0.0.1:3001', {
  autoConnect: true,
  reconnection: true
});
