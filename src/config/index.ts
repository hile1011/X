export const config = {
  auth: {
    cookieExpireHours: Number(import.meta.env.VITE_AUTH_COOKIE_EXPIRE_HOURS) || 5,
  },
}