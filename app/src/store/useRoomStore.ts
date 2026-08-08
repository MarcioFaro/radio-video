import { create } from 'zustand';
import type { User, Track, ChatMessage, PlaybackState } from '../data/types';
import { getRoom } from '../data/rooms';
import * as queueData from '../data/queue';
import * as playbackData from '../data/playback';
import * as presenceData from '../data/presence';
import * as chatData from '../data/chat';

interface RoomState {
  roomId: string | null;
  roomName: string | null;
  radialista_id: string | null;
  codigo_convite: string | null;

  queue: Track[];
  chat: ChatMessage[];
  presence: User[];
  playback: PlaybackState;

  userId: string | null;

  joinRoom: (roomId: string, roomName: string, user: User) => void;
  leaveRoom: () => void;
  addTrack: (track: Omit<Track, 'id'>) => void;
  sendMessage: (userName: string, text: string) => void;
  setPlaybackStatus: (status: PlaybackState['status'], currentTrackId: string, timestamp: number) => void;
  simulateRadialistaChange: () => void;
}

const readRoom = (roomId: string) => ({
  queue: [...queueData.getQueue(roomId)],
  chat: [...chatData.getMessages(roomId)],
  presence: [...presenceData.getPresence(roomId)],
  playback: { ...playbackData.getPlayback(roomId) },
  radialista_id: presenceData.getRadialista(roomId),
});

export const useRoomStore = create<RoomState>((set, get) => ({
  roomId: null,
  roomName: null,
  radialista_id: null,
  codigo_convite: null,
  queue: [],
  chat: [],
  presence: [],
  playback: { status: 'paused', currentTrackId: null, timestamp: 0 },
  userId: null,

  joinRoom: (roomId, roomName, user) => {
    presenceData.join(roomId, user);
    set({
      roomId,
      roomName,
      codigo_convite: getRoom(roomId)?.codigo_convite ?? null,
      userId: user.id,
      ...readRoom(roomId),
    });
  },

  leaveRoom: () => {
    const { roomId, userId } = get();
    if (roomId && userId) presenceData.leave(roomId, userId);
    set({ roomId: null, roomName: null, radialista_id: null, codigo_convite: null, queue: [], chat: [], presence: [], userId: null });
  },

  addTrack: (track) => {
    const { roomId } = get();
    if (!roomId) return;
    const newTrack = queueData.addTrack(roomId, track);
    const playback = playbackData.getPlayback(roomId);
    if (!playback.currentTrackId) {
      playbackData.setPlayback(roomId, 'paused', newTrack.id, 0);
    }
    set(readRoom(roomId));
  },

  sendMessage: (userName, text) => {
    const { roomId } = get();
    if (!roomId) return;
    chatData.sendMessage(roomId, userName, text);
    set({ chat: [...chatData.getMessages(roomId)] });
  },

  setPlaybackStatus: (status, currentTrackId, timestamp) => {
    const { roomId } = get();
    if (!roomId) return;
    playbackData.setPlayback(roomId, status, currentTrackId, timestamp);
    set({ playback: { ...playbackData.getPlayback(roomId) } });
  },

  simulateRadialistaChange: () => {
    const { roomId } = get();
    if (!roomId) return;
    presenceData.simulateRadialistaChange(roomId);
    set({ radialista_id: presenceData.getRadialista(roomId) });
  },
}));
