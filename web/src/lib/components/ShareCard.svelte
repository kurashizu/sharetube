<script lang="ts">
  // Standalone share card. JobCard composes an inline share card now,
  // but this component is kept for any other surface that imports it.
  // Same chrome token as the rest of the page.
  interface Props {
    shareUrl: string;
    directUrl: string;
    expiresAt?: number;
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
</script>

<section class="job share card-like">
  <header class="job-head">
    <span class="dot ok"></span>
    <span class="title">share ready</span>
    <span class="grow"></span>
    <span class="state done">done</span>
  </header>
  <div class="share-bar">
    <input class="url" readonly value={directUrl}
           aria-label="Direct download link" />
    <button class="btn primary copy" type="button" onclick={copy}>
      <span class="lbl">copy</span>
      <span class="ok">copied</span>
    </button>
  </div>
  <a href={shareUrl} target="_blank" rel="noopener">open viewer</a>
  {#if expiresAt}
    <div class="meta">expires {new Date(expiresAt).toLocaleString()}</div>
  {/if}
</section>