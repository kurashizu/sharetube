// Thin same-origin fetch wrappers. The Worker serves both the SPA and
// the /api/* endpoints, so no CORS or base URL is needed.

import type {
  ApiError,
  CreateJobRequest,
  CreateJobResponse,
  JobEntry
} from './types';

async function asJson<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const data = (await r.json()) as ApiError;
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

/** List all jobs (newest first). Used by the polling jobs store. */
export async function listJobs(): Promise<JobEntry[]> {
  const data = await asJson<{ jobs: JobEntry[] }>(
    await fetch('/api/jobs', { headers: { Accept: 'application/json' } })
  );
  return data.jobs;
}

/** Fetch one job by ID (used on initial job click). */
export async function getJob(id: string): Promise<JobEntry> {
  return asJson<JobEntry>(
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' }
    })
  );
}

/** Submit a new job. The Worker inserts a D1 row and dispatches a
 *  GitHub Actions workflow run via `repository_dispatch`. */
export async function startJob(body: CreateJobRequest): Promise<CreateJobResponse> {
  return asJson<CreateJobResponse>(
    await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    })
  );
}

/** Move a queued (pending) job up/down. */
export async function moveJob(id: string, direction: 'up' | 'down'): Promise<void> {
  await asJson<{ ok: boolean }>(
    await fetch(`/api/jobs/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction })
    })
  );
}

/** Force-stop a running job (or cancel a pending one). */
export async function cancelJob(id: string): Promise<void> {
  await asJson<{ ok: boolean }>(
    await fetch(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
      method: 'POST'
    })
  );
}

/** Hard-delete a job row from the list. */
export async function deleteJob(id: string): Promise<void> {
  await asJson<{ ok: boolean }>(
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  );
}
