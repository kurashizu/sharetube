// Jobs list store — polls /api/jobs every POLL_MS and exposes a sorted
// array. Done/error jobs are kept in the list so the user can browse
// history and copy share links after the fact.

import { listJobs, startJob as apiStartJob } from '../api';
import type { CreateJobRequest, JobEntry } from '../types';

const POLL_MS = 1000;

class JobsStore {
  jobs = $state<JobEntry[]>([]);
  loading = $state<boolean>(false);
  error = $state<string | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private inflight = false;

  start() {
    if (this.timer) return;
    this.stopped = false;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force a refresh now. Coalesces with an in-flight poll to avoid
   *  hammering the Worker when many actions happen in quick succession. */
  async refresh() {
    if (this.stopped || this.inflight) return;
    this.inflight = true;
    this.loading = true;
    try {
      this.jobs = await listJobs();
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
      this.inflight = false;
    }
  }

  /** Submit a new job and immediately refresh the list so the user
   *  sees their submission at the top. */
  async submit(body: CreateJobRequest) {
    const res = await apiStartJob(body);
    await this.refresh();
    return res;
  }

  /** The currently active job (pending or running). */
  get active(): JobEntry | undefined {
    return this.jobs.find((j) => j.status === 'running' || j.status === 'pending');
  }

  /** History items: done / error only, newest first. */
  get history(): JobEntry[] {
    return this.jobs
      .filter((j) => j.status === 'done' || j.status === 'error')
      .slice()
      .sort((a, b) => b.created_at - a.created_at);
  }
}

export const jobsStore = new JobsStore();
