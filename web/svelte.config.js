import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // Single-page app on `/`, with server endpoints under `/api/*`.
      // SPA fallback so deep links like /anything still resolve to
      // the client.
      fallback: 'index.html',
      // Keep route-only output (no directory splitting).
      routes: {
        include: ['<all>'],
        exclude: ['<internal>']
      }
    }),
    // The SvelteKit server endpoints under /api/* must NOT be
    // pre-rendered (they read request bodies, headers, D1).
    // We achieve that by leaving prerender off globally and opting
    // individual pages into prerender via +layout.ts → `export const
    // prerender = true` etc.
    alias: {
      $lib: 'src/lib'
    }
  }
};

export default config;
