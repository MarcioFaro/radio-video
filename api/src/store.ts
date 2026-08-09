import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

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

export function loadRooms() {
  if (fs.existsSync(ROOMS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf-8'));
      for (const [id, roomData] of Object.entries(data)) {
        const room = roomData as Room;
        room.users = new Map();
        room.radialista_id = null; // Reassigned on join
        rooms.set(id, room);
      }
      console.log(`[Persistence] Loaded ${rooms.size} rooms from disk.`);
    } catch (e) {
      console.error('[Persistence] Failed to load rooms.json', e);
    }
  } else {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

let saveTimeout: NodeJS.Timeout | null = null;
export function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const data: Record<string, any> = {};
      for (const [id, room] of rooms.entries()) {
        const roomCopy = { ...room };
        delete (roomCopy as any).users; // We don't save volatile user connections
        data[id] = roomCopy;
      }
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(data), 'utf-8');
    } catch (e) {
      console.error('[Persistence] Failed to save rooms.json', e);
    }
  }, 5000); // 5 sec debounce
}

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
      supabase.from('rooms').upsert({ id: roomId, name: roomName, codigo_convite: rooms.get(roomId)!.codigo_convite }).then(res => { if(res.error) console.error(res.error) });
    }
  }
  return rooms.get(roomId)!;
}

export function syncUserToSupabase(user: { id: string; name: string }) {
  if (supabase) {
    supabase.from('users').upsert({ id: user.id, name: user.name }).then(res => { if(res.error) console.error(res.error) });
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
