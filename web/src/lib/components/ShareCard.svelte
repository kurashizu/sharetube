<script lang="ts">
  interface Props {
    shareUrl: string;
    directUrl: string;
    expiresAt: number;
  }

  let { shareUrl, directUrl, expiresAt }: Props = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function copy() {
    void navigator.clipboard.writeText(directUrl).then(() => {
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1800);
    });
  }

  function formatExpiry(ts: number): string {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleString();
  }
</script>

<section class="card share-card">
  <div class="share-label">Share link</div>
  <div class="share-row">
    <input value={directUrl} readonly />
    <button class="btn btn-success" onclick={copy}>
      {copied ? '✓ Copied' : 'Copy link'}
    </button>
  </div>
  <div class="share-row" style="margin-top: 0.25rem">
    <a href={shareUrl} target="_blank" rel="noopener" class="share-open">
      ↗ Open viewer
    </a>
    <span class="share-meta">Expires {formatExpiry(expiresAt)}</span>
  </div>
</section>
