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

import { error, json, type RequestHandler } from '@sveltejs/kit';
import type {
  CreateJobRequest,
  CreateJobResponse,
  JobEntry
} from '$lib/types';
import { cleanupZombies, dispatchPending, pollGhRuns } from '$lib/server/dispatch';

interface Env {
  DB: D1Database;
  GH_REPO?: string;
  GH_DISPATCH_TOKEN?: string;
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
  if (phase && row.meta) phase_meta[phase] = row.meta;
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
    created_at: number;
    updated_at: number;
  }>();
  const jobs = (results ?? []).map(toJobEntry);
  return json({ jobs });
};

export const POST: RequestHandler = async ({ request, platform }) => {
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
        config_json, queue_pos, title, cancelled, dispatched, created_at, updated_at)
     VALUES (?, ?, 'pending', NULL, 0, 0, 0, '',
             '[]', NULL, NULL, NULL, NULL,
             ?, ?, NULL, 0, 0, ?, ?)`
  )
    .bind(
      id,
      body.url,
      JSON.stringify(body.config ?? {}),
      queue_pos,
      now,
      now
    )
    .run();

  // Schedule: fill any free runner slots from the queue.
  await dispatchPending(env);

  const res: CreateJobResponse = { id, status: 'pending' };
  return json(res);
};

/** Clear finished history (done / error / cancelled), keep queue. */
export const DELETE: RequestHandler = async ({ platform }) => {
  const env = platform!.env;
  await env.DB.prepare(
    `DELETE FROM jobs WHERE status IN ('done', 'error', 'cancelled')`
  ).run();
  return json({ ok: true });
};
