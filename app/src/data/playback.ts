import type { PlaybackState } from './types';
import { subscribe, notify } from './pubsub';

const playbackByRoom = new Map<string, PlaybackState>();

const subKey = (roomId: string) => `playback:${roomId}`;

export function applyPlayback(roomId: string, state: PlaybackState): void {
  playbackByRoom.set(roomId, { ...state });
  notify(subKey(roomId));
}

export function subscribePlayback(roomId: string, cb: () => void): () => void {
  return subscribe(subKey(roomId), cb);
}

export function getPlayback(roomId: string): PlaybackState {
  if (!playbackByRoom.has(roomId)) {
    playbackByRoom.set(roomId, { status: 'paused', currentTrackId: null, timestamp: 0 });
  }
  return playbackByRoom.get(roomId)!;
}

export function setPlayback(
  roomId: string,
  status: PlaybackState['status'],
  currentTrackId: string | null,
  timestamp: number
): void {
  playbackByRoom.set(roomId, { status, currentTrackId, timestamp });
  notify(subKey(roomId));
}
