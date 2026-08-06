// Shared GH-Actions dispatch scheduler + zombie cleanup.
//
// The Worker keeps at most MAX_PARALLEL workflow runs alive. Jobs are
// inserted as `pending` (queue_pos ascending = the user's queue order);
// `dispatchPending` triggers runs for the oldest still-undispatched
// pending jobs up to the free slot budget. It is called:
//   - after POST /api/jobs (new job queued)
//   - after a job leaves `running` (update endpoint, cancel endpoint)
//     to backfill the freed slot
//
// Dispatch is made idempotent via the `dispatched` flag: we claim a
// row with an atomic conditional UPDATE, then only the request that
// won the claim fires the GH API call.

import type { D1Database } from '@cloudflare/workers-types';

/** Max simultaneous GitHub Actions runs (== concurrent processors). */
export const MAX_PARALLEL = 4;

const ZOMBIE_UNDISPATCHED_S = 30 * 60;  // queued but never dispatched
const ZOMBIE_DISPATCHED_S = 15 * 60;    // dispatch fired, runner never started
const ZOMBIE_RUNNING_S = 30 * 60;       // no progress pushes at all

interface Env {
  DB: D1Database;
  GH_REPO?: string;
  GH_DISPATCH_TOKEN?: string;
}

async function ghDispatch(
  env: Env,
  jobId: string,
  url: string,
  configJson: string
): Promise<boolean> {
  const repo = env.GH_REPO ?? 'kurashizu/sharetube';
  const token = env.GH_DISPATCH_TOKEN;
  if (!token) {
    console.warn('GH_DISPATCH_TOKEN not set; job stays queued.');
    return false;
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'sharetube-worker'
      },
      body: JSON.stringify({
        event_type: 'sharetube-job',
        client_payload: { job_id: jobId, url, config: configJson }
      })
    });
    if (!r.ok && r.status !== 204) {
      const txt = await r.text().catch(() => '');
      console.warn(
        `GH dispatch ${repo} → ${r.status} ${r.statusText}: ${txt.slice(0, 200)}`
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn('GH dispatch failed:', (e as Error).message);
    return false;
  }
}

/** Flip zombies to error. Shared by list + single-job GET routes. */
export async function cleanupZombies(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE jobs SET status = 'error', error = 'Queued but never dispatched (scheduler missed it).',
            updated_at = ?
      WHERE status = 'pending' AND dispatched = 0 AND created_at < ?`
  ).bind(now, now - ZOMBIE_UNDISPATCHED_S).run();
  await env.DB.prepare(
    `UPDATE jobs SET status = 'error', error = 'Dispatched but runner never started.',
            updated_at = ?
      WHERE status = 'pending' AND dispatched = 1 AND updated_at < ?`
  ).bind(now, now - ZOMBIE_DISPATCHED_S).run();
  await env.DB.prepare(
    `UPDATE jobs SET status = 'error', error = 'Runner lost contact (no updates for 30 min).',
            updated_at = ?
      WHERE status = 'running' AND updated_at < ? AND cancelled = 0`
  ).bind(now, now - ZOMBIE_RUNNING_S).run();
}

/**
 * Fire GH runs for queued jobs up to MAX_PARALLEL total in-flight.
 * Returns the number of jobs newly dispatched.
 */
export async function dispatchPending(env: Env): Promise<number> {
  // In-flight = runner actively pushing (running) + GH run already
  // triggered but not yet reported back (pending & dispatched). Both
  // consume a parallel slot; counting only `running` would let bursts
  // exceed MAX_PARALLEL before the runners phone home.
  const running = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs
      WHERE status = 'running' OR (status = 'pending' AND dispatched = 1)`
  ).first<{ n: number }>();
  const inflight = running?.n ?? 0;
  const free = Math.max(0, MAX_PARALLEL - inflight);
  if (free === 0) return 0;

  // Oldest undispatched pending jobs first (queue order).
  const queued = await env.DB.prepare(
    `SELECT id, url, config_json FROM jobs
      WHERE status = 'pending' AND dispatched = 0
      ORDER BY queue_pos ASC, created_at ASC
      LIMIT ?`
  ).bind(free).all<{ id: string; url: string; config_json: string }>();

  let dispatched = 0;
  for (const job of (queued.results ?? [])) {
    // Claim atomically — another (racing) request may have taken it.
    const claim = await env.DB.prepare(
      `UPDATE jobs SET dispatched = 1, updated_at = ?
        WHERE id = ? AND status = 'pending' AND dispatched = 0`
    ).bind(Math.floor(Date.now() / 1000), job.id).run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    const ok = await ghDispatch(env, job.id, job.url, job.config_json);
    if (ok) {
      dispatched += 1;
    } else {
      // Roll back so a later retry can pick it up.
      await env.DB.prepare(
        `UPDATE jobs SET dispatched = 0 WHERE id = ?`
      ).bind(job.id).run();
    }
  }
  return dispatched;
}
