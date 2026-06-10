import { create } from 'zustand';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  theme: 'dark' | 'light';
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  toggleTheme: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  isAuthenticated: !!localStorage.getItem('accessToken'),
  isAdmin: false,
  theme: (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',

  setAuth: (user, token) => {
    localStorage.setItem('accessToken', token);
    set({
      user,
      accessToken: token,
      isAuthenticated: true,
      isAdmin: ['Admin', 'Super Admin'].includes(user.role),
    });
  },

  logout: () => {
    localStorage.removeItem('accessToken');
    set({ user: null, accessToken: null, isAuthenticated: false, isAdmin: false });
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    set({ theme: next });
  },
}));
