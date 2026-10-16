import { defineConfig } from '../hello-world/node_modules/vitest/dist/config.js';

// Offline diagnostics for a default-disabled feature, including known repair
// obligations. A red result must be reported; do not qualify live dispatch from it.
export default defineConfig({
  test: {
    include: ['tools/agnostic-loop/supervisor*.test.ts', 'tools/agnostic-loop/dispatch-entry.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 30000,
  },
});
