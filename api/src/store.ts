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
  // true quando o playback foi pausado automaticamente por a sala ter ficado
  // vazia (para diferenciar de um pause manual ao decidir se retoma sozinho
  // quando alguem entra de novo)
  pausedForEmptyRoom: boolean;
}

// In-memory store
export const rooms: Map<string, Room> = new Map();

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

if (supabase) {
  console.log('[Supabase] Conectado com sucesso.');
} else {
  console.warn('[Supabase] SUPABASE_URL ou SUPABASE_ANON_KEY não configurados. Usando modo offline.');
}

// ── Persistência JSON (fallback) ──────────────────────────────────────────────

export function loadRoomsFromFile() {
  if (fs.existsSync(ROOMS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf-8'));
      for (const [id, roomData] of Object.entries(data)) {
        const room = roomData as Room;
        room.users = new Map();
        room.radialista_id = null;
        rooms.set(id, room);
      }
      console.log(`[Persistence] Carregados ${rooms.size} rooms do arquivo.`);
    } catch (e) {
      console.error('[Persistence] Falha ao ler rooms.json', e);
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
        delete (roomCopy as any).users;
        data[id] = roomCopy;
      }
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(data), 'utf-8');
    } catch (e) {
      console.error('[Persistence] Falha ao salvar rooms.json', e);
    }
  }, 5000);
}

// ── Supabase: Carregar salas e filas ──────────────────────────────────────────

export async function loadRooms() {
  // 1. Sempre carrega o arquivo local como base
  loadRoomsFromFile();

  if (!supabase) return;

  try {
    // 2. Carrega as rádios do Supabase
    const { data: dbRooms, error: roomsErr } = await supabase.from('rooms').select('*');
    if (roomsErr) { console.error('[Supabase] Erro ao carregar rooms:', roomsErr.message); return; }

    for (const dbRoom of (dbRooms || [])) {
      // 3. Carrega a fila de cada rádio (apenas músicas com status 'fila'), ordenadas
      const { data: dbTracks, error: tracksErr } = await supabase
        .from('room_tracks')
        .select('*, tracks_library(*)')
        .eq('room_id', dbRoom.id)
        .eq('status', 'fila')
        .order('order_index', { ascending: true });

      if (tracksErr) { console.error(`[Supabase] Erro ao carregar fila da room ${dbRoom.id}:`, tracksErr.message); continue; }

      const queue: Track[] = (dbTracks || []).map((rt: any) => ({
        id: rt.id, // UUID do room_tracks (ID único na fila)
        youtube_video_id: rt.youtube_id,
        titulo: rt.tracks_library?.titulo || 'Desconhecido',
        thumbnail_url: rt.tracks_library?.thumbnail_url || '',
        duracao_seg: rt.tracks_library?.duracao_seg || 0,
        audio_url: rt.tracks_library?.audio_url,
        video_url: rt.tracks_library?.video_url,
        adicionado_por: rt.adicionado_por,
      }));

      // Mescla com o que já existe na memória (priorizando Supabase)
      if (!rooms.has(dbRoom.id)) {
        rooms.set(dbRoom.id, {
          id: dbRoom.id,
          name: dbRoom.name,
          codigo_convite: dbRoom.codigo_convite || '',
          radialista_id: null,
          users: new Map(),
          queue,
          history: [],
          chat: [],
          playback: { status: 'paused', currentTrackId: queue[0]?.id ?? null, timestamp: 0, updated_at: Date.now() },
          pausedForEmptyRoom: false
        });
      } else {
        // Atualiza a fila da sala já existente na memória com os dados do Supabase
        const existingRoom = rooms.get(dbRoom.id)!;
        if (queue.length > 0) {
          existingRoom.queue = queue;
          if (!existingRoom.playback.currentTrackId) {
            existingRoom.playback.currentTrackId = queue[0].id;
          }
        }
      }
    }

    console.log(`[Supabase] Filas sincronizadas para ${(dbRooms || []).length} salas.`);
  } catch (e) {
    console.error('[Supabase] Erro inesperado ao carregar rooms:', e);
  }
}

// ── Supabase: Salvar música na biblioteca e na fila ───────────────────────────

export async function saveTrackToSupabase(roomId: string, track: Track) {
  if (!supabase) return;

  try {
    // 1. Upsert na biblioteca global (não duplica se o vídeo já existir)
    const { error: libError } = await supabase.from('tracks_library').upsert({
      youtube_id: track.youtube_video_id,
      titulo: track.titulo,
      duracao_seg: track.duracao_seg || 0,
      thumbnail_url: track.thumbnail_url,
      audio_url: track.audio_url,
      video_url: track.video_url,
    }, { onConflict: 'youtube_id' });
    if (libError) console.error('[Supabase] Erro ao gravar em tracks_library:', libError.message, libError.details);

    // 2. Determina o próximo order_index
    const { data: lastTrack } = await supabase
      .from('room_tracks')
      .select('order_index')
      .eq('room_id', roomId)
      .order('order_index', { ascending: false })
      .limit(1)
      .single();

    const nextIndex = (lastTrack?.order_index ?? -1) + 1;

    // 3. Insere na fila da rádio com o ID do track da memória (para manter consistência)
    const { error: queueError } = await supabase.from('room_tracks').insert({
      id: track.id,
      room_id: roomId,
      youtube_id: track.youtube_video_id,
      adicionado_por: track.adicionado_por,
      order_index: nextIndex,
      status: 'fila',
    });
    if (queueError) console.error('[Supabase] Erro ao gravar em room_tracks:', queueError.message, queueError.details);
  } catch (e) {
    console.error('[Supabase] Erro ao salvar track:', e);
  }
}

export async function updateTrackStatusInSupabase(trackId: string, status: 'fila' | 'historico') {
  if (!supabase) return;
  await supabase.from('room_tracks').update({ status }).eq('id', trackId);
}

export async function updateTrackOrderInSupabase(roomId: string, queue: Track[]) {
  if (!supabase) return;
  const updates = queue.map((t, i) =>
    supabase!.from('room_tracks').update({ order_index: i }).eq('id', t.id).eq('room_id', roomId)
  );
  await Promise.all(updates);
}

export async function removeTrackFromSupabase(trackId: string) {
  if (!supabase) return;
  await supabase.from('room_tracks').delete().eq('id', trackId);
}

// ── Supabase: Favoritos ───────────────────────────────────────────────────────

export async function addFavoriteRoom(userId: string, roomId: string) {
  if (!supabase) return;
  await supabase.from('user_favorite_rooms').upsert({ user_id: userId, room_id: roomId }, { onConflict: 'user_id,room_id' });
}

export async function removeFavoriteRoom(userId: string, roomId: string) {
  if (!supabase) return;
  await supabase.from('user_favorite_rooms').delete().eq('user_id', userId).eq('room_id', roomId);
}

export async function getUserFavorites(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data } = await supabase.from('user_favorite_rooms').select('room_id').eq('user_id', userId);
  return (data || []).map((r: any) => r.room_id);
}

// Push subscriptions: { userId: string, endpoint: string, sub: any, muted_rooms: string[] }
export const pushSubscriptions: Array<{ userId: string; endpoint: string; sub: any; muted_rooms: string[] }> = [];

// Helper functions
export function getOrCreateRoom(roomId: string, roomName: string, radialistaId: string): Room {
  if (!rooms.has(roomId)) {
    const newRoom: Room = {
      id: roomId,
      name: roomName,
      codigo_convite: Math.random().toString(36).substring(2, 8).toUpperCase(),
      radialista_id: radialistaId,
      users: new Map(),
      queue: [],
      history: [],
      chat: [],
      playback: {
        status: 'paused',
        currentTrackId: null,
        timestamp: 0,
        updated_at: Date.now()
      },
      pausedForEmptyRoom: false
    };
    rooms.set(roomId, newRoom);

    if (supabase) {
      supabase.from('rooms').upsert({ id: roomId, name: roomName, codigo_convite: newRoom.codigo_convite })
        .then(res => { if (res.error) console.error('[Supabase] Erro ao salvar room:', res.error.message); });
    }
  }
  return rooms.get(roomId)!;
}

export function syncUserToSupabase(user: { id: string; name: string }) {
  if (supabase) {
    supabase.from('users').upsert({ id: user.id, name: user.name })
      .then(res => { if (res.error) console.error('[Supabase] Erro ao salvar user:', res.error.message); });
  }
}

// Remove um usuario da sala. Se essa saida deixar a sala vazia enquanto a
// musica estava tocando, congela a posicao ao vivo e pausa, marcando que foi
// a propria sala-vazia que pausou (para saber se deve retomar sozinha depois).
export function removeUserFromRoom(room: Room, socketId: string): User | undefined {
  const leaving = room.users.get(socketId);
  room.users.delete(socketId);

  if (room.users.size === 0 && room.playback.status === 'playing') {
    const now = Date.now();
    const livePosition = room.playback.timestamp + (now - room.playback.updated_at) / 1000;
    room.playback = {
      ...room.playback,
      status: 'paused',
      timestamp: livePosition,
      updated_at: now,
    };
    room.pausedForEmptyRoom = true;
  }

  return leaving;
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
