// Single-job endpoints.
//
// GET    /api/jobs/[id]                 → job detail
// DELETE /api/jobs/[id]                 → remove the row (any status;
//                                          running jobs are first
//                                          marked cancelled)
// POST   /api/jobs/[id]/cancel          → set cancelled=1 (runner sees
//                                          it on next push and aborts)
// POST   /api/jobs/[id]/move            → body { direction: 'up' | 'down' }
//                                          swap queue_pos with the
//                                          adjacent pending job

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { cleanupZombies } from '$lib/server/dispatch';

interface Env {
  DB: D1Database;
}

const JOB_COLS = `id, url, status, phase, dl_pct, tx_pct, up_pct, meta,
            log_lines, share_url, direct_url, expires_at, error,
            config_json, queue_pos, title, cancelled, created_at, updated_at`;

async function getRow(env: Env, id: string) {
  return env.DB.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id = ?`)
    .bind(id)
    .first<{
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
      cancelled: number;
      created_at: number;
      updated_at: number;
    }>();
}

function toJson(row: NonNullable<Awaited<ReturnType<typeof getRow>>>) {
  const log_lines: string[] = JSON.parse(row.log_lines || '[]');
  const config = JSON.parse(row.config_json || '{}');
  const phase_progress = {
    Download: row.dl_pct ?? 0,
    Transcode: row.tx_pct ?? 0,
    Upload: row.up_pct ?? 0
  };
  const phase_meta: Partial<Record<'Download' | 'Transcode' | 'Upload', string>> = {};
  if (row.phase && row.meta) phase_meta[row.phase as 'Download' | 'Transcode' | 'Upload'] = row.meta;
  return {
    id: row.id,
    url: row.url,
    status: row.status,
    phase: row.phase,
    phase_progress,
    phase_meta,
    log_lines,
    share_url: row.share_url,
    direct_url: row.direct_url,
    expires_at: row.expires_at,
    error: row.error,
    config,
    queue_pos: row.queue_pos ?? 0,
    title: row.title ?? null,
    cancelled: (row.cancelled ?? 0) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export const GET: RequestHandler = async ({ platform, params }) => {
  const env = platform!.env;
  await cleanupZombies(env);
  const row = await getRow(env, params.id!);
  if (!row) throw error(404, 'job not found');
  return json(toJson(row));
};

/** Hard-delete a job row. Safe for any status; running jobs are
 *  marked cancelled first (their runner aborts), then deleted. */
export const DELETE: RequestHandler = async ({ platform, params }) => {
  const env = platform!.env;
  const row = await getRow(env, params.id!);
  if (!row) throw error(404, 'job not found');

  if (row.status === 'running' || row.status === 'pending') {
    await env.DB.prepare(
      `UPDATE jobs SET cancelled = 1, updated_at = ? WHERE id = ?`
    ).bind(Math.floor(Date.now() / 1000), params.id).run();
  }
  await env.DB.prepare(`DELETE FROM jobs WHERE id = ?`).bind(params.id).run();
  return json({ ok: true });
};
