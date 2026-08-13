// User settings store — persisted in localStorage only.
//
// All settings travel with each job submission (the runner picks them
// up via the dispatch payload); there is no central /api/config
// endpoint anymore because the backend is GitHub Actions with no
// shared persistent state across runs.

import type { UserSettings } from '../types';

const STORAGE_KEY = 'sharetube:settings:v1';

export const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '1440p', '2160p'];
// libx264 -preset values, fastest → slowest. The runner whitelists
// this exact set (see runner/config.py X264_PRESETS); anything else
// is silently dropped to the default.
export const ENCODER_PRESET_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  hint: string;
}> = [
  { value: 'ultrafast', label: 'Ultrafast', hint: 'Fastest encode, largest file' },
  { value: 'fast',      label: 'Fast',      hint: 'Default — good balance' },
  { value: 'medium',    label: 'Medium',    hint: 'Slower encode, smaller file' },
  { value: 'slow',      label: 'Slow',      hint: 'Smallest file, longest encode' }
];
export const TTL_PRESETS: ReadonlyArray<readonly [string, number]> = [
  ['5 min', 5 * 60],
  ['1 h', 60 * 60],
  ['6 h', 6 * 60 * 60],
  ['1 day', 24 * 60 * 60],
  ['3 days', 3 * 24 * 60 * 60],
  ['7 days', 7 * 24 * 60 * 60]
];

export const DEFAULT_SETTINGS: UserSettings = {
  max_resolution: '720p',
  output_resolution: '720p',
  video_bitrate: '600k',
  audio_bitrate: '128k',
  ttl_seconds: 6 * 60 * 60,
  // Watermark is always applied (branding); not a user choice.
  watermark_enabled: true,
  watermark_line1: 'sharetube.krsz.in',
  watermark_line2: '{title} · {resolution} · {duration}',
  watermark_font_size: 28,
  // libx264 preset; same default as runner/config.py. Fast gives a
  // good speed/size trade-off for typical downloads.
  encoder_preset: 'fast',
  // Default to the Linux runner — cheaper, proven path. Mac is opt-in
  // for users who want the ~3x hardware-encode speedup; the toggle
  // lives in the Settings modal.
  runner: 'linux',
  // Cookies are always used (bot wall). The option is no longer
  // exposed in the UI; kept in the type only for stored settings
  // from older clients.
  use_cookies: true,
  // Oracle Australia avoids datacenter IP bot walls. Cloudflare WARP
  // uses the encrypted account profile and a full WireGuard tunnel.
  proxy_mode: 'oracle-australia'
};

/** Read a stored setting, falling back to default. */
function readStored(): UserSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStored(settings: UserSettings) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* quota or disabled — best-effort */
  }
}

class ConfigStore {
  /** Reactive copy of the user's settings. */
  settings = $state<UserSettings>({ ...DEFAULT_SETTINGS });

  /** Load from localStorage on init. Idempotent. */
  load() {
    this.settings = readStored();
  }

  /** Update a single setting and persist. */
  update<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    this.settings = { ...this.settings, [key]: value };
    writeStored(this.settings);
  }

  /** Replace all settings and persist. */
  save(next: UserSettings) {
    this.settings = { ...next };
    writeStored(this.settings);
  }

  /** Reset to defaults and persist. */
  reset() {
    this.save({ ...DEFAULT_SETTINGS });
  }
}

export const configStore = new ConfigStore();
