import type { Room } from './types';

const rooms: Room[] = [
  { id: '1', name: 'Rádio Rock', owner_id: 'owner1', codigo_convite: 'ROCK123', criado_em: new Date().toISOString() },
  { id: '2', name: 'Lofi Study', owner_id: 'owner2', codigo_convite: 'LOFI456', criado_em: new Date().toISOString() },
  { id: 'comuna-roots', name: 'Comuna Radio Roots', owner_id: 'seed', codigo_convite: 'ROOTS25', criado_em: new Date().toISOString() },
];

export function listRooms(): Room[] {
  return rooms;
}

export function getRoom(id: string): Room | undefined {
  return rooms.find((r) => r.id === id);
}

export function createRoom(name: string, owner_id: string): Room {
  const newRoom: Room = {
    id: Math.random().toString(36).slice(2, 11),
    name,
    owner_id,
    codigo_convite: Math.random().toString(36).slice(2, 8).toUpperCase(),
    criado_em: new Date().toISOString(),
  };
  rooms.push(newRoom);
  return newRoom;
}

export function joinRoomByCode(code: string): Room | undefined {
  const normalized = code.trim().toLowerCase();
  return rooms.find((r) => r.codigo_convite.toLowerCase() === normalized);
}
