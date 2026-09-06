// POST /api/jobs/[id]/cancel — request a force-stop of a running job.
//
// Sets `cancelled = 1` and appends a log line. The runner checks the
// `cancelled` flag in the internal update response on every push and
// aborts the pipeline, then reports status=error "cancelled by user".
// Pending jobs are simply transitioned to error right away (no runner
// has claimed them yet).
//
// Restricted to the job's owner (the `st_owner` cookie set at enqueue)
// so a visitor cannot force-stop somebody else's work.

import { json, type RequestHandler } from '@sveltejs/kit';
import { dispatchPending } from '$lib/server/dispatch';
import {
  MUTATE_LIMIT,
  MUTATE_WINDOW_S,
  checkRateLimit,
  clientIp,
  currentOwner,
  ownsJob
} from '$lib/server/guard';

interface Env {
  DB: D1Database;
}

export const POST: RequestHandler = async ({ request, platform, params, cookies }) => {
  const env = platform!.env;
  const id = params.id!;
  const now = Math.floor(Date.now() / 1000);

  const rl = await checkRateLimit(
    env, 'mutate', clientIp(request), MUTATE_LIMIT, MUTATE_WINDOW_S
  );
  if (!rl.ok) {
    return json({ error: 'Too many requests.' }, {
      status: 429, headers: { 'Retry-After': String(rl.retryAfter) }
    });
  }

  const row = await env.DB.prepare(
    `SELECT status, log_lines, owner FROM jobs WHERE id = ?`
  ).bind(id).first<{ status: string; log_lines: string; owner: string | null }>();
  if (!row) return json({ error: 'job not found' }, { status: 404 });
  if (!ownsJob(row.owner, currentOwner(cookies))) {
    return json({ error: 'not your job' }, { status: 403 });
  }

  if (row.status === 'running') {
    // Mark cancelled; runner picks it up on its next progress push.
    // Record when so zombie cleanup can force-error if the runner
    // never reports back.
    await env.DB.prepare(
      `UPDATE jobs SET cancelled = 1, cancelled_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, id).run();
    return json({ ok: true, message: 'cancel requested' });
  }

  if (row.status === 'pending') {
    // Nobody is running it; fail it immediately.
    await env.DB.prepare(
      `UPDATE jobs SET status = 'error', error = 'Cancelled by user (never started).',
              updated_at = ? WHERE id = ?`
    ).bind(now, id).run();
    // A queued slot opened — schedule the next job in line.
    await dispatchPending(env);
    return json({ ok: true, message: 'cancelled' });
  }

  // done / error / cancelled — nothing to do.
  return json({ ok: true, message: 'no-op' });
};
