/**
 * 测试环境配置
 *
 * 特点：
 *   - 使用编译后的构建产物运行（需先执行 npm run build）
 *   - 使用独立的 quote_system_test 数据库，与开发环境隔离
 *   - 端口：后端 3002 / 前端 5174
 *   - 适用于集成测试、系统测试和本地冒烟验证
 *
 * 启动命令：npm run start:test
 */
export default {
  /** 环境名称 */
  name: 'test',

  /** NODE_ENV 值 */
  nodeEnv: 'test',

  /** 运行模式：使用编译产物 */
  mode: 'production',

  /** 后端服务配置 */
  backend: {
    port: 3002,
    host: '',
  },

  /** 前端开发服务器配置（test 模式不启动前端 dev server） */
  frontend: {
    port: 5174,
    host: '',
  },

  /** 数据库连接配置（MySQL） */
  database: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    name: 'quote_system_test',
  },

  /** API 配置 */
  api: {
    basePath: '/api',
  },

  /** 日志配置 */
  logging: {
    level: 'info',
  },

  /** 路径配置（相对于项目根目录） */
  paths: {
    dataDir: 'data',
    logDir: 'data/logs',
    exportDir: 'exports',
    pidFile: 'data/app-test.pid',
  },

  /** 健康检查超时（秒） */
  healthCheckTimeout: 15,
}
