// Job list / submit / clear-history endpoints.
//
// GET    /api/jobs           → [{ ... }, ...] (newest-first; capped)
// POST   /api/jobs           → { id, status }  (queues + schedules a GH run)
// DELETE /api/jobs           → clear finished history (done/error/cancelled)
//
// The Worker is the scheduler: at most MAX_PARALLEL GH runs at once
// (see lib/server/dispatch.ts). GET also performs zombie detection —
// pending jobs that were never dispatched, and running jobs whose last
// update is stale, are flipped to `error` so the UI never shows a job
// as forever "working".
//
// POST is the only public entry point that costs money (each job burns
// a GitHub Actions runner), so it carries the abuse controls: a
// Turnstile challenge, a per-IP rate limit, and queue-depth caps. See
// lib/server/guard.ts. DELETE (clear history) only ever touches the
// caller's own finished rows.

import { error, json, type RequestHandler } from '@sveltejs/kit';
import type {
  CreateJobRequest,
  CreateJobResponse,
  JobEntry
} from '$lib/types';
import { cleanupZombies, dispatchPending, pollGhRuns } from '$lib/server/dispatch';
import {
  ENQUEUE_LIMIT,
  ENQUEUE_WINDOW_S,
  checkQueueCapacity,
  checkRateLimit,
  clientIp,
  currentOwner,
  ensureOwner
} from '$lib/server/guard';
import { verifyTurnstile } from '$lib/server/turnstile';

interface Env {
  DB: D1Database;
  GH_REPO?: string;
  GH_DISPATCH_TOKEN?: string;
  TURNSTILE_SECRET?: string;
}

interface Counters {
  status: string;
  phase: string | null;
  dl_pct: number;
  tx_pct: number;
  up_pct: number;
  meta: string;
  log_lines: string;
  share_url: string | null;
  direct_url: string | null;
  expires_at: number | null;
  error: string | null;
  updated_at: number;
  config_json: string;
  queue_pos: number;
  title: string | null;
  dispatched: number;
  cancelled: number;
  phase_meta_json: string;
}

/** Build the JSON-safe shape the frontend consumes. */
function toJobEntry(
  row: {
    id: string;
    url: string;
    created_at: number;
  } & Counters
): JobEntry {
  const logLines: string[] = JSON.parse(row.log_lines || '[]');
  const config = JSON.parse(row.config_json || '{}');
  const total =
    row.dl_pct * 0.3 + row.tx_pct * 0.5 + row.up_pct * 0.2;
  const phase: 'Download' | 'Transcode' | 'Upload' | null =
    (row.phase as 'Download' | 'Transcode' | 'Upload' | null) ?? null;
  const phase_progress = {
    Download: row.dl_pct ?? 0,
    Transcode: row.tx_pct ?? 0,
    Upload: row.up_pct ?? 0
  };
  // Per-phase completion meta from the persistent JSON, with the live
  // current-phase meta overlaid so an in-progress bar reflects now.
  const phase_meta: Partial<Record<'Download' | 'Transcode' | 'Upload', string>> = {};
  try {
    const saved = JSON.parse(row.phase_meta_json || '{}');
    for (const k of ['Download', 'Transcode', 'Upload']) {
      if (typeof saved[k] === 'string') phase_meta[k as 'Download'] = saved[k];
    }
  } catch {
    /* ignore malformed */
  }
  if (phase && row.meta && row.status === 'running') phase_meta[phase] = row.meta;
  return {
    id: row.id,
    url: row.url,
    status: row.status as JobEntry['status'],
    phase,
    phase_progress,
    phase_meta,
    log_lines: logLines,
    share_url: row.share_url,
    direct_url: row.direct_url,
    expires_at: row.expires_at,
    error: row.error,
    config,
    queue_pos: row.queue_pos ?? 0,
    title: row.title ?? null,
    dispatched: (row.dispatched ?? 0) === 1,
    cancelled: (row.cancelled ?? 0) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  } as JobEntry;
}

const JOB_SELECT = `SELECT id, url, status, phase, dl_pct, tx_pct, up_pct, meta,
            log_lines, share_url, direct_url, expires_at, error,
            config_json, queue_pos, title, dispatched, cancelled, phase_meta_json,
            created_at, updated_at`;

export const GET: RequestHandler = async ({ platform }) => {
  const env = platform!.env;
  await cleanupZombies(env);
  // Reflect GH run states (allocated / started / failed) in D1, but
  // throttle the GH API calls — candidates are only polled once per
  // 20s by pollGhRuns, and the fetch is skipped entirely when no
  // candidate is due.
  await pollGhRuns(env);

  const { results } = await env.DB.prepare(
    `${JOB_SELECT}
       FROM jobs
      ORDER BY created_at DESC
      LIMIT 200`
  ).all<{
    id: string;
    url: string;
    status: string;
    phase: string | null;
    dl_pct: number;
    tx_pct: number;
    up_pct: number;
    meta: string;
    log_lines: string;
    share_url: string | null;
    direct_url: string | null;
    expires_at: number | null;
    error: string | null;
    config_json: string;
    queue_pos: number;
    title: string | null;
    dispatched: number;
    cancelled: number;
    phase_meta_json: string;
    created_at: number;
    updated_at: number;
  }>();
  const jobs = (results ?? []).map(toJobEntry);
  return json({ jobs });
};

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
  const env = platform!.env;
  const body = (await request.json()) as CreateJobRequest;
  if (!body || typeof body.url !== 'string') {
    throw error(400, 'missing url');
  }
  if (!/^https?:\/\//.test(body.url)) {
    throw error(400, 'url must start with http(s)://');
  }
  if (!body.config) {
    throw error(400, 'missing config');
  }

  const ip = clientIp(request);

  // Layer 1 — a human solved the challenge. Checked before the rate
  // limit so a bot flood doesn't consume the caller's quota (they'd
  // then be locked out by a burst aimed at their shared NAT address).
  const human = await verifyTurnstile(env, body.turnstile_token, ip);
  if (!human.ok) throw error(403, human.reason ?? 'Verification failed.');

  // Layer 2 — per-IP rate limit. A solved Turnstile token is valid for
  // minutes and a real user can keep solving, so the challenge alone
  // does not bound submission volume.
  const rl = await checkRateLimit(env, 'enqueue', ip, ENQUEUE_LIMIT, ENQUEUE_WINDOW_S);
  if (!rl.ok) {
    return json(
      { error: `Rate limit reached (${ENQUEUE_LIMIT}/hour). Try again later.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  // Layer 3 — queue caps. This is what actually protects the GitHub
  // Actions budget: MAX_PARALLEL bounds concurrency, not total volume.
  const owner = ensureOwner(cookies);
  const cap = await checkQueueCapacity(env, owner);
  if (!cap.ok) return json({ error: cap.reason }, { status: 429 });

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const qrow = await env.DB.prepare(
    `SELECT COALESCE(MAX(queue_pos), 0) + 1 AS next FROM jobs WHERE status = 'pending'`
  ).first<{ next: number }>();
  const queue_pos = qrow?.next ?? 1;

  await env.DB.prepare(
    `INSERT INTO jobs
       (id, url, status, phase, dl_pct, tx_pct, up_pct, meta,
        log_lines, share_url, direct_url, expires_at, error,
        config_json, queue_pos, title, cancelled, dispatched, owner, created_at, updated_at)
     VALUES (?, ?, 'pending', NULL, 0, 0, 0, '',
             '[]', NULL, NULL, NULL, NULL,
             ?, ?, NULL, 0, 0, ?, ?, ?)`
  )
    .bind(
      id,
      body.url,
      JSON.stringify(body.config ?? {}),
      queue_pos,
      owner,
      now,
      now
    )
    .run();

  // Schedule: fill any free runner slots from the queue.
  await dispatchPending(env);

  const res: CreateJobResponse = { id, status: 'pending' };
  return json(res);
};

/**
 * Clear finished history (done / error / cancelled), keep queue.
 *
 * Scoped to the caller's own rows so one visitor can't wipe everyone's
 * history. Legacy rows (owner IS NULL, predating ownership) are cleared
 * too — nobody holds a token for them, so otherwise they'd be
 * permanently stuck in every visitor's history list.
 */
export const DELETE: RequestHandler = async ({ platform, cookies }) => {
  const env = platform!.env;
  const owner = currentOwner(cookies);
  await env.DB.prepare(
    `DELETE FROM jobs
      WHERE status IN ('done', 'error', 'cancelled')
        AND (owner IS NULL OR owner = ?)`
  ).bind(owner).run();
  return json({ ok: true });
};
