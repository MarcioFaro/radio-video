import { socket } from '../services/socket';
import type { User, Track, ChatMessage, PlaybackState } from './types';
import * as queueData from './queue';
import * as chatData from './chat';
import * as presenceData from './presence';
import * as playbackData from './playback';

interface ServerUser extends User { socket_id?: string; entrou_em?: number }

interface ServerRoomState {
  id: string;
  name: string;
  codigo_convite: string;
  radialista_id: string | null;
  queue: Track[];
  chat: ChatMessage[];
  playback: PlaybackState;
  users: ServerUser[];
}

interface RoomMeta {
  name: string | null;
  codigo_convite: string | null;
}

const metaByRoom = new Map<string, RoomMeta>();
const listenersByRoom = new Map<string, Set<() => void>>();

let currentRoomId: string | null = null;
let wired = false;

function notifyRoom(roomId: string): void {
  const set = listenersByRoom.get(roomId);
  if (set) set.forEach((cb) => cb());
}

function applyServerState(roomId: string, state: ServerRoomState): void {
  metaByRoom.set(roomId, { name: state.name, codigo_convite: state.codigo_convite });
  queueData.applyQueue(roomId, state.queue);
  chatData.applyMessages(roomId, state.chat);
  presenceData.applyPresence(roomId, state.users, state.radialista_id);
  playbackData.applyPlayback(roomId, state.playback);
  notifyRoom(roomId);
}

function wireSocket(): void {
  if (wired) return;
  wired = true;

  socket.on('sync_state', (data: { room: ServerRoomState }) => {
    if (data.room.id === currentRoomId) {
      applyServerState(data.room.id, data.room);
    }
  });

  socket.on('queue_updated', (queue: Track[]) => {
    if (!currentRoomId) return;
    queueData.applyQueue(currentRoomId, queue);
    notifyRoom(currentRoomId);
  });

  socket.on('chat_message', (msg: ChatMessage) => {
    if (!currentRoomId) return;
    chatData.appendMessage(currentRoomId, msg);
    notifyRoom(currentRoomId);
  });

  socket.on('playback_updated', (playback: PlaybackState) => {
    if (!currentRoomId) return;
    playbackData.applyPlayback(currentRoomId, playback);
    notifyRoom(currentRoomId);
  });

  socket.on('radialista_changed', (radialistaId: string | null) => {
    if (!currentRoomId) return;
    presenceData.setRadialista(currentRoomId, radialistaId);
    notifyRoom(currentRoomId);
  });

  socket.on('user_joined', (user: ServerUser) => {
    if (!currentRoomId) return;
    presenceData.appendUser(currentRoomId, user);
    notifyRoom(currentRoomId);
  });

  socket.on('user_left', (data: { socket_id: string; users: ServerUser[] }) => {
    if (!currentRoomId) return;
    presenceData.applyPresence(currentRoomId, data.users, presenceData.getRadialista(currentRoomId));
    notifyRoom(currentRoomId);
  });
}

export function ensureConnected(timeoutMs = 1500): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    if (socket.active === false) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(socket.connected), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.once('connect_error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export function isConnected(): boolean {
  return socket.connected;
}

export function subscribeStatus(cb: () => void): () => void {
  socket.on('connect', cb);
  socket.on('disconnect', cb);
  return () => {
    socket.off('connect', cb);
    socket.off('disconnect', cb);
  };
}

export function subscribeRoom(roomId: string, cb: () => void): () => void {
  wireSocket();
  const unsubs = [
    queueData.subscribeQueue(roomId, cb),
    chatData.subscribeChat(roomId, cb),
    presenceData.subscribePresence(roomId, cb),
    playbackData.subscribePlayback(roomId, cb),
  ];
  let set = listenersByRoom.get(roomId);
  if (!set) {
    set = new Set();
    listenersByRoom.set(roomId, set);
  }
  set.add(cb);
  return () => {
    unsubs.forEach((u) => u());
    if (set) set.delete(cb);
    if (set && set.size === 0) listenersByRoom.delete(roomId);
  };
}

export function getRoomMeta(roomId: string): RoomMeta {
  return metaByRoom.get(roomId) ?? { name: null, codigo_convite: null };
}

export function joinRoom(roomId: string, roomName: string, user: User): void {
  wireSocket();
  currentRoomId = roomId;
  socket.emit('join_room', { roomId, roomName, user });
}

export function leaveRoom(roomId: string): void {
  currentRoomId = null;
  socket.emit('leave_room', { roomId });
}

export function addTrack(roomId: string, track: Omit<Track, 'id'>): void {
  socket.emit('add_track', { roomId, track });
}

export function sendMessage(roomId: string, userName: string, text: string): void {
  socket.emit('send_message', { roomId, userName, text });
}

export function setPlayback(roomId: string, status: PlaybackState['status'], currentTrackId: string, timestamp: number): void {
  socket.emit('update_playback', { roomId, status, currentTrackId, timestamp });
  playbackData.applyPlayback(roomId, { status, currentTrackId, timestamp });
}

export function forceRadialista(roomId: string): void {
  socket.emit('force_radialista', { roomId });
}
