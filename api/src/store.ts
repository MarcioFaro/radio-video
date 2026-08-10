import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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
  const { error } = await supabase.from('user_favorite_rooms').upsert({ user_id: userId, room_id: roomId }, { onConflict: 'user_id,room_id' });
  if (error) console.error('[Supabase] Erro ao favoritar sala:', error.message, error.details);
}

export async function removeFavoriteRoom(userId: string, roomId: string) {
  if (!supabase) return;
  const { error } = await supabase.from('user_favorite_rooms').delete().eq('user_id', userId).eq('room_id', roomId);
  if (error) console.error('[Supabase] Erro ao desfavoritar sala:', error.message, error.details);
}

export async function getUserFavorites(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('user_favorite_rooms').select('room_id').eq('user_id', userId);
  if (error) console.error('[Supabase] Erro ao buscar favoritos:', error.message, error.details);
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

const CHAT_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

// Remove do chat da sala mensagens com mais de 24h. Retorna true se alguma
// mensagem foi removida (para o chamador decidir se precisa avisar clientes
// ja conectados).
export function pruneOldChatMessages(room: Room): boolean {
  const cutoff = Date.now() - CHAT_MESSAGE_TTL_MS;
  const before = room.chat.length;
  room.chat = room.chat.filter((msg) => msg.timestamp >= cutoff);
  return room.chat.length !== before;
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

// ── Helpers de administração ────────────────────────────────────────────────

// Exclui uma sala por completo: remove do estado em memória e do Supabase
// (favoritos, fila e a sala em si). Retorna true se a sala existia.
export async function deleteRoomCompletely(roomId: string): Promise<boolean> {
  const existed = rooms.delete(roomId);
  scheduleSave();
  if (supabase) {
    const d1 = await supabase.from('user_favorite_rooms').delete().eq('room_id', roomId);
    if (d1.error) console.error('[Supabase] Erro ao excluir favoritos da room:', d1.error.message);
    const d2 = await supabase.from('room_tracks').delete().eq('room_id', roomId);
    if (d2.error) console.error('[Supabase] Erro ao excluir fila da room:', d2.error.message);
    const d3 = await supabase.from('rooms').delete().eq('id', roomId);
    if (d3.error) console.error('[Supabase] Erro ao excluir room:', d3.error.message);
  }
  return existed;
}

export async function updateRoomInSupabase(roomId: string, patch: { name?: string; codigo_convite?: string }) {
  const data: Record<string, string> = {};
  if (patch.name) data.name = patch.name;
  if (patch.codigo_convite) data.codigo_convite = patch.codigo_convite;
  if (Object.keys(data).length === 0) return;

  if (supabase) {
    const { error } = await supabase.from('rooms').update(data).eq('id', roomId);
    if (error) console.error('[Supabase] Erro ao editar room:', error.message);
  }
  const room = rooms.get(roomId);
  if (room) {
    if (patch.name) room.name = patch.name;
    if (patch.codigo_convite) room.codigo_convite = patch.codigo_convite;
    scheduleSave();
  }
}

// Exclui um usuário: remove do Supabase (user, favoritos, push subs) e de todas
// as salas ativas em memória.
export async function deleteUserCompletely(userId: string): Promise<boolean> {
  if (supabase) {
    const u = await supabase.from('users').delete().eq('id', userId);
    if (u.error) console.error('[Supabase] Erro ao excluir user:', u.error.message);
    const f = await supabase.from('user_favorite_rooms').delete().eq('user_id', userId);
    if (f.error) console.error('[Supabase] Erro ao excluir favoritos do user:', f.error.message);
    const p = await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    if (p.error) console.error('[Supabase] Erro ao excluir push subs do user:', p.error.message);
  }
  let removed = false;
  for (const room of rooms.values()) {
    for (const [socketId, u] of room.users) {
      if (u.id === userId) {
        room.users.delete(socketId);
        removed = true;
      }
    }
  }
  return removed || !!supabase;
}

// Exclui uma faixa da biblioteca e todas as referências em filas (Supabase +
// memória). Retorna true se a faixa existia na biblioteca.
export async function deleteLibraryTrackByYoutubeId(youtubeId: string): Promise<boolean> {
  let existed = false;
  if (supabase) {
    const lib = await supabase.from('tracks_library').select('youtube_id').eq('youtube_id', youtubeId).maybeSingle();
    existed = !!lib.data;
    const rt = await supabase.from('room_tracks').delete().eq('youtube_id', youtubeId);
    if (rt.error) console.error('[Supabase] Erro ao excluir room_tracks da faixa:', rt.error.message);
    const t = await supabase.from('tracks_library').delete().eq('youtube_id', youtubeId);
    if (t.error) console.error('[Supabase] Erro ao excluir faixa da biblioteca:', t.error.message);
  }
  for (const room of rooms.values()) {
    room.queue = room.queue.filter((tr) => tr.youtube_video_id !== youtubeId);
    room.history = room.history.filter((tr) => tr.youtube_video_id !== youtubeId);
  }
  scheduleSave();
  return existed;
}

export async function updateLibraryTrack(youtubeId: string, patch: { titulo?: string; duracao_seg?: number }) {
  const data: Record<string, unknown> = {};
  if (patch.titulo) data.titulo = patch.titulo;
  if (typeof patch.duracao_seg === 'number') data.duracao_seg = patch.duracao_seg;
  if (Object.keys(data).length === 0) return;

  if (supabase) {
    const { error } = await supabase.from('tracks_library').update(data).eq('youtube_id', youtubeId);
    if (error) console.error('[Supabase] Erro ao editar faixa:', error.message);
  }
  for (const room of rooms.values()) {
    for (const tr of [...room.queue, ...room.history]) {
      if (tr.youtube_video_id === youtubeId) {
        if (patch.titulo) tr.titulo = patch.titulo;
        if (typeof patch.duracao_seg === 'number') tr.duracao_seg = patch.duracao_seg;
      }
    }
  }
  scheduleSave();
}

// Adiciona uma música da biblioteca à fila de uma sala (via admin). Garante que
// a sala exista em memória para propagar o evento em tempo real. Retorna a faixa
// criada, ou null se a biblioteca/sala não existir.
export async function addTrackToRoomQueue(roomId: string, youtubeId: string, adicionadoPor: string): Promise<Track | null> {
  if (!supabase) return null;

  const { data: lib, error: libErr } = await supabase
    .from('tracks_library')
    .select('*')
    .eq('youtube_id', youtubeId)
    .maybeSingle();
  if (libErr || !lib) return null;

  let room = rooms.get(roomId);
  if (!room) {
    const { data: dbRoom } = await supabase.from('rooms').select('*').eq('id', roomId).maybeSingle();
    if (!dbRoom) return null;
    room = getOrCreateRoom(roomId, dbRoom.name, 'admin');
  }

  const track: Track = {
    id: Math.random().toString(36).substring(2, 9),
    youtube_video_id: youtubeId,
    titulo: lib.titulo,
    thumbnail_url: lib.thumbnail_url || '',
    duracao_seg: lib.duracao_seg || 0,
    audio_url: lib.audio_url,
    video_url: lib.video_url,
    adicionado_por: adicionadoPor,
  };
  room.queue.push(track);
  if (!room.playback.currentTrackId) {
    room.playback.currentTrackId = track.id;
    room.playback.timestamp = 0;
    room.playback.updated_at = Date.now();
  }
  await saveTrackToSupabase(roomId, track);
  scheduleSave();
  return track;
}

// Remove uma música da fila de uma sala (via admin). Retorna true se existia.
export async function removeTrackFromRoomQueue(roomId: string, trackId: string): Promise<boolean> {
  const room = rooms.get(roomId);
  const index = room ? room.queue.findIndex((t) => t.id === trackId) : -1;

  if (index >= 0 && room) {
    room.queue.splice(index, 1);
    if (room.playback.currentTrackId === trackId) {
      const next = room.queue[index];
      room.playback = next
        ? { status: 'playing', currentTrackId: next.id, timestamp: 0, updated_at: Date.now() }
        : { status: 'paused', currentTrackId: null, timestamp: 0, updated_at: Date.now() };
    }
    scheduleSave();
  }

  await removeTrackFromSupabase(trackId);
  return index >= 0;
}

// Serializa o estado atual das salas (mesmo formato do scheduleSave) para o
// download de backup.
export function serializeRoomsForBackup(): string {
  const data: Record<string, any> = {};
  for (const [id, room] of rooms.entries()) {
    const roomCopy = { ...room };
    delete (roomCopy as any).users;
    data[id] = roomCopy;
  }
  return JSON.stringify(data, null, 2);
}
