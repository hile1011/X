/**
 * 开发环境配置
 *
 * 特点：
 *   - 后端使用 tsx watch 热重载，修改代码自动重启
 *   - 前端使用 Vite 开发服务器，支持 HMR
 *   - 使用 quote_system 数据库
 *   - 端口：后端 3001 / 前端 5173
 *
 * 启动命令：npm run start:dev
 */
export default {
  /** 环境名称 */
  name: 'development',

  /** NODE_ENV 值 */
  nodeEnv: 'development',

  /** 运行模式：development=tsx watch 热重载 / production=编译产物 */
  mode: 'development',

  /** 后端服务配置 */
  backend: {
    port: 3001,
    /** 监听地址，留空绑定所有接口 */
    host: '',
  },

  /** 前端开发服务器配置（仅 dev 模式启动） */
  frontend: {
    port: 5173,
    host: '',
  },

  /** 数据库连接配置（MySQL） */
  database: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    name: 'quote_system',
  },

  /** API 配置 */
  api: {
    basePath: '/api',
  },

  /** 日志配置 */
  logging: {
    level: 'debug',
  },

  /** 路径配置（相对于项目根目录） */
  paths: {
    dataDir: 'data',
    logDir: 'data/logs',
    exportDir: 'exports',
    pidFile: 'data/app-dev.pid',
  },

  /** 健康检查超时（秒） */
  healthCheckTimeout: 15,

  /** 前端 Vite 代理目标（指向后端端口） */
  viteProxyTarget: 'http://localhost:3001',
}
