/**
 * Vitest globalSetup — 在所有测试开始前运行一次，所有测试结束后运行 teardown。
 *
 * 注意：globalSetup 运行在独立的 Node 进程中，不能用于设置测试环境变量（由 setup.ts 负责）。
 * 此处仅用于确保所有测试结束后关闭 MySQL 连接池，防止进程挂起。
 */

export default function globalSetup() {
  // teardown: 所有测试文件结束后运行一次
  return async () => {
    const { closePool } = await import('../api/dbClient.js')
    await closePool()
  }
}
