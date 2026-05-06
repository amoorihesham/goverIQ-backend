import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});

if (process.env.VITEST === 'true') {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required for integration tests');
    process.exit(1);
  }
}
