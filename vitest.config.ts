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
      include: [
        'src/constants/**/*.ts',
        'src/templates/**/*.ts',
        'src/utils/**/*.ts',
      ],
      exclude: [
        'src/templates/types.ts', // 纯接口定义文件，无可执行代码
        'src/utils/clipboardCopyEnhancer.ts', // VTable 临时补丁，等官方修复后整体移除
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
})
