import type { Track } from './types';
import { subscribe, notify } from './pubsub';

const historyByRoom = new Map<string, Track[]>();

const subKey = (roomId: string) => `history:${roomId}`;

export function applyHistory(roomId: string, tracks: Track[]): void {
  historyByRoom.set(roomId, [...tracks]);
  notify(subKey(roomId));
}

export function subscribeHistory(roomId: string, cb: () => void): () => void {
  return subscribe(subKey(roomId), cb);
}

export function getHistory(roomId: string): Track[] {
  if (!historyByRoom.has(roomId)) {
    historyByRoom.set(roomId, []);
  }
  return historyByRoom.get(roomId)!;
}
