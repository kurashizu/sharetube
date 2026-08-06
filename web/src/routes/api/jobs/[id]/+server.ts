// Get a single job by ID.

import { error, json, type RequestHandler } from '@sveltejs/kit';

interface Env {
  DB: D1Database;
}

export const GET: RequestHandler = async ({ platform, params }) => {
  const env = platform!.env;
  const id = params.id!;
  const row = await env.DB.prepare(
    `SELECT id, url, status, phase, dl_pct, tx_pct, up_pct, meta,
            log_lines, share_url, direct_url, expires_at, error,
            config_json, created_at, updated_at
       FROM jobs
      WHERE id = ?`
  ).bind(id).first<{
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
    created_at: number;
    updated_at: number;
  }>();
  if (!row) throw error(404, 'job not found');

  // Mirror the projection in /api/jobs/+server.ts. Kept inline
  // intentionally: jobs list and single-job consumers see exactly
  // the same shape.
  const log_lines: string[] = JSON.parse(row.log_lines || '[]');
  const config = JSON.parse(row.config_json || '{}');
  const phase_progress = {
    Download: row.dl_pct ?? 0,
    Transcode: row.tx_pct ?? 0,
    Upload: row.up_pct ?? 0
  };
  const phase_meta: Partial<Record<'Download' | 'Transcode' | 'Upload', string>> = {};
  if (row.phase && row.meta) phase_meta[row.phase as 'Download' | 'Transcode' | 'Upload'] = row.meta;

  return json({
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
    created_at: row.created_at,
    updated_at: row.updated_at
  });
};
