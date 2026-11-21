import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Lojas fictícias (s1/s2/s3.example) para os testes dos adapters.
    setupFiles: ['apps/server/src/test-setup.ts'],
  },
});
