import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/worker.ts', 'src/tracing.ts'],
  format: ['esm'],
  splitting: false,
  platform: 'node',
  external: ['dotenv'],
  minify: true,
  clean: true,
  outDir: 'dist',
});
