import { create } from 'zustand'

interface AuthStore {
  isAuthenticated: boolean
  user: { id: string; name: string; email: string; role: string } | null
  login: (user: { id: string; name: string; email: string; role: string }) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  isAuthenticated: false,
  user: null,
  login: (user) => set({ isAuthenticated: true, user }),
  logout: () => set({ isAuthenticated: false, user: null }),
}))
