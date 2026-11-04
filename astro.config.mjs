import { defineConfig } from 'astro/config';

import netlify from '@astrojs/netlify';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://harry-whorlow.dev',
  base: '/',
  server: { port: 1234, host: true },
  integrations: [],

  adapter: netlify({ imageCDN: false }),
  session: false,

  vite: { plugins: [tailwindcss()] },
});
