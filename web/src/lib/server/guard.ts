// Abuse controls shared by the public write endpoints.
//
// Three independent layers, cheapest first:
//
//   1. Turnstile   — proves a human is behind an enqueue (see turnstile.ts).
//   2. Rate limits — a fixed window per client IP, so one visitor can't
//                    burst the queue even with a valid Turnstile token
//                    (a solved challenge is reusable for its lifetime).
//   3. Queue caps  — a ceiling on outstanding work, global and per owner.
//
// Layers 2 and 3 are the ones that actually protect the GitHub Actions
// budget: `MAX_PARALLEL` bounds concurrency but not total volume, so
// without a depth cap a single user can queue jobs indefinitely and
// drain the runner minutes over the following hours.
//
// Ownership (`owner` column + `st_owner` cookie) gates cancel / move /
// delete so visitors can only touch their own jobs.

import type { D1Database } from '@cloudflare/workers-types';
import type { Cookies } from '@sveltejs/kit';

interface Env {
  DB: D1Database;
}

/** Max jobs awaiting a runner across the whole site. Past this, enqueue
 *  is refused — the backlog is already longer than anyone will wait. */
export const MAX_QUEUE_DEPTH = 20;

/** Max simultaneously unfinished (pending + running) jobs per owner. */
export const MAX_JOBS_PER_OWNER = 3;

/** Enqueue rate limit: N requests per window, per client IP. */
export const ENQUEUE_LIMIT = 10;
export const ENQUEUE_WINDOW_S = 60 * 60;

/** Write-op (cancel/move/delete) rate limit, per client IP. Looser than
 *  enqueue: these are cheap and users legitimately click them in bursts
 *  while managing a queue. */
export const MUTATE_LIMIT = 60;
export const MUTATE_WINDOW_S = 60 * 60;

/** Reap stale rate-limit rows roughly this often (probability per call). */
const RL_CLEANUP_PROBABILITY = 0.02;

export const OWNER_COOKIE = 'st_owner';
const OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;  // 90 days

/**
 * Client IP as seen by Cloudflare. `CF-Connecting-IP` is set by the
 * edge and cannot be spoofed by the client — unlike `X-Forwarded-For`,
 * which is attacker-controlled and must never be trusted here.
 *
 * Falls back to a shared bucket when absent (local `vite dev`, where
 * every request would otherwise be unlimited).
 */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the current window expires (for Retry-After). */
  retryAfter: number;
}

/**
 * Fixed-window counter in D1, keyed by bucket + IP.
 *
 * Fixed windows admit up to 2x the limit across a window boundary. That
 * is fine at this scale: the queue-depth cap is the real ceiling on
 * runner spend, and this layer only needs to stop trivial scripted
 * floods. A sliding window would cost more D1 writes than it's worth.
 *
 * The read-then-write is not atomic. Two simultaneous requests can read
 * the same count and both admit; again, tolerable — the depth cap
 * catches what slips through.
 */
export async function checkRateLimit(
  env: Env,
  bucket: string,
  ip: string,
  limit: number,
  windowS: number
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const key = `${bucket}:${ip}`;

  if (Math.random() < RL_CLEANUP_PROBABILITY) {
    await env.DB.prepare(
      `DELETE FROM rate_limits WHERE window_start < ?`
    ).bind(now - Math.max(ENQUEUE_WINDOW_S, MUTATE_WINDOW_S)).run();
  }

  const row = await env.DB.prepare(
    `SELECT count, window_start FROM rate_limits WHERE key = ?`
  ).bind(key).first<{ count: number; window_start: number }>();

  // No row, or the window has rolled over — start a fresh one.
  if (!row || now - row.window_start >= windowS) {
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`
    ).bind(key, now).run();
    return { ok: true, retryAfter: 0 };
  }

  if (row.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, row.window_start + windowS - now) };
  }

  await env.DB.prepare(
    `UPDATE rate_limits SET count = count + 1 WHERE key = ?`
  ).bind(key).run();
  return { ok: true, retryAfter: 0 };
}

/**
 * Read the caller's owner token, minting one if this is their first
 * write. The token is opaque and HttpOnly: it identifies a browser, not
 * a person, and is never exposed to page scripts.
 */
export function ensureOwner(cookies: Cookies): string {
  const existing = cookies.get(OWNER_COOKIE);
  if (existing) return existing;
  const token = crypto.randomUUID();
  cookies.set(OWNER_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // `vite dev` serves plain HTTP; the deployed Worker is HTTPS-only.
    secure: true,
    maxAge: OWNER_COOKIE_MAX_AGE
  });
  return token;
}

/** The caller's owner token, or null if they've never enqueued. */
export function currentOwner(cookies: Cookies): string | null {
  return cookies.get(OWNER_COOKIE) ?? null;
}

/**
 * May `owner` mutate this job?
 *
 * Legacy rows (owner IS NULL, created before ownership existed) stay
 * open — no browser holds a token for them, so locking them would
 * strand them permanently in the UI.
 */
export function ownsJob(jobOwner: string | null, caller: string | null): boolean {
  if (jobOwner === null || jobOwner === '') return true;
  return caller !== null && caller === jobOwner;
}

export interface QueueCapResult {
  ok: boolean;
  reason?: string;
}

/** Enforce the global backlog ceiling and the per-owner in-flight cap. */
export async function checkQueueCapacity(
  env: Env,
  owner: string
): Promise<QueueCapResult> {
  const depth = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending'`
  ).first<{ n: number }>();
  if ((depth?.n ?? 0) >= MAX_QUEUE_DEPTH) {
    return {
      ok: false,
      reason: `Queue is full (${MAX_QUEUE_DEPTH} jobs waiting). Try again once it drains.`
    };
  }

  const mine = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs
      WHERE owner = ? AND status IN ('pending', 'running')`
  ).bind(owner).first<{ n: number }>();
  if ((mine?.n ?? 0) >= MAX_JOBS_PER_OWNER) {
    return {
      ok: false,
      reason: `You already have ${MAX_JOBS_PER_OWNER} jobs in flight. Wait for one to finish.`
    };
  }

  return { ok: true };
}
