import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://parkhomes.nz',
  build: { format: 'directory' },
  integrations: [sitemap()],
});
