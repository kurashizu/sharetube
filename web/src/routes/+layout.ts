// Pure SPA — everything is rendered client-side after the initial
// hydration. The Worker routes /api/* via SvelteKit's server endpoints
// regardless of this flag.
export const prerender = false;
export const ssr = false;
