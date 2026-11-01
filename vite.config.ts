import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 5183, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
});
