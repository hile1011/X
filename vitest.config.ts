import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    // 测试共享 MySQL 数据库（quote_system_test），必须串行执行避免并发冲突
    // vitest 4: singleFork 是顶级选项，不再放在 poolOptions 内
    pool: 'forks',
    singleFork: true,
    fileParallelism: false,
    globalSetup: ['tests/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // 统计口径：单元可测的核心业务逻辑（前端 constants/services/store/templates/utils、
      // API 客户端、后端 services 业务逻辑层）。
      // UI 页面/组件由组件级测试覆盖，api/routes 为路由胶水层由集成测试覆盖，均不纳入单元覆盖率口径。
      include: [
        'src/api/**/*.ts',
        'src/constants/**/*.ts',
        'src/services/**/*.ts',
        'src/store/**/*.ts',
        'src/templates/**/*.ts',
        'src/utils/**/*.ts',
        'api/services/**/*.ts',
      ],
      exclude: [
        'src/templates/types.ts', // 纯接口定义文件，无可执行代码
        'src/utils/clipboardCopyEnhancer.ts', // VTable 临时补丁，等官方修复后整体移除
        'api/services/mockData.ts', // 演示/种子数据，无业务逻辑
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
})
