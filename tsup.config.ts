import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  splitting: false,
  platform: 'node',
  external: ['dotenv'],
  minify: true,
  clean: true,
  outDir: 'dist',
});
