// Client-side Turnstile helper.
//
// The widget is rendered once into a zero-height container and solved on
// demand at submit time via `turnstile.execute()`. With
// `appearance: 'interaction-only'` nothing is shown unless Cloudflare
// actually decides a challenge is warranted, so the page keeps its
// layout in the common case.
//
// Tokens are single-use and short-lived: every submit resets the widget
// and solves again, otherwise the second job of a session would be
// rejected by siteverify with `timeout-or-duplicate`.
//
// Note the option names matter. `size` only accepts normal/flexible/
// compact — there is no 'invisible' size; deferred, non-intrusive
// behaviour comes from `execution` + `appearance`.

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(el: HTMLElement | string, opts?: Record<string, unknown>): void;
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
 * The host element for the widget.
 *
 * It must stay in normal flow and be visible to layout — Turnstile
 * refuses to run inside a container it considers hidden, so
 * `display:none` or an off-screen `left:-9999px` box silently fails.
 *
 * The element is always positioned and laid out, but clipped to zero
 * size unless an interactive challenge is on screen. In Managed mode
 * Cloudflare may decide to show one and needs somewhere to draw it;
 * the rest of the time the widget (including its post-solve "Success!"
 * state) must not linger over the page, so `showChallenge` expands the
 * box only for the duration of the interaction.
 */
function ensureContainer(): HTMLElement {
  if (container) return container;
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.left = '50%';
  el.style.top = '50%';
  el.style.transform = 'translate(-50%, -50%)';
  el.style.zIndex = '9999';
  container = el;
  showChallengeOn(el, false);
  document.body.appendChild(el);
  return el;
}

/** Reveal or hide the widget box. Hidden means clipped, not display:none —
 *  Turnstile refuses to run inside a container it considers hidden. */
function showChallengeOn(el: HTMLElement, visible: boolean) {
  el.style.width = visible ? 'auto' : '0';
  el.style.height = visible ? 'auto' : '0';
  el.style.overflow = visible ? 'visible' : 'hidden';
  el.style.opacity = visible ? '1' : '0';
  el.style.pointerEvents = visible ? 'auto' : 'none';
  el.style.boxShadow = visible ? '0 0 0 100vmax rgba(0,0,0,0.6)' : '';
}

function showChallenge(visible: boolean) {
  if (container) showChallengeOn(container, visible);
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

  const el = ensureContainer();

  return new Promise<string | null>((resolve) => {
    pending = resolve;
    const timer = setTimeout(() => settle(null), timeoutMs);
    const done = (token: string | null) => {
      clearTimeout(timer);
      showChallenge(false);
      settle(token);
    };

    try {
      if (widgetId === null) {
        widgetId = api.render(el, {
          sitekey,
          // Defer the challenge until execute() rather than solving on
          // render, so the token is fresh at submit time.
          execution: 'execute',
          // Stay hidden unless Cloudflare needs user interaction.
          appearance: 'interaction-only',
          callback: (token: string) => done(token),
          // Surface the error code: a misconfigured widget (e.g. 110200
          // "domain not authorized", when the site's exact hostname is
          // missing from Hostname Management) otherwise shows up only as
          // a generic verification failure with no way to diagnose it.
          // Cloudflare decided a visible challenge is needed — reveal it.
          'before-interactive-callback': () => showChallenge(true),
          'after-interactive-callback': () => showChallenge(false),
          'error-callback': (code?: string) => {
            console.warn(
              `Turnstile error${code ? ` ${code}` : ''}` +
                (code === '110200'
                  ? ` — this hostname is not in the widget's allowed list.`
                  : '')
            );
            done(null);
          },
          'timeout-callback': () => done(null),
          'expired-callback': () => done(null)
        });
      } else {
        // Clear the previous single-use token before re-solving.
        api.reset(widgetId);
      }
      // With execution:'execute' the challenge only runs when asked —
      // required on the first render and on every subsequent solve.
      api.execute(el);
    } catch {
      done(null);
    }
  });
}
