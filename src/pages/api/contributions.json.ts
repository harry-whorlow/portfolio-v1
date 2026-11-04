import type { APIRoute } from 'astro';

import { getContributions } from '../../data/contributions';

export const prerender = false;

const FRESH_SECONDS = 600;
const STALE_SECONDS = 86_400;
const RETRY_SECONDS = 60;

export const GET: APIRoute = async () => {
  const { weeks, fetched } = await getContributions();

  if (!fetched)
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${RETRY_SECONDS}`,
      },
    });

  return new Response(JSON.stringify({ weeks }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${FRESH_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
    },
  });
};
