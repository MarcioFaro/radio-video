import { create } from 'zustand';
import type { User, Track, ChatMessage, PlaybackState } from '../data/types';
import { getRoom } from '../data/rooms';
import * as queueData from '../data/queue';
import * as playbackData from '../data/playback';
import * as presenceData from '../data/presence';
import * as chatData from '../data/chat';
import * as realtime from '../data/realtime';
import * as historyData from '../data/history';

interface RoomState {
  roomId: string | null;
  roomName: string | null;
  radialista_id: string | null;
  codigo_convite: string | null;

  queue: Track[];
  history: Track[];
  chat: ChatMessage[];
  presence: User[];
  playback: PlaybackState;

  connected: boolean;

  userId: string | null;

  joinRoom: (roomId: string, roomName: string, user: User) => void;
  leaveRoom: () => void;
  addTrack: (track: Omit<Track, 'id'>) => void;
  sendMessage: (userName: string, text: string) => void;
  setPlaybackStatus: (status: PlaybackState['status'], currentTrackId: string, timestamp: number) => void;
  moveTrack: (trackId: string, direction: -1 | 1) => void;
  removeTrack: (trackId: string) => void;
  seekTo: (timestamp: number) => void;
  simulateRadialistaChange: () => void;
}

let unsubscribeRoom: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

const readRoom = (roomId: string) => {
  const meta = realtime.getRoomMeta(roomId);
  return {
    queue: [...queueData.getQueue(roomId)],
    history: [...historyData.getHistory(roomId)],
    chat: [...chatData.getMessages(roomId)],
    presence: [...presenceData.getPresence(roomId)],
    playback: { ...playbackData.getPlayback(roomId) },
    radialista_id: presenceData.getRadialista(roomId),
    ...(meta.name ? { roomName: meta.name } : {}),
    ...(meta.codigo_convite ? { codigo_convite: meta.codigo_convite } : {}),
  };
};

export const useRoomStore = create<RoomState>((set, get) => ({
  roomId: null,
  roomName: null,
  radialista_id: null,
  codigo_convite: null,
  queue: [],
  history: [],
  chat: [],
  presence: [],
  playback: { status: 'paused', currentTrackId: null, timestamp: 0 },
  connected: false,
  userId: null,

  joinRoom: (roomId, roomName, user) => {
    if (!unsubscribeStatus) {
      unsubscribeStatus = realtime.subscribeStatus(() => {
        set({ connected: realtime.isConnected() });
      });
    }

    void realtime.ensureConnected().then((online) => {
      if (online) {
        unsubscribeRoom?.();
        unsubscribeRoom = realtime.subscribeRoom(roomId, () => set(readRoom(roomId)));
        realtime.joinRoom(roomId, roomName, user);
        set({
          roomId,
          roomName,
          codigo_convite: null,
          userId: user.id,
          connected: true,
          ...readRoom(roomId),
        });
      } else {
        presenceData.join(roomId, user);
        set({
          roomId,
          roomName,
          codigo_convite: getRoom(roomId)?.codigo_convite ?? null,
          userId: user.id,
          connected: false,
          ...readRoom(roomId),
        });
      }
    });
  },

  leaveRoom: () => {
    const { roomId } = get();
    unsubscribeRoom?.();
    unsubscribeRoom = null;
    if (roomId) realtime.leaveRoom(roomId);
    set({ roomId: null, roomName: null, radialista_id: null, codigo_convite: null, queue: [], history: [], chat: [], presence: [], userId: null });
  },

  addTrack: (track) => {
    const { roomId, connected } = get();
    if (!roomId) return;
    if (connected) {
      realtime.addTrack(roomId, track);
      return;
    }
    const newTrack = queueData.addTrack(roomId, track);
    const playback = playbackData.getPlayback(roomId);
    if (!playback.currentTrackId) {
      playbackData.setPlayback(roomId, 'paused', newTrack.id, 0);
    }
    set(readRoom(roomId));
  },

  sendMessage: (userName, text) => {
    const { roomId, connected } = get();
    if (!roomId) return;
    if (connected) {
      realtime.sendMessage(roomId, userName, text);
      return;
    }
    chatData.sendMessage(roomId, userName, text);
    set({ chat: [...chatData.getMessages(roomId)] });
  },

  setPlaybackStatus: (status, currentTrackId, timestamp) => {
    const { roomId, connected } = get();
    if (!roomId) return;
    if (connected) {
      realtime.setPlayback(roomId, status, currentTrackId, timestamp);
      return;
    }
    playbackData.setPlayback(roomId, status, currentTrackId, timestamp);
    set({ playback: { ...playbackData.getPlayback(roomId) } });
  },

  moveTrack: (trackId, direction) => {
    const { roomId, connected } = get();
    if (!roomId) return;
    const queue = queueData.getQueue(roomId);
    const from = queue.findIndex((t) => t.id === trackId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= queue.length) return;
    const orderedIds = queue.map((t) => t.id);
    const [id] = orderedIds.splice(from, 1);
    orderedIds.splice(to, 0, id);
    if (connected) {
      realtime.reorderQueue(roomId, orderedIds);
      return;
    }
    queueData.moveTrack(roomId, trackId, direction);
    set(readRoom(roomId));
  },

  removeTrack: (trackId) => {
    const { roomId, connected } = get();
    if (!roomId) return;
    if (connected) {
      realtime.removeTrack(roomId, trackId);
      return;
    }
    // Mock local
    const queue = queueData.getQueue(roomId);
    const index = queue.findIndex(t => t.id === trackId);
    if (index >= 0) {
      queue.splice(index, 1);
      queueData.applyQueue(roomId, queue);
      set(readRoom(roomId));
    }
  },

  seekTo: (timestamp) => {
    const { roomId, connected } = get();
    if (!roomId) return;
    if (connected) {
      realtime.seekPlayback(roomId, timestamp);
      return;
    }
    playbackData.setPlaybackTime(roomId, timestamp);
    set({ playback: { ...playbackData.getPlayback(roomId) } });
  },

  simulateRadialistaChange: () => {
    const { roomId, connected } = get();
    if (!roomId) return;
    if (connected) {
      realtime.forceRadialista(roomId);
      return;
    }
    presenceData.simulateRadialistaChange(roomId);
    set({ radialista_id: presenceData.getRadialista(roomId) });
  },
}));
