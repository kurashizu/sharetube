<script lang="ts">
  // Read-only "how does this work" panel. Opened from the Header's
  // `?` button; closes on backdrop click, Escape, or the ✕ button.
  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open = $bindable(), onClose }: Props = $props();

  function onBackdrop(e: MouseEvent) {
    // Only close when the user clicks the backdrop itself, not the
    // modal panel (the inner div stops propagation implicitly via
    // target check below).
    if (e.target === e.currentTarget) onClose();
  }
</script>

{#if open}
  <div
    class="modal-backdrop"
    onclick={onBackdrop}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="help-title"
    tabindex="-1"
  >
    <div class="modal help-modal">
      <div class="modal-header">
        <h2 class="modal-title" id="help-title">Help</h2>
        <button class="icon-btn" onclick={onClose} aria-label="Close help">✕</button>
      </div>

      <div class="modal-body help-body">
        <section class="help-section">
          <h3>Quick start</h3>
          <ol>
            <li>Paste a video URL and press <b>Download</b>.</li>
            <li>The job goes into the queue. Up to <b>4 jobs</b> run at once.</li>
            <li>Watch the three phases light up: <b>Download → Transcode → Upload</b>.</li>
            <li>When the share link appears, copy it — it expires when its TTL runs out.</li>
          </ol>
        </section>

        <section class="help-section">
          <h3>What each phase does</h3>
          <dl>
            <dt>Download</dt>
            <dd>yt-dlp fetches the highest-resolution format up to your <i>Max source resolution</i> cap. DASH manifests pull video and audio streams with up to 8 parallel fragments.</dd>
            <dt>Transcode</dt>
            <dd>ffmpeg re-encodes to h264 with your watermark burned in. Uses software libx264 unless a GPU is available.</dd>
            <dt>Upload</dt>
            <dd>The transcoded MP4 is PUT to the share host and the share URL is returned.</dd>
          </dl>
        </section>

        <section class="help-section">
          <h3>Supported sites</h3>
          <p>Anything <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md" target="_blank" rel="noopener">yt-dlp supports</a> — YouTube and Bilibili are tested daily; many others work without any special configuration. Some sites require login cookies to bypass the bot wall.</p>
        </section>

        <section class="help-section">
          <h3>Cancel a job</h3>
          <p>The <b>×</b> button on a running job sets a stop flag. The runner sees it within ~1s of its next progress push and aborts. If the runner is stuck inside a long transcode it gets force-killed after 90s.</p>
        </section>

        <section class="help-section">
          <h3>Settings</h3>
          <p>Click the gear icon (⚙) to tune per-job defaults. All settings live in your browser only — nothing is sent to the server until you actually submit a job.</p>
          <ul>
            <li><b>Max source resolution</b> — caps what yt-dlp is allowed to download. 720p is a sensible default.</li>
            <li><b>Output resolution</b> — what your share file is encoded at. Choose 2160p to keep the source size.</li>
            <li><b>Video bitrate</b> — lower = smaller file, lower quality. 600k is a good trade-off at 720p.</li>
            <li><b>Audio bitrate</b> — usually 128k is enough.</li>
            <li><b>Proxy</b> — Oracle Australia is enabled by default; Cloudflare WARP is shown as a placeholder and is not implemented yet.</li>
            <li><b>x264 encoder preset</b> — slower presets produce smaller files but take longer to encode.</li>
            <li><b>TTL</b> — how long the share link stays valid. The history row is deleted at the same moment.</li>
          </ul>
        </section>

        <section class="help-section">
          <h3>History</h3>
          <p>Finished jobs live in the sidebar under <b>History</b>. Successful downloads are auto-deleted when their share URL expires; errored and cancelled jobs are kept for 1 day and then dropped. You can also wipe history manually with <b>Clear all</b>.</p>
        </section>

        <section class="help-section">
          <h3>Privacy</h3>
          <p>By default, the runner exits through a fixed Oracle Australia IP via a SOCKS5 tunnel. You can disable the proxy in Settings; Cloudflare WARP is currently a placeholder. Cookies only travel through the Oracle tunnel when it is enabled; they are not exposed to the public Cloudflare Worker.</p>
        </section>

        <section class="help-section">
          <h3>If something goes wrong</h3>
          <ul>
            <li><b>"video unavailable"</b> — the video is private, deleted, or region-locked. Try a different source.</li>
            <li><b>"sign in to confirm you're not a bot"</b> — the cookies for that site need refreshing. Out of scope for this build.</li>
            <li><b>Stuck on "Working" forever</b> — the queue is backed up, or GitHub Actions is throttling. The status pill shows what's happening.</li>
            <li><b>Share link doesn't work</b> — it expired. Re-download and pick a longer TTL.</li>
          </ul>
        </section>
      </div>

      <div class="modal-footer">
        <div style="flex: 1"></div>
        <button class="btn btn-primary" onclick={onClose}>Got it</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .help-modal {
    max-width: 640px;
    width: calc(100vw - 32px);
  }
  .help-body {
    padding: 16px 24px;
    overflow-y: auto;
    max-height: min(70vh, 640px);
  }
  .help-section {
    margin-bottom: 18px;
  }
  .help-section:last-child {
    margin-bottom: 0;
  }
  .help-section h3 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-muted);
    margin: 0 0 8px 0;
    font-weight: 600;
  }
  .help-section p,
  .help-section li,
  .help-section dd {
    font-size: 13px;
    line-height: 1.55;
    color: var(--text);
    margin: 0 0 6px 0;
  }
  .help-section ol,
  .help-section ul {
    margin: 0 0 6px 0;
    padding-left: 20px;
  }
  .help-section dl {
    margin: 0;
  }
  .help-section dt {
    font-size: 13px;
    font-weight: 600;
    margin-top: 6px;
  }
  .help-section dt:first-child {
    margin-top: 0;
  }
  .help-section dd {
    margin-left: 0;
  }
  .help-section a {
    color: var(--accent);
    text-decoration: none;
  }
  .help-section a:hover {
    text-decoration: underline;
  }
</style>