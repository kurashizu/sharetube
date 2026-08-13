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
const CANCEL_ACK_TIMEOUT_S = 90;        // force-stop w/o runner ack → force-error

// History auto-expiry: history items that linger forever just bloat the
// jobs table and slow down /api/jobs. Reap them on every list/GET so
// the table stays bounded without needing a cron trigger.
//
// Successful (done) jobs use their own share-URL expires_at — once
// the share URL is gone, the share link in history is dead, so the
// row has no value past that point. Error/cancelled jobs have no
// share URL, so we keep them only briefly (history-context is useful
// for debugging a recent failure but not for weeks).
const HISTORY_FAILED_TTL_S = 1 * 86400;    // error/cancelled get 1 day
const HISTORY_DONE_FALLBACK_S = 7 * 86400; // done rows without expires_at
// Don't run the DELETE on every poll — D1 writes are not free. With
// 5s polls, 5% probability = ~once a minute, plenty fast for cleanup
// of rows that are days old and not actually cost-free to delete.
const HISTORY_CLEANUP_PROBABILITY = 0.05;

interface Env {
  DB: D1Database;
  GH_REPO?: string;
  GH_DISPATCH_TOKEN?: string;
}

async function ghDispatch(
  env: Env,
  jobId: string,
  url: string,
  configJson: string,
  runner: 'linux' | 'mac' = 'linux'
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
        client_payload: { job_id: jobId, url, config: configJson, runner }
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
  // Force-stop that never got acknowledged: the runner didn't report
  // error within 90s of the cancel request — it's either dead or its
  // GH run was killed externally. Fail it so the UI doesn't show a
  // zombie running job.
  await env.DB.prepare(
    `UPDATE jobs SET status = 'error', error = 'Cancelled — runner stopped responding.',
            updated_at = ?
      WHERE status = 'running' AND cancelled = 1 AND cancelled_at IS NOT NULL
            AND cancelled_at < ?`
  ).bind(now, now - CANCEL_ACK_TIMEOUT_S).run();
  // Reap finished history past its TTL so /api/jobs doesn't accumulate
  // rows forever. Throttled to ~once a minute across all poll tabs.
  if (Math.random() < HISTORY_CLEANUP_PROBABILITY) {
    await cleanupExpiredHistory(env);
  }
}

/**
 * Hard-delete finished jobs past their per-status TTL.
 *
 *   done         — share URL is dead once its expires_at passes, so the
 *                  row is purged then. expires_at is stored as epoch
 *                  MILLISECONDS by the runner (cf-share API), so the
 *                  comparison uses now-ms.
 *
 *   error/cancelled — no share URL exists, only failure context. Short
 *                    TTL so recent failures stay visible for debugging
 *                    but the table doesn't grow without bound. Uses
 *                    updated_at in epoch seconds.
 *
 * Done rows without an expires_at (shouldn't happen but be defensive)
 * fall back to a 7-day TTL so they don't live forever.
 */
export async function cleanupExpiredHistory(env: Env): Promise<void> {
  const nowMs = Date.now();
  const nowS = Math.floor(nowMs / 1000);
  // Done rows whose share URL has expired.
  await env.DB.prepare(
    `DELETE FROM jobs
      WHERE status = 'done'
        AND expires_at IS NOT NULL
        AND expires_at < ?`
  ).bind(nowMs).run();
  // Done rows that somehow have no expires_at — cap at 7d.
  await env.DB.prepare(
    `DELETE FROM jobs
      WHERE status = 'done'
        AND expires_at IS NULL
        AND updated_at < ?`
  ).bind(nowS - HISTORY_DONE_FALLBACK_S).run();
  // Error / cancelled — keep 1d only.
  await env.DB.prepare(
    `DELETE FROM jobs
      WHERE status IN ('error', 'cancelled') AND updated_at < ?`
  ).bind(nowS - HISTORY_FAILED_TTL_S).run();
}

/**
 * Fire GH runs for queued jobs up to MAX_PARALLEL total in-flight.
 * Returns the number of jobs newly dispatched.
 */
export async function dispatchPending(env: Env): Promise<number> {  // In-flight = runner actively pushing (running) + GH run already
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
    // Read runner target from the per-job config; fall back to linux
    // if absent (older jobs predating the toggle).
    let runner: 'linux' | 'mac' = 'linux';
    try {
      const cfg = JSON.parse(job.config_json || '{}');
      if (cfg.runner === 'mac') runner = 'mac';
    } catch {
      // malformed config_json — keep default linux
    }
    const ok = await ghDispatch(env, job.id, job.url, job.config_json, runner);
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

/**
 * Poll GitHub for the runs we dispatched and reflect their status in
 * D1, so a run that was cancelled / failed / never got a runner shows
 * up in the UI instead of hanging at "awaiting runner" forever.
 *
 * We don't store run_ids, so we match by client_payload.job_id — the
 * dispatch payload always carries it. Called from GET /api/jobs;
 * throttled per job (once per ~20s) so we don't hammer the API.
 */
const GH_POLL_MIN_AGE_S = 30;   // don't poll before the run can exist
const GH_POLL_INTERVAL_S = 20;  // min seconds between polls of one job

export async function pollGhRuns(env: Env): Promise<void> {
  const token = env.GH_DISPATCH_TOKEN;
  if (!token) return;

  const now = Math.floor(Date.now() / 1000);
  // Pending & dispatched jobs that haven't phoned home yet, plus
  // force-stopped jobs whose runner may have died silently.
  const jobs = await env.DB.prepare(
    `SELECT id, updated_at, error, cancelled, cancelled_at FROM jobs
      WHERE (status = 'pending' AND dispatched = 1)
         OR (status = 'running' AND cancelled = 1)`
  ).all<{ id: string; updated_at: number; error: string | null; cancelled: number; cancelled_at: number | null }>();
  const candidates = (jobs.results ?? []).filter(
    (j) => now - j.updated_at > GH_POLL_MIN_AGE_S
  );
  if (candidates.length === 0) return;

  const repo = env.GH_REPO ?? 'kurashizu/sharetube';
  let runs: Array<{
    id: number;
    status: string;
    conclusion: string | null;
    created_at: string;
    client_payload: { job_id?: string } | null;
  }> = [];
  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs?event=repository_dispatch&per_page=100`,
      { headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'sharetube-worker',
      } }
    );
    if (r.ok) {
      const body = (await r.json()) as {
        workflow_runs?: Array<{
          id: number; status: string; conclusion: string | null;
          created_at: string;
          client_payload?: { job_id?: string };
        }>;
      };
      runs = (body.workflow_runs ?? []).map((run) => ({
        id: run.id,
        status: run.status,
        conclusion: run.conclusion ?? null,
        created_at: run.created_at,
        client_payload: run.client_payload ?? null,
      }));
    }
  } catch (e) {
    console.warn('pollGhRuns: fetch failed', (e as Error).message);
    return;
  }
  if (runs.length === 0) return;

  const byJob = new Map<string, typeof runs[number]>();
  for (const run of runs) {
    const jid = run.client_payload?.job_id;
    if (jid && !byJob.has(jid)) byJob.set(jid, run);
  }

  for (const job of candidates) {
    const run = byJob.get(job.id);
    if (!run) continue;

    const runCreated = Math.floor(Date.parse(run.created_at) / 1000);
    const terminal =
      run.status === 'completed' &&
      (run.conclusion === 'failure' ||
        run.conclusion === 'cancelled' ||
        run.conclusion === 'timed_out');

    // Don't mark a just-created run as failed before the runner
    // even had a chance to boot.
    if (terminal && now - runCreated > 60) {
      await env.DB.prepare(
        `UPDATE jobs SET status = 'error',
                error = ?, log_lines = '[]', updated_at = ?
          WHERE id = ? AND (status = 'pending' OR status = 'running')`
      ).bind(
        `GitHub Actions run #${run.id} ${run.conclusion} (${run.status})`, now, job.id
      ).run();
      // Freed a slot.
      await dispatchPending(env);
      continue;
    }

    // Run is queued/in_progress on GH but the runner hasn't started
    // pushing yet — reflect that in the UI logs. Only write when the
    // job isn't already error (kept by the WHERE above).
    if (run.status === 'queued' || run.status === 'in_progress') {
      const msg =
        run.status === 'queued'
          ? 'GitHub: runner allocated, waiting to start…'
          : 'GitHub: runner started, configuring environment…';
      const existing = (await env.DB.prepare(
        `SELECT log_lines FROM jobs WHERE id = ?`
      ).bind(job.id).first<{ log_lines: string }>());
      const lines = existing ? JSON.parse(existing.log_lines || '[]') : [];
      if (lines.length === 0 || lines[lines.length - 1] !== msg) {
        lines.push(msg);
        await env.DB.prepare(
          `UPDATE jobs SET log_lines = ?, updated_at = ? WHERE id = ?`
        ).bind(JSON.stringify(lines), now, job.id).run();
      }
    }
  }
}
