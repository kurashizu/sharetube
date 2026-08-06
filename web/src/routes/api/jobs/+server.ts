// Job list / submit endpoints.
//
// GET  /api/jobs           → [{ ... }, ...] (newest-first; capped)
// POST /api/jobs           → { id, status }  (also dispatches GH workflow)
//
// POST also writes the user-supplied cookies.txt (if any) to a slot in
// D1 so the runner can retrieve it later. We do that on dispatch rather
// than relying on the dispatch payload size limits.

import { error, json, type RequestHandler } from '@sveltejs/kit';
import type {
  CreateJobRequest,
  CreateJobResponse,
  JobEntry
} from '$lib/types';

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
  // We use `phase` and per-phase pct to drive the UI; phase_meta is
  // a single string carried along with the latest push.
  const phase: 'Download' | 'Transcode' | 'Upload' | null =
    (row.phase as 'Download' | 'Transcode' | 'Upload' | null) ?? null;
  const phase_progress = {
    Download: row.dl_pct ?? 0,
    Transcode: row.tx_pct ?? 0,
    Upload: row.up_pct ?? 0
  };
  const phase_meta: Partial<Record<'Download' | 'Transcode' | 'Upload', string>> = {};
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
    created_at: row.created_at,
    updated_at: row.updated_at
  } as JobEntry;
}

export const GET: RequestHandler = async ({ platform }) => {
  const env = platform!.env;
  const { results } = await env.DB.prepare(
    `SELECT id, url, status, phase, dl_pct, tx_pct, up_pct, meta,
            log_lines, share_url, direct_url, expires_at, error,
            config_json, created_at, updated_at
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

  await env.DB.prepare(
    `INSERT INTO jobs
       (id, url, status, phase, dl_pct, tx_pct, up_pct, meta,
        log_lines, share_url, direct_url, expires_at, error,
        config_json, created_at, updated_at)
     VALUES (?, ?, 'pending', NULL, 0, 0, 0, '',
             '[]', NULL, NULL, NULL, NULL,
             ?, ?, ?)`
  )
    .bind(
      id,
      body.url,
      JSON.stringify(body.config ?? {}),
      now,
      now
    )
    .run();

  // Trigger the GitHub Actions workflow via `repository_dispatch`.
  // The Worker holds a PAT with `repo`+`workflow` scopes; the action
  // itself reads `INTERNAL_TOKEN` and `BACKEND_URL` from the *repo*
  // secrets, so we never transmit those on the dispatch wire.
  const repo = env.GH_REPO ?? 'kurashizu/sharetube';
  const token = env.GH_DISPATCH_TOKEN;
  if (token) {
    try {
      const r = await fetch(
        `https://api.github.com/repos/${repo}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'sharetube-worker'
          },
          body: JSON.stringify({
            event_type: 'sharetube-job',
            client_payload: { job_id: id }
          })
        }
      );
      if (!r.ok && r.status !== 204) {
        const txt = await r.text().catch(() => '');
        console.warn(
          `GH dispatch ${repo} → ${r.status} ${r.statusText}: ${txt.slice(0, 200)}`
        );
      }
    } catch (e) {
      console.warn('GH dispatch failed:', (e as Error).message);
    }
  } else {
    console.warn('GH_DISPATCH_TOKEN not set; job queued but never picked up.');
  }

  const res: CreateJobResponse = { id, status: 'pending' };
  return json(res);
};
