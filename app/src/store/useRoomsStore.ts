import { create } from 'zustand';
import type { Room } from '../data/types';
import { listRooms, createRoom, joinRoomByCode } from '../data/rooms';

interface RoomsStore {
  rooms: Room[];
  createRoom: (name: string, owner_id: string) => Room;
  joinRoom: (code: string) => Room | undefined;
}

export const useRoomsStore = create<RoomsStore>((set) => ({
  rooms: [...listRooms()],
  createRoom: (name, owner_id) => {
    const room = createRoom(name, owner_id);
    set({ rooms: [...listRooms()] });
    return room;
  },
  joinRoom: (code) => joinRoomByCode(code),
}));
