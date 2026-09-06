<script lang="ts">
  // Root layout: imports the design system CSS and provides a global click
  // handler for the inline `.copy` buttons used in share cards / logs.
  // Falls back to a hidden textarea + execCommand when the async clipboard
  // API is missing or blocked (older Safari, http preview, etc.).
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    function fallbackCopy(text: string): boolean {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }

    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest?.('.copy') as HTMLElement | null;
      if (!btn) return;
      e.preventDefault();
      const url = btn.getAttribute('data-copy') || '';
      if (!url) return;
      if (navigator?.clipboard?.writeText) {
        void navigator.clipboard.writeText(url).then(() => flash(btn));
      } else if (fallbackCopy(url)) {
        flash(btn);
      }
    });

    function flash(btn: Element) {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1400);
    }

    // Inline <video> error fallback: replace with a friendly block +
    // download / open-viewer actions so the user can still play it.
    document.querySelectorAll('video.preview').forEach((v) => {
      v.addEventListener(
        'error',
        () => {
          if ((v as HTMLVideoElement).dataset.fallback === '1') return;
          (v as HTMLVideoElement).dataset.fallback = '1';
          const dl = (v as HTMLVideoElement).getAttribute('src') ?? '';
          const wrap = document.createElement('div');
          // Utility classes rather than a component: this node is built
          // imperatively from a capture-phase listener, outside Svelte.
          wrap.className =
            'flex flex-col items-center gap-2 rounded-md border border-rule ' +
            'bg-surface px-4 py-8 text-center';
          wrap.innerHTML =
            '<p class="text-sm text-[--fg-2]">preview unavailable</p>' +
            '<p class="text-xs text-mute">open the file directly to play it locally.</p>' +
            (dl
              ? '<a class="mt-2 inline-flex h-9 items-center rounded-md bg-primary ' +
                'px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90" ' +
                'href="' + dl + '">download</a>'
              : '');
          v.replaceWith(wrap);
        },
        true
      );
    });
  });
</script>

{@render children()}