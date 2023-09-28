import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://harry-whorlow.github.io',
  base: '/portfolio',
  server: { port: 1234, host: true },
});
