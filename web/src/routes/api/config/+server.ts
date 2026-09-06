// GET /api/config — public runtime configuration for the SPA.
//
// The app is a pure client-side SPA (`ssr = false`), so it has no
// server `load` to receive Worker vars through. This endpoint exposes
// the handful of values the client legitimately needs at runtime.
//
// Only ever return values that are public by design. The Turnstile
// site key qualifies: it is embedded in the widget markup on every
// page that uses Turnstile and is inert without the paired secret.

import { json, type RequestHandler } from '@sveltejs/kit';

interface Env {
  PUBLIC_TURNSTILE_SITEKEY?: string;
}

export const GET: RequestHandler = async ({ platform }) => {
  const env = (platform?.env ?? {}) as Env;
  return json(
    { turnstile_sitekey: env.PUBLIC_TURNSTILE_SITEKEY ?? null },
    // Small and rarely changing, but not immutable — a short cache
    // keeps repeat visits off the Worker without pinning a rotated key.
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  );
};
