import { defineConfig } from 'vitest/config';

const project = (name, include, extra = {}) => ({ test: { name, include, ...extra } });

export default defineConfig({
  test: {
    projects: [
      project('core-unit', ['packages/core/test/unit/**/*.test.ts']),
      project('core-property', ['packages/core/test/property/**/*.test.ts']),
      project('core-golden', ['packages/core/test/golden/**/*.test.ts']),
      project('core-saves', ['packages/core/test/saves/**/*.test.ts']),
      project('game-unit', ['apps/game/test/**/*.test.ts']),
      // Room tests share one test server port, so their files run one at a time.
      project('server', ['apps/server/test/**/*.test.ts'], { fileParallelism: false, testTimeout: 20_000, hookTimeout: 20_000 }),
    ],
  },
});
