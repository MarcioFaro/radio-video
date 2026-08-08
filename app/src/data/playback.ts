import type { PlaybackState } from './types';

const playbackByRoom = new Map<string, PlaybackState>();

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
}
