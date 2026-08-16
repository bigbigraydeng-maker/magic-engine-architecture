import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // JSX 用跟 Next 生产构建同一套（automatic runtime）—— 否则组件文件必须
  // 多写一行 `import React`，那是为了迁就测试而改生产代码，本末倒置。
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.claude/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
