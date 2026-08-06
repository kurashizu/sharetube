// POST /api/jobs/[id]/move — reorder the queue.
//
// Body: { direction: 'up' | 'down' }
//
// Only pending jobs can move (running/done/error are not in the
// queue). We swap `queue_pos` with the adjacent pending neighbour.

import { json, type RequestHandler } from '@sveltejs/kit';

interface Env {
  DB: D1Database;
}

export const POST: RequestHandler = async ({ request, platform, params }) => {
  const env = platform!.env;
  const id = params.id!;

  let direction: string;
  try {
    const body = await request.json();
    direction = body?.direction;
  } catch {
    direction = '';
  }
  if (direction !== 'up' && direction !== 'down') {
    return json({ error: "direction must be 'up' or 'down'" }, { status: 400 });
  }

  const row = await env.DB.prepare(
    `SELECT status, queue_pos FROM jobs WHERE id = ?`
  ).bind(id).first<{ status: string; queue_pos: number }>();
  if (!row) return json({ error: 'job not found' }, { status: 404 });
  if (row.status !== 'pending') {
    return json({ error: 'only queued (pending) jobs can be reordered' }, { status: 409 });
  }

  // Find the adjacent pending neighbour.
  const order = direction === 'up' ? 'DESC' : 'ASC';
  const cmp = direction === 'up' ? '<' : '>';
  const neighbour = await env.DB.prepare(
    `SELECT id, queue_pos FROM jobs
      WHERE status = 'pending' AND queue_pos ${cmp} ?
      ORDER BY queue_pos ${order} LIMIT 1`
  ).bind(row.queue_pos).first<{ id: string; queue_pos: number }>();
  if (!neighbour) {
    // Already at the edge of the queue.
    return json({ ok: true, message: 'no-op (edge of queue)' });
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(`UPDATE jobs SET queue_pos = ?, updated_at = ? WHERE id = ?`)
      .bind(neighbour.queue_pos, now, id),
    env.DB.prepare(`UPDATE jobs SET queue_pos = ?, updated_at = ? WHERE id = ?`)
      .bind(row.queue_pos, now, neighbour.id),
  ]);
  return json({ ok: true });
};
