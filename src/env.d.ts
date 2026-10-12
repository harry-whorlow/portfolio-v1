import type { PostHog } from 'posthog-js';

declare global {
  interface Window {
    // Set by the inline snippet in src/components/posthog.astro; absent when env vars are missing.
    posthog?: PostHog;
  }
}
