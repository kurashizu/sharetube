// Cloudflare Turnstile server-side verification.
//
// The widget on the page produces a single-use token; this module
// redeems it against Cloudflare's siteverify endpoint. A token is only
// valid for ~5 minutes and cannot be redeemed twice, which is what
// stops a captured token from being replayed by a script.
//
// Turnstile proves "a browser solved a challenge" — nothing more. It
// does not bound how much work one solver can queue, so it is always
// paired with the rate limits and queue caps in guard.ts.

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface Env {
  TURNSTILE_SECRET?: string;
}

export interface TurnstileResult {
  ok: boolean;
  /** User-facing reason when ok is false. */
  reason?: string;
}

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Verify a Turnstile token.
 *
 * When `TURNSTILE_SECRET` is unset the check is skipped and the request
 * is allowed. That keeps `vite dev` and any deploy that predates the
 * secret working — the rate limits and queue caps still apply, so an
 * unconfigured deploy degrades to "no bot check", not "no protection".
 * Set the secret in production to turn the layer on.
 */
export async function verifyTurnstile(
  env: Env,
  token: unknown,
  ip: string
): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return { ok: true };

  if (typeof token !== 'string' || !token) {
    return { ok: false, reason: 'Verification required — please retry.' };
  }

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  // Optional, but lets Cloudflare correlate the solve with the client.
  if (ip !== 'unknown') form.append('remoteip', ip);

  let data: SiteverifyResponse;
  try {
    const r = await fetch(SITEVERIFY_URL, { method: 'POST', body: form });
    if (!r.ok) {
      console.warn(`turnstile siteverify → ${r.status} ${r.statusText}`);
      return { ok: false, reason: 'Verification unavailable — please retry.' };
    }
    data = (await r.json()) as SiteverifyResponse;
  } catch (e) {
    // Fail closed: siteverify being unreachable is rare, and treating
    // it as a pass would let anyone bypass the check by blocking it.
    console.warn('turnstile siteverify failed:', (e as Error).message);
    return { ok: false, reason: 'Verification unavailable — please retry.' };
  }

  if (!data.success) {
    const codes = data['error-codes'] ?? [];
    console.warn(`turnstile rejected: ${codes.join(', ') || 'no error codes'}`);
    // Expired / already-redeemed tokens are the common case and are
    // recoverable by solving again, so keep the message actionable.
    return { ok: false, reason: 'Verification failed — please retry.' };
  }

  return { ok: true };
}
