import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

export interface User {
  id: string;
  name: string;
  avatar_url?: string;
  socket_id: string;
  entrou_em: number;
}

export interface Track {
  id: string;
  youtube_video_id: string;
  titulo: string;
  thumbnail_url: string;
  duracao_seg: number;
  audio_url?: string;
  video_url?: string;
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
  radialista_id: string | null;
  
  users: Map<string, User>; // socket_id -> User
  queue: Track[];
  history: Track[];
  chat: ChatMessage[];
  
  playback: {
    status: 'playing' | 'paused';
    currentTrackId: string | null;
    timestamp: number;
    updated_at: number;
  };
}

// In-memory store
export const rooms: Map<string, Room> = new Map();

// Push subscriptions: { userId: string, endpoint: string, sub: any, muted_rooms: string[] }
export const pushSubscriptions: Array<{ userId: string; endpoint: string; sub: any; muted_rooms: string[] }> = [];

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

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
      history: [],
      chat: [],
      playback: {
        status: 'paused',
        currentTrackId: null,
        timestamp: 0,
        updated_at: Date.now()
      }
    });

    if (supabase) {
      supabase.from('rooms').upsert({ id: roomId, name: roomName, codigo_convite: rooms.get(roomId)!.codigo_convite }).catch(console.error);
    }
  }
  return rooms.get(roomId)!;
}

export function syncUserToSupabase(user: { id: string; name: string }) {
  if (supabase) {
    supabase.from('users').upsert({ id: user.id, name: user.name }).catch(console.error);
  }
}

// Radialista = membro presente há mais tempo (menor entrou_em)
export function pickRadialista(room: Room): string | null {
  let oldestId: string | null = null;
  let oldestAt = Infinity;
  for (const user of room.users.values()) {
    if (user.entrou_em < oldestAt) {
      oldestAt = user.entrou_em;
      oldestId = user.id;
    }
  }
  return oldestId;
}
