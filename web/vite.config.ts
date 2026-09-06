import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Tailwind v4 is configured entirely in app.css (@theme / @custom-variant);
  // there is no tailwind.config.js.
  plugins: [tailwindcss(), sveltekit()],
  // Cloudflare's import-meta.env is provided by wrangler/miniflare at
  // build time. We just need to silence Vite's defaults.
  define: {
    // Adapter requires no client-side build-time env for this app.
  },
  server: {
    // Wrangler dev runs the Worker; we use Vite only for the static
    // build/preview.
    port: 5173
  }
});
