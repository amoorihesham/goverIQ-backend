import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/tracing.ts'],
  format: ['esm'],
  splitting: true,
  platform: 'node',
  external: ['dotenv'],
  minify: true,
  clean: true,
  outDir: 'dist',
});
