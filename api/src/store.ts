export interface User {
  id: string;
  name: string;
  avatar_url?: string;
  socket_id: string;
}

export interface Track {
  id: string;
  youtube_video_id: string;
  titulo: string;
  thumbnail_url: string;
  duracao_seg: number;
  audio_url?: string;
  adicionado_por: string;
}

export interface ChatMessage {
  id: string;
  user_name: string;
  texto: string;
  timestamp: number;
}

export interface Room {
  id: string;
  name: string;
  codigo_convite: string;
  radialista_id: string;
  
  users: Map<string, User>; // socket_id -> User
  queue: Track[];
  chat: ChatMessage[];
  
  playback: {
    status: 'playing' | 'paused';
    currentTrackId: string | null;
    timestamp: number;
  };
}

// In-memory store
export const rooms: Map<string, Room> = new Map();

// Helper functions
export function getOrCreateRoom(roomId: string, roomName: string, radialistaId: string): Room {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      name: roomName,
      codigo_convite: Math.random().toString(36).substring(2, 8).toUpperCase(),
      radialista_id: radialistaId, // First person to join/create becomes the radialista
      users: new Map(),
      queue: [],
      chat: [],
      playback: {
        status: 'paused',
        currentTrackId: null,
        timestamp: 0
      }
    });
  }
  return rooms.get(roomId)!;
}
