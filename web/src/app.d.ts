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
