import { create } from 'zustand'
import { config } from '../config'

interface User {
  id: string
  name: string
  email: string
  role: string
}

interface AuthStore {
  isAuthenticated: boolean
  user: User | null
  login: (user: User) => void
  logout: () => void
  initAuth: () => void
}

const COOKIE_KEY = 'quote_system_auth'

const getCookie = (name: string): string | null => {
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null
  return null
}

const setCookie = (name: string, value: string, hours: number): void => {
  const date = new Date()
  date.setTime(date.getTime() + hours * 60 * 60 * 1000)
  const expires = `expires=${date.toUTCString()}`
  document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Strict`
}

const deleteCookie = (name: string): void => {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
}

export const useAuthStore = create<AuthStore>((set) => ({
  isAuthenticated: false,
  user: null,
  login: (user) => {
    set({ isAuthenticated: true, user })
    const userData = JSON.stringify({
      user,
      timestamp: Date.now(),
    })
    setCookie(COOKIE_KEY, userData, config.auth.cookieExpireHours)
  },
  logout: () => {
    set({ isAuthenticated: false, user: null })
    deleteCookie(COOKIE_KEY)
  },
  initAuth: () => {
    const cookieValue = getCookie(COOKIE_KEY)
    if (cookieValue) {
      try {
        const data = JSON.parse(cookieValue)
        const expireTime = data.timestamp + config.auth.cookieExpireHours * 60 * 60 * 1000
        if (Date.now() < expireTime) {
          set({ isAuthenticated: true, user: data.user })
        } else {
          deleteCookie(COOKIE_KEY)
        }
      } catch {
        deleteCookie(COOKIE_KEY)
      }
    }
  },
}))