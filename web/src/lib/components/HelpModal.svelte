<script lang="ts">
  // Read-only "how does this work" panel. Content is intentionally kept
  // identical to the previous implementation; only the chrome changed.
  interface Props {
    open: boolean;
    onClose: () => void;
  }
  let { open = $bindable(), onClose }: Props = $props();

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="helpTitle"
       onclick={onBackdrop} onkeydown={(e) => e.key === 'Escape' && onClose()}
       tabindex="-1">
    <div class="modal-back" data-close></div>
    <div class="modal-card help" role="document">
      <header class="modal-head">
        <h2 id="helpTitle">Help</h2>
        <button class="x-close" type="button" data-close aria-label="Close"
                onclick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"
               stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="modal-body help-body">
        <section>
          <h3>Quick start</h3>
          <ol>
            <li>Paste a video URL and press <strong>RUN</strong>.</li>
            <li>The job goes into the queue. Up to 4 jobs run at once.</li>
            <li>Watch the three phases light up: Download &rarr; Transcode &rarr; Upload.</li>
            <li>When the share link appears, copy it — new links are valid for <strong>1 day</strong> by default.</li>
          </ol>
        </section>

        <section>
          <h3>What each phase does</h3>
          <dl>
            <dt>Download</dt>
            <dd>yt-dlp fetches the highest-resolution format up to your <em>Max source resolution</em> cap. DASH manifests pull video and audio streams with up to 8 parallel fragments.</dd>
            <dt>Transcode</dt>
            <dd>ffmpeg re-encodes to H.264 with your watermark burned in. The default macOS runner uses Apple VideoToolbox hardware encoding; Linux uses software libx264.</dd>
            <dt>Upload</dt>
            <dd>The transcoded MP4 is PUT to the share host and the share URL is returned.</dd>
          </dl>
        </section>

        <section>
          <h3>Supported sites</h3>
          <p>Anything <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md"
                          target="_blank" rel="noopener">yt-dlp supports</a> — YouTube and Bilibili are tested daily; many others work without any special configuration. Some sites require login cookies to bypass the bot wall.</p>
        </section>

        <section>
          <h3>Cancel a job</h3>
          <p>The <strong>X</strong> button on a running job sets a stop flag. The runner sees it within ~1s of its next progress push and aborts. If the runner is stuck inside a long transcode it gets force-killed after 90s.</p>
        </section>

        <section>
          <h3>Settings</h3>
          <p>Click the <strong>SETTINGS</strong> button in the top bar to tune per-job defaults. All settings live in your browser only — nothing is sent to the server until you actually submit a job.</p>
          <ul>
            <li><strong>Max source resolution</strong> — caps what yt-dlp is allowed to download. 720p is a sensible default.</li>
            <li><strong>Output resolution</strong> — what your share file is encoded at. Choose 2160p to keep the source size.</li>
            <li><strong>Video bitrate</strong> — lower = smaller file, lower quality. 600k is a good trade-off at 720p.</li>
            <li><strong>Audio bitrate</strong> — usually 128k is enough.</li>
            <li><strong>Runner</strong> — macOS Apple Silicon with VideoToolbox is selected by default; Linux with libx264 is available as an alternative.</li>
            <li><strong>Proxy</strong> — Cloudflare WARP is enabled by default and routes the whole runner through a WireGuard tunnel. Oracle Australia uses a secure SOCKS5 tunnel; Disabled uses the runner's normal network.</li>
            <li><strong>x264 encoder preset</strong> — applies to Linux; slower presets produce smaller files but take longer to encode.</li>
            <li><strong>TTL</strong> — how long the share link stays valid. It defaults to 1 day, and the history row is deleted at the same moment.</li>
          </ul>
        </section>

        <section>
          <h3>History</h3>
          <p>Finished jobs live in the right rail under <strong>History</strong>. Successful downloads are auto-deleted when their share URL expires; errored and cancelled jobs are kept for 1 day and then dropped. You can also wipe history manually with <strong>CLEAR ALL</strong>.</p>
        </section>

        <section>
          <h3>Privacy</h3>
          <p>By default, the macOS runner exits through Cloudflare WARP. You can choose the Oracle Australia SOCKS5 tunnel or disable the proxy in Settings. Cookies and the WARP account are encrypted and are decrypted only inside the runner; they are never exposed to the public Cloudflare Worker.</p>
        </section>

        <section>
          <h3>If something goes wrong</h3>
          <ul>
            <li><strong>"video unavailable"</strong> — the video is private, deleted, or region-locked. Try a different source.</li>
            <li><strong>"sign in to confirm you're not a bot"</strong> — the encrypted YouTube cookies may need refreshing. Retry later or contact the site administrator.</li>
            <li><strong>Stuck on "Working" forever</strong> — the queue is backed up, or GitHub Actions is throttling.</li>
            <li><strong>Share link doesn't work</strong> — it expired. Re-download and pick a longer TTL.</li>
          </ul>
        </section>
      </div>

      <footer class="modal-foot">
        <div style="flex: 1"></div>
        <button class="btn primary" type="button" data-close onclick={onClose}>got it</button>
      </footer>
    </div>
  </div>
{/if}