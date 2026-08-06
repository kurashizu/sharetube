// POST /api/jobs/[id]/cancel — request a force-stop of a running job.
//
// Sets `cancelled = 1` and appends a log line. The runner checks the
// `cancelled` flag in the internal update response on every push and
// aborts the pipeline, then reports status=error "cancelled by user".
// Pending jobs are simply transitioned to error right away (no runner
// has claimed them yet).

import { json, type RequestHandler } from '@sveltejs/kit';

interface Env {
  DB: D1Database;
}

export const POST: RequestHandler = async ({ platform, params }) => {
  const env = platform!.env;
  const id = params.id!;
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare(
    `SELECT status, log_lines FROM jobs WHERE id = ?`
  ).bind(id).first<{ status: string; log_lines: string }>();
  if (!row) return json({ error: 'job not found' }, { status: 404 });

  if (row.status === 'running') {
    // Mark cancelled; runner picks it up on its next progress push.
    await env.DB.prepare(
      `UPDATE jobs SET cancelled = 1, updated_at = ? WHERE id = ?`
    ).bind(now, id).run();
    return json({ ok: true, message: 'cancel requested' });
  }

  if (row.status === 'pending') {
    // Nobody is running it; fail it immediately.
    await env.DB.prepare(
      `UPDATE jobs SET status = 'error', error = 'Cancelled by user (never started).',
              updated_at = ? WHERE id = ?`
    ).bind(now, id).run();
    return json({ ok: true, message: 'cancelled' });
  }

  // done / error / cancelled — nothing to do.
  return json({ ok: true, message: 'no-op' });
};
