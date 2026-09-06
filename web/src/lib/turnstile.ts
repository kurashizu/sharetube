// Client-side Turnstile helper.
//
// The widget renders in an invisible container and is executed on
// demand at submit time, so the page keeps its current look and the
// user only ever sees an interstitial when Cloudflare decides one is
// warranted. Tokens are single-use: each submit resets the widget and
// solves again, otherwise the second job of a session would be
// rejected with `timeout-or-duplicate`.

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi | null> | null = null;
let widgetId: string | null = null;
let container: HTMLElement | null = null;
/** Resolver for the solve currently in flight, if any. */
let pending: ((token: string | null) => void) | null = null;

/** Load the Turnstile script once; resolves null if it can't load. */
function loadScript(): Promise<TurnstileApi | null> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(window.turnstile ?? null);
    // Blocked by an extension or offline — the caller submits without a
    // token and the Worker decides whether that's acceptable.
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/** Settle the in-flight solve exactly once. */
function settle(token: string | null) {
  const resolve = pending;
  pending = null;
  resolve?.(token);
}

/**
 * Obtain a fresh Turnstile token, or null when Turnstile is
 * unavailable (no site key configured, script blocked, solve failed).
 *
 * Callers submit regardless: the Worker treats a missing token as a
 * hard failure only when it has a secret configured, so a null here
 * surfaces as a clear server-side error rather than a silent no-op.
 */
export async function getToken(sitekey: string, timeoutMs = 30_000): Promise<string | null> {
  const api = await loadScript();
  if (!api) return null;

  // Only one solve at a time — the submit button is disabled while a
  // request is in flight, but guard anyway.
  if (pending) settle(null);

  if (!container) {
    container = document.createElement('div');
    // Off-screen rather than display:none — Turnstile refuses to run
    // in a container it considers hidden.
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);
  }

  return new Promise<string | null>((resolve) => {
    pending = resolve;
    const timer = setTimeout(() => settle(null), timeoutMs);
    const done = (token: string | null) => {
      clearTimeout(timer);
      settle(token);
    };

    try {
      if (widgetId === null) {
        widgetId = api.render(container!, {
          sitekey,
          size: 'invisible',
          callback: (token: string) => done(token),
          'error-callback': () => done(null),
          'timeout-callback': () => done(null)
        });
      } else {
        // Reset re-arms the existing widget and re-fires the callback
        // with a fresh, unredeemed token.
        api.reset(widgetId);
      }
    } catch {
      done(null);
    }
  });
}
