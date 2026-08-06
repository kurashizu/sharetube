// Active-job view model. The list-store polls /api/jobs; we mirror
// the entry whose ID the user is currently watching. The view stays
// cheap because the only reactive state we own is the *delta* between
// consecutive polls — coalesced into a single rAF flush.
//
// Why no SSE? On Cloudflare Workers + D1, SSE works but adds plumbing
// (request streaming, durable connections) that's overkill for a
// 1-Hz poll. With D1 row reads at <5ms per request and the Worker
// serving both SPA and API on the same origin, polling is simpler
// and faster to operate.

import type { JobEntry } from '../types';

const MAX_LOG_LINES = 2000;

class ActiveJobStore {
  /** ID of the job the user is currently focused on (null = none). */
  jobId = $state<string | null>(null);
  /** Snapshot of the watched job, refreshed on each poll. */
  job = $state<JobEntry | null>(null);

  private pendingLogLines: string[] = [];
  private rafScheduled = false;

  /** Switch focus to a different job (or clear). */
  set(id: string | null) {
    if (id === this.jobId) return;
    this.jobId = id;
    this.job = null;
    this.pendingLogLines = [];
  }

  /** Called from `+page.svelte` after each `jobsStore.refresh()`. */
  sync(jobs: JobEntry[]) {
    if (!this.jobId) return;
    const next = jobs.find((j) => j.id === this.jobId);
    if (!next) {
      // Job is gone (D1 trim / admin-deleted). Clear focus.
      this.job = null;
      return;
    }
    this.applyJob(next);
  }

  /** Merge a polled snapshot into reactive state. We always reassign
   *  `this.job` so any status / progress / meta change wakes the UI;
   *  for log lines we rAF-batch to avoid N renders per second when
   *  yt-dlp is chatty. */
  private applyJob(next: JobEntry) {
    const prev = this.job;
    const incomingLogs = next.log_lines;
    let newTail: string[] | null = null;
    if (prev) {
      // Detect only-the-tail-grew case so we keep the O(delta) write
      // path instead of reassigning the entire log array on every
      // poll. The server guarantees newest-at-end + a cap.
      const prevLen = Math.min(prev.log_lines.length, MAX_LOG_LINES);
      const incLen = Math.min(incomingLogs.length, MAX_LOG_LINES);
      if (incLen < prevLen) {
        // Server trimmed. Reassign.
        newTail = incomingLogs.slice();
      } else if (incLen === prevLen) {
        // Same length — update only if last line differs.
        if (
          incLen === 0 ||
          prev.log_lines[prevLen - 1] !== incomingLogs[incLen - 1]
        ) {
          newTail = incomingLogs.slice();
        }
      } else {
        // Strictly more lines. Compute delta and buffer it.
        // Coalesce with whatever rAF-batched lines are pending.
        const delta = incomingLogs.slice(prevLen);
        for (const line of delta) this.pendingLogLines.push(line);
      }
    } else {
      // First snapshot ever: take the whole tail into state at once.
      newTail = incomingLogs.slice();
    }

    if (newTail !== null) {
      // Reassign log; cap server should already do this but enforce
      // here too so a misbehaving server can't blow memory.
      const capped =
        newTail.length > MAX_LOG_LINES
          ? newTail.slice(newTail.length - MAX_LOG_LINES)
          : newTail;
      next = { ...next, log_lines: capped };
    } else if (this.pendingLogLines.length > 0) {
      this.scheduleFlush();
    }

    this.job = next;
  }

  private scheduleFlush() {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    const raf =
      typeof requestAnimationFrame !== 'undefined'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) =>
            setTimeout(() => cb(performance.now()), 16);
    raf(() => {
      this.rafScheduled = false;
      if (this.pendingLogLines.length === 0 || !this.job) return;
      const incoming = this.pendingLogLines;
      this.pendingLogLines = [];
      const merged = this.job.log_lines.concat(incoming);
      const capped =
        merged.length > MAX_LOG_LINES
          ? merged.slice(merged.length - MAX_LOG_LINES)
          : merged;
      this.job = { ...this.job, log_lines: capped };
    });
  }
}

export const activeJob = new ActiveJobStore();
