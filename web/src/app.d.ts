// SvelteKit `App.Platform` augmentation for the Cloudflare adapter.
//
// At runtime the adapter passes `{ env, context, caches, cf }` as the
// `platform` of every RequestEvent. We declare that shape here so
// `event.platform.env.DB` etc. is type-safe in `+server.ts` handlers.
//
// `D1Database` / `KVNamespace` / `R2Bucket` are Cloudflare Worker
// runtime types. They come bundled in @sveltejs/adapter-cloudflare's
// dependency `@cloudflare/workers-types`. We import the side-effect
// so they're globalized.

import '@cloudflare/workers-types';

declare global {
  namespace App {
    interface Platform {
      env: {
        DB: D1Database;
        GH_REPO?: string;
        GH_DISPATCH_TOKEN?: string;
        INTERNAL_TOKEN?: string;
        /** Turnstile secret key, set via `wrangler secret put
         *  TURNSTILE_SECRET`. When unset the bot check is skipped
         *  (rate limits and queue caps still apply). */
        TURNSTILE_SECRET?: string;
        /** Turnstile site key. Public — served to the SPA by
         *  GET /api/config and embedded in the widget. */
        PUBLIC_TURNSTILE_SITEKEY?: string;
      };
      context: {
        waitUntil(promise: Promise<unknown>): void;
      };
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }
  }
}

export {};
