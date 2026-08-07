// Internal update endpoint, called by the Python runner during job
// execution. Authentication via `Authorization: Bearer <INTERNAL_TOKEN>`
// (compared against the `INTERNAL_TOKEN` Worker secret).
//
// Body (only fields the runner wants to update):
//   {
//     job_id: string,
//     status?: 'running' | 'done' | 'error',
//     phase?: 'Download' | 'Transcode' | 'Upload',
//     download_pct?: number, transcode_pct?: number, upload_pct?: number,
//     meta?: string,
//     append_log?: string[],
//     share_url?: string,
//     direct_url?: string,
//     expires_at?: number,
//     error?: string,
//     title?: string
//   }
//
// Returns { ok: true, cancelled: 0|1 }. The `cancelled` flag lets the
// runner stop mid-pipeline when the user force-stops a job.

import { json, type RequestHandler } from '@sveltejs/kit';
import { dispatchPending } from '$lib/server/dispatch';

interface Env {
  DB: D1Database;
  INTERNAL_TOKEN?: string;
}

const MAX_LOG_LINES = 200;

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  const auth = request.headers.get('Authorization') ?? '';
  if (!env.INTERNAL_TOKEN) {
    return json({ error: 'INTERNAL_TOKEN not configured' }, { status: 500 });
  }
  if (auth !== `Bearer ${env.INTERNAL_TOKEN}`) {
    return json({ error: 'unauthorised' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, { status: 400 });
  }
  const job_id = body.job_id;
  if (typeof job_id !== 'string' || !job_id) {
    return json({ error: 'missing job_id' }, { status: 400 });
  }

  // Read current row so we can append to logs and preserve untouched
  // per-phase pcts.
  const row = await env.DB.prepare(
    `SELECT log_lines, dl_pct, tx_pct, up_pct, status, phase, meta, cancelled, phase_meta_json
       FROM jobs WHERE id = ?`
  )
    .bind(job_id)
    .first<{
      log_lines: string;
      dl_pct: number;
      tx_pct: number;
      up_pct: number;
      status: string;
      phase: string | null;
      meta: string;
      cancelled: number;
      phase_meta_json: string;
    }>();
  if (!row) return json({ error: 'unknown job_id' }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);

  // Cancel-only probe: push_progress/update_sync normally learn
  // `cancelled` from a response, but a job stuck in a long transcode
  // or merge sends no push — so the runner issues a lightweight
  // query that returns the flag without touching any state.
  const hasFields =
    typeof body.status === 'string' ||
    typeof body.phase === 'string' ||
    typeof body.meta === 'string' ||
    typeof body.download_pct === 'number' ||
    typeof body.transcode_pct === 'number' ||
    typeof body.upload_pct === 'number' ||
    typeof body.share_url === 'string' ||
    typeof body.direct_url === 'string' ||
    typeof body.expires_at === 'number' ||
    typeof body.error === 'string' ||
    typeof body.title === 'string' ||
    Array.isArray(body.append_log);
  if (!hasFields) {
    // Pure cancel probe: don't touch updated_at, just answer.
    return json({ ok: true, cancelled: row.cancelled ?? 0 });
  }

  // Build dynamic SET clause based on which fields are present.
  const sets: string[] = ['updated_at = ?'];
  const binds: any[] = [now];

  if (typeof body.status === 'string') {
    const cur = row.status;
    const next = body.status;
    // Guard against regression: a terminal state (done/error) must
    // never be flipped back to running by a stale queued packet.
    const terminal = cur === 'done' || cur === 'error' || cur === 'cancelled';
    if (!(terminal && next === 'running')) {
      sets.push('status = ?');
      binds.push(next);
    }
  }
  if (typeof body.phase === 'string' || body.phase === null) {
    sets.push('phase = ?');
    binds.push(body.phase ?? null);
  }
  if (typeof body.meta === 'string') {
    sets.push('meta = ?');
    binds.push(body.meta);
  }
  // Fold the current-phase meta into the persistent per-phase JSON so
  // a finished bar can show "5.2 MB · speed=8.4x" instead of just ✓.
  // - A completion marker (this phase's pct === 100) is authoritative
  //   and overwrites whatever live speed string accumulated before it.
  // - Otherwise (mid-stream progress) only set if we don't already
  //   have a value, so a stale empty packet never erases the final one.
  const phaseToPctKey: Record<string, string | undefined> = {
    Download: 'download_pct',
    Transcode: 'transcode_pct',
    Upload: 'upload_pct',
  };
  if (typeof body.phase === 'string' && typeof body.meta === 'string' && body.meta !== '') {
    const phaseName = body.phase.replace(/[^A-Za-z]/g, '');
    const pctKey = phaseToPctKey[phaseName];
    const isCompletion =
      (typeof body.download_pct === 'number' && body.download_pct >= 100) ||
      (typeof body.transcode_pct === 'number' && body.transcode_pct >= 100) ||
      (typeof body.upload_pct === 'number' && body.upload_pct >= 100);
    if (phaseName) {
      const prev = JSON.parse(row.phase_meta_json || '{}');
      const existing = prev[phaseName];
      if (isCompletion || typeof existing !== 'string' || existing === '') {
        prev[phaseName] = body.meta;
        sets.push('phase_meta_json = ?');
        binds.push(JSON.stringify(prev));
      }
    }
  }
  // Per-phase pcts: strictly monotonic — the runner pushes progress
  // through a rate-limited async queue while phase-completion markers
  // go out synchronously, so a stale queued packet can arrive AFTER a
  // 100% marker and would otherwise regress the bar. MAX() makes the
  // stored value never decrease. Exception: `rollback` (DASH video→
  // audio stream transition renormalizes the cumulative %) is allowed
  // to step DOWN once.
  if (typeof body.download_pct === 'number') {
    const v = Math.max(0, Math.min(100, body.download_pct));
    sets.push(body.rollback ? 'dl_pct = ?' : 'dl_pct = MAX(dl_pct, ?)');
    binds.push(v);
  }
  if (typeof body.transcode_pct === 'number') {
    const v = Math.max(0, Math.min(100, body.transcode_pct));
    sets.push('tx_pct = MAX(tx_pct, ?)');
    binds.push(v);
  }
  if (typeof body.upload_pct === 'number') {
    const v = Math.max(0, Math.min(100, body.upload_pct));
    sets.push('up_pct = MAX(up_pct, ?)');
    binds.push(v);
  }
  if (typeof body.share_url === 'string') {
    sets.push('share_url = ?');
    binds.push(body.share_url);
  }
  if (typeof body.direct_url === 'string') {
    sets.push('direct_url = ?');
    binds.push(body.direct_url);
  }
  if (typeof body.expires_at === 'number') {
    sets.push('expires_at = ?');
    binds.push(body.expires_at);
  }
  if (typeof body.error === 'string') {
    sets.push('error = ?');
    binds.push(body.error);
  }

  if (typeof body.title === 'string') {
    sets.push('title = ?');
    binds.push(body.title.slice(0, 500));
  }

  // Append logs. We rebuild the JSON array server-side and cap it to
  // MAX_LOG_LINES (drop oldest).
  let mergedLogs: string[] = JSON.parse(row.log_lines || '[]');
  if (Array.isArray(body.append_log)) {
    for (const line of body.append_log) {
      if (typeof line === 'string') {
        const trimmed = line.length > 2000 ? line.slice(0, 2000) : line;
        mergedLogs.push(trimmed);
      }
    }
    if (mergedLogs.length > MAX_LOG_LINES) {
      mergedLogs = mergedLogs.slice(mergedLogs.length - MAX_LOG_LINES);
    }
    sets.push('log_lines = ?');
    binds.push(JSON.stringify(mergedLogs));
  }

  // Final status update — when `done`/`error`, capture in the same
  // statement by writing the row atomically.
  binds.push(job_id);
  await env.DB.prepare(
    `UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`
  )
    .bind(...binds)
    .run();

  // A job left `running` (done / error) — backfill the freed slot.
  if (
    typeof body.status === 'string' &&
    body.status !== 'running' &&
    row.status === 'running'
  ) {
    await dispatchPending(env);
  }

  return json({ ok: true, cancelled: row.cancelled ?? 0 });
};
