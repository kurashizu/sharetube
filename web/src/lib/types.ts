// Shared shapes. Mirror the Worker / D1 row format produced by
// `web/src/routes/api/jobs/+server.ts` and consumed by the frontend.

export type PhaseName = 'Download' | 'Transcode' | 'Upload';

/** Lifecycle status of a job. */
export type JobStatus = 'pending' | 'running' | 'done' | 'error';

/** Per-job settings snapshot, echoed back in the GET response so the UI
 *  can show what the user submitted. */
export interface JobConfig {
  max_resolution: string;
  output_resolution: string;
  video_bitrate: string;
  audio_bitrate: string;
  ttl_seconds: number;
  watermark_enabled: boolean;
  watermark_line1: string;
  watermark_line2: string;
  watermark_font_size: number;
  /** When true, the runner decrypts the repo's `secrets/cookies.txt.enc`
   *  with the `COOKIES_PASS` GH secret and passes the resulting file to
   *  yt-dlp via `--cookies`. Use false to skip cookies entirely. */
  use_cookies: boolean;
}

/** Per-phase progress snapshot, sent with each update from the runner. */
export interface PhaseProgress {
  Download: number;
  Transcode: number;
  Upload: number;
}

/** The shape returned by `GET /api/jobs` and `GET /api/jobs/[id]`. */
export interface JobEntry {
  id: string;
  url: string;
  /** Original (user-supplied) URL — never mutated. */
  status: JobStatus;
  /** Current phase label (Download / Transcode / Upload). null if
   *  the runner hasn't reported a phase yet (still pending). */
  phase: PhaseName | null;
  /** Per-phase pct, 0..100 each. Always populated (sentinel 0 until
   *  the runner reports). */
  phase_progress: PhaseProgress;
  /** Per-phase meta string (e.g. "5.2MB/s"). Indexed by phase name. */
  phase_meta: Partial<Record<PhaseName, string>>;
  /** Last N log lines, newest at the end. Capped server-side. */
  log_lines: string[];
  /** Share URL returned by the upload step (only present on `done`). */
  share_url: string | null;
  /** Direct download URL bypassing the HTML viewer page. */
  direct_url: string | null;
  /** Unix epoch seconds; null until done. */
  expires_at: number | null;
  /** Error message (only on `error`). */
  error: string | null;
  config: JobConfig;
  created_at: number;
  updated_at: number;
}

/** Body of `POST /api/jobs`. */
export interface CreateJobRequest {
  url: string;
  config: JobConfig;
}

export interface CreateJobResponse {
  id: string;
  status: JobStatus;
}

/** Body of `POST /api/internal/update` (auth via Bearer token). */
export interface UpdateRequest {
  id: string;
  status?: JobStatus;
  phase?: PhaseName;
  phase_progress?: Partial<PhaseProgress>;
  phase_meta?: Partial<Record<PhaseName, string>>;
  append_log?: string[];
  share_url?: string;
  direct_url?: string;
  expires_at?: number;
  error?: string;
}

/** Settings the user persists in localStorage; sent on each job. */
export interface UserSettings {
  max_resolution: string;
  output_resolution: string;
  video_bitrate: string;
  audio_bitrate: string;
  ttl_seconds: number;
  watermark_enabled: boolean;
  watermark_line1: string;
  watermark_line2: string;
  watermark_font_size: number;
  /** When true, the runner uses the cookies.txt bundled (encrypted) in
   *  the repo. Most videos work without; only required for some that
   *  trigger YouTube's bot wall. */
  use_cookies: boolean;
}

export interface ApiError {
  error: string;
}
