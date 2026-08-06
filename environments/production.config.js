/**
 * 生产环境配置（本机冒烟测试）
 *
 * 特点：
 *   - 使用编译后的构建产物运行（需先执行 npm run build）
 *   - 使用独立的 quote_system_prod 数据库
 *   - 端口：后端 3003（避免与 dev 3001 / test 3002 冲突）
 *
 * 注意：真正的生产部署位于独立目录 X-PR（端口 3002），
 *       由 scripts/deploy.js 管理。此配置用于在本项目目录内
 *       运行编译产物进行本地冒烟验证。
 *
 * 启动命令：npm run start:prod
 */
export default {
  /** 环境名称 */
  name: 'production',

  /** NODE_ENV 值 */
  nodeEnv: 'production',

  /** 运行模式：使用编译产物 */
  mode: 'production',

  /** 后端服务配置 */
  backend: {
    port: 3003,
    /** 生产环境绑定所有接口，支持外部访问 */
    host: '',
  },

  /** 前端配置（生产环境由后端托管静态文件，不单独启动 dev server） */
  frontend: {
    port: 80,
    host: '',
  },

  /** 数据库连接配置（MySQL） */
  database: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    name: 'quote_system_prod',
  },

  /** API 配置 */
  api: {
    basePath: '/api',
  },

  /** 日志配置 */
  logging: {
    level: 'warn',
  },

  /** 路径配置（相对于项目根目录） */
  paths: {
    dataDir: 'data',
    logDir: 'data/logs',
    exportDir: 'exports',
    pidFile: 'data/app-prod.pid',
  },

  /** 健康检查超时（秒） */
  healthCheckTimeout: 30,
}
