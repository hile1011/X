import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 自定义插件：移除生产构建 HTML 中 script/link 标签的 crossorigin 属性
// 部分浏览器遇到 crossorigin 时会尝试 HTTPS 加载资源，导致 HTTP 站点白屏
function removeCrossoriginPlugin(): Plugin {
  return {
    name: 'remove-crossorigin',
    apply: 'build',
    transformIndexHtml(html) {
      return html
        .replace(/<script([^>]*?) crossorigin([^>]*)>/g, '<script$1$2>')
        .replace(/<link([^>]*?) crossorigin([^>]*)>/g, '<link$1$2>')
    },
  }
}

export default defineConfig({
  plugins: [react(), removeCrossoriginPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@api': path.resolve(__dirname, './api'),
    },
  },
  server: {
    // 监听所有接口，支持通过 IP+端口访问开发服务器（局域网调试）
    host: true,
    port: 5173,
    // HMR 配置：允许局域网设备连接 WebSocket（手机调试需要）
    hmr: {
      host: '0.0.0.0',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
