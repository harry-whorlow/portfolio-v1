import type { APIRoute } from 'astro';

import { getMark, getMarks, leaveMark } from '../../data/marks';

export const prerender = false;

const COOKIE = 'said-hello';
// one hello per browser per day keeps the counts honest without remembering anything about the visitor
const COOKIE_SECONDS = 86_400;

interface Place {
  city: string;
  country: string;
  lat: number;
  lon: number;
}

// `astro dev` has no Netlify edge in front of it, and the adapter's stand-in is "Mock City" at 0,0, so dev reads
// DEV_HELLO_PLACE from .env instead ("Berlin,DE,52.52,13.40"). Missing or malformed, the hello is refused.
// A `?place=Zurich,CH,47.37,8.54` on the request wins over it, for dropping a hello anywhere while testing.
const devPlace = (override?: string | null): Place | undefined => {
  const [city, country, lat, lon] = String(override || import.meta.env.DEV_HELLO_PLACE || '')
    .split(',')
    .map((part: string) => part.trim());
  if (!city || !country || !lat || !lon || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    console.warn('[hello] set DEV_HELLO_PLACE=city,country,lat,lon in .env to say hello in dev');
    return undefined;
  }
  return { city, country, lat: Number(lat), lon: Number(lon) };
};

// matches the input's maxlength in components/Earth
const NAME_MAX_LENGTH = 50;

// the name is optional: anything missing, blank or not a string becomes null, and control characters are dropped
const readName = async (request: Request): Promise<string | null> => {
  try {
    const body = (await request.json()) as { name?: unknown };
    if (typeof body?.name !== 'string') return null;
    const name = body.name
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NAME_MAX_LENGTH);
    return name || null;
  } catch {
    return null;
  }
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...init.headers },
  });

export const GET: APIRoute = async () => {
  try {
    return json({ hellos: await getMarks() });
  } catch (error) {
    console.error('[hello] failed to read hellos', error);
    return json({ error: 'unavailable' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const name = await readName(request);

  // the city comes from Netlify's edge geolocation, so the IP never reaches this code or the database
  const geo = (locals as { netlify?: { context?: { geo?: NetlifyGeo } } }).netlify?.context?.geo;

  const place = import.meta.env.DEV
    ? devPlace(new URL(request.url).searchParams.get('place'))
    : geo?.city && geo.country?.code && geo.latitude != null && geo.longitude != null
      ? { city: geo.city, country: geo.country.code, lat: geo.latitude, lon: geo.longitude }
      : undefined;

  if (!place) return json({ error: 'location unknown' }, { status: 422 });

  try {
    if (cookies.has(COOKIE) && !import.meta.env.DEV) {
      const mark = await getMark(place.country, place.city);
      if (mark) return json({ hello: mark, isNew: false, repeat: true });
    }

    const { mark, isNew } = await leaveMark(place, name);
    cookies.set(COOKIE, '1', { path: '/', maxAge: COOKIE_SECONDS, httpOnly: true, sameSite: 'strict', secure: true });
    return json({ hello: mark, isNew });
  } catch (error) {
    console.error('[hello] failed to save hello', error);
    return json({ error: 'unavailable' }, { status: 503 });
  }
};

interface NetlifyGeo {
  city?: string;
  country?: { code?: string; name?: string };
  latitude?: number;
  longitude?: number;
}
