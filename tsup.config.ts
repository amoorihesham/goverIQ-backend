import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'es2023',
  shims: true,
  clean: true,
  dts: true,
  outDir: 'dist',
  splitting: false,
  sourcemap: process.env.NODE_ENV === 'development',
  minify: process.env.NODE_ENV === 'production',
});
