import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  avatar_url: string;
}

interface UserStore {
  user: User | null;
  login: (name: string) => void;
  logout: () => void;
}

export const useUserStore = create<UserStore>((set) => ({
  user: null, // Start logged out
  login: (name: string) => set({ 
    user: { 
      id: Math.random().toString(36).substr(2, 9), 
      name, 
      avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1db954&color=fff`
    } 
  }),
  logout: () => set({ user: null }),
}));
