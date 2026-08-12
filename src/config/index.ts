export const config = {
  auth: {
    /** 无操作自动登出时间（毫秒），默认 10 分钟 */
    idleTimeoutMs: 10 * 60 * 1000,
    /** token 过期前警告时间（毫秒），默认 30 秒 */
    warningBeforeMs: 30 * 1000,
    /** 用户活动时自动刷新 token 的阈值（毫秒），剩余时间低于此值时触发续期 */
    autoRefreshThresholdMs: 5 * 60 * 1000,
    /** localStorage 存储键名 */
    storageKey: 'quote_system_auth_token',
    /** XOR 加密密钥（客户端混淆用，非真正的安全加密） */
    encryptionKey: 'qs_2024_auth_secret_key_x9f2',
    /** 旧版 cookie 键名（用于清理旧数据） */
    legacyCookieKey: 'quote_system_auth',
  },
}
