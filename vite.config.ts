import { defineConfig } from 'vite';

// Project Pages site: assets are served from /<repo>/, so the base must match
// or every script and model 404s on the preview URL.
export default defineConfig({
  base: '/the-file/',
  build: { target: 'es2022' },
});
