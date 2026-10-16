import { defineConfig } from '../hello-world/node_modules/vitest/dist/config.js';

export default defineConfig({
  test: {
    include: ['tools/agnostic-loop/*.test.ts'],
    exclude: ['tools/agnostic-loop/supervisor*.test.ts', 'tools/agnostic-loop/dispatch-entry.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 30000,
  },
});
