import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /<repo>/.
export default defineConfig({
  base: '/programmertron/',
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
