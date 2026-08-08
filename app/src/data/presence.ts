import type { User } from './types';
import { subscribe, notify } from './pubsub';

const presenceByRoom = new Map<string, User[]>();
const radialistaByRoom = new Map<string, string | null>();

const subKey = (roomId: string) => `presence:${roomId}`;

function getPresenceRaw(roomId: string): User[] {
  if (!presenceByRoom.has(roomId)) {
    presenceByRoom.set(roomId, []);
  }
  return presenceByRoom.get(roomId)!;
}

export function applyPresence(roomId: string, users: User[], radialistaId: string | null): void {
  presenceByRoom.set(roomId, [...users]);
  radialistaByRoom.set(roomId, radialistaId);
  notify(subKey(roomId));
}

export function setRadialista(roomId: string, radialistaId: string | null): void {
  radialistaByRoom.set(roomId, radialistaId);
  notify(subKey(roomId));
}

export function appendUser(roomId: string, user: User): void {
  const users = getPresenceRaw(roomId);
  if (!users.some((u) => u.id === user.id)) {
    users.push(user);
    presenceByRoom.set(roomId, [...users]);
    notify(subKey(roomId));
  }
}

export function subscribePresence(roomId: string, cb: () => void): () => void {
  return subscribe(subKey(roomId), cb);
}

export function getPresence(roomId: string): User[] {
  return getPresenceRaw(roomId);
}

export function getRadialista(roomId: string): string | null {
  return radialistaByRoom.get(roomId) ?? null;
}

export function join(roomId: string, user: User): void {
  const users = getPresenceRaw(roomId);
  if (users.length === 0) {
    users.push(
      { id: 'mock-marcos', name: 'Marcos' },
      { id: 'mock-pri', name: 'Pri' }
    );
  }
  if (!users.some((u) => u.id === user.id)) {
    users.push(user);
    presenceByRoom.set(roomId, [...users]);
  }
  if (getRadialista(roomId) === null) {
    radialistaByRoom.set(roomId, user.id);
  }
  notify(subKey(roomId));
}

export function leave(roomId: string, userId: string): void {
  const users = getPresenceRaw(roomId).filter((u) => u.id !== userId);
  presenceByRoom.set(roomId, users);
  if (getRadialista(roomId) === userId) {
    radialistaByRoom.set(roomId, users[0]?.id ?? null);
  }
  notify(subKey(roomId));
}

export function simulateRadialistaChange(roomId: string): string | null {
  const users = getPresenceRaw(roomId);
  if (users.length === 0) return null;
  const current = getRadialista(roomId);
  const index = users.findIndex((u) => u.id === current);
  const next = users[(index + 1) % users.length];
  radialistaByRoom.set(roomId, next.id);
  notify(subKey(roomId));
  return next.id;
}
