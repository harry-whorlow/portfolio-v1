import { neon } from '@neondatabase/serverless';

/**
 * Two kinds of mark share the globe:
 * - `hello`: one per city, the anonymous hellos. Its count leaves out any hello whose name is on display.
 * - `display`: one per name you've flagged `display = true` in "mark-time-series", at that hello's city, with the
 *   name always showing. Only flagged names ever leave the database.
 * A city with one anonymous hello and one displayed one shows both marks side by side.
 */
export type MarkType = 'hello' | 'display';

export interface Mark {
  /** The city's ledger id for a `hello`; the city's id and the name for a `display`, so each is stable. */
  id: string;
  type: MarkType;
  city: string;
  country: string;
  lat: number;
  lon: number;
  count: number;
  /** Set only on a `display` mark. */
  name: string | null;
  /** Set by hand in "mark-time-series" for a `display` mark; null when there isn't one. */
  organisation: string | null;
}

let client: ReturnType<typeof neon> | undefined;
// Netlify passes env vars on process.env at runtime, `astro dev` only has them on import.meta.env
const runtimeEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const sql = () => (client ??= neon(runtimeEnv?.DATABASE_URL ?? import.meta.env.DATABASE_URL));

// only the city's coordinates are kept, rounded to ~1km, never the visitor's IP
const round = (value: number) => Math.round(value * 100) / 100;

// A city whose every hello is on display has no anonymous ones left, so it gets no `hello` mark.
export const getMarks = async () => {
  const rows = (await sql()`
    WITH shown AS (
      -- a friend who said hi more than once keeps one mark, with the organisation from their latest hello that has one
      SELECT "mark-id", name, count(*)::int AS count,
        (array_agg(organisation ORDER BY "timestamp" DESC) FILTER (WHERE organisation IS NOT NULL))[1] AS organisation
      FROM "mark-time-series"
      WHERE display AND name IS NOT NULL
      GROUP BY "mark-id", name
    )
    SELECT l.id::text AS id, 'hello' AS type, l.city, l.country, l.lat, l.lon,
      (l.count - COALESCE((SELECT sum(s.count) FROM shown s WHERE s."mark-id" = l.id), 0))::int AS count,
      NULL::text AS name, NULL::text AS organisation
    FROM "mark-ledger" l
    UNION ALL
    SELECT l.id::text || ':' || s.name, 'display', l.city, l.country, l.lat, l.lon, s.count, s.name, s.organisation
    FROM shown s JOIN "mark-ledger" l ON l.id = s."mark-id"
  `) as Mark[];
  return rows.filter((mark) => mark.count > 0);
};

// the city's anonymous `hello` mark, for the visitor's own hello (a new name always starts hidden, so it's in here)
export const getMark = async (country: string, city: string) => {
  const rows = (await sql()`
    SELECT l.id::text AS id, 'hello' AS type, l.city, l.country, l.lat, l.lon,
      (l.count - (
        SELECT count(*) FROM "mark-time-series" t WHERE t."mark-id" = l.id AND t.display AND t.name IS NOT NULL
      ))::int AS count,
      NULL::text AS name, NULL::text AS organisation
    FROM "mark-ledger" l WHERE l.country = ${country} AND l.city = ${city}
  `) as Mark[];
  return rows[0];
};

// One statement, so two marks from the same city at once both count, and every mark is logged with its time. The
// new hello isn't on display yet, so what comes back is the city's anonymous `hello` mark, this hello included.
export const leaveMark = async (
  place: Pick<Mark, 'city' | 'country' | 'lat' | 'lon'>,
  name: string | null = null
): Promise<{ mark: Mark; isNew: boolean }> => {
  const [row] = (await sql()`
    WITH mark AS (
      INSERT INTO "mark-ledger" (country, city, lat, lon, count)
      VALUES (${place.country}, ${place.city}, ${round(place.lat)}, ${round(place.lon)}, 1)
      ON CONFLICT (country, city) DO UPDATE SET count = "mark-ledger".count + 1
      RETURNING id, city, country, lat, lon, count, (xmax = 0) AS inserted
    ), logged AS (
      INSERT INTO "mark-time-series" ("mark-id", "name") SELECT id, ${name} FROM mark
    )
    SELECT m.id::text AS id, 'hello' AS type, m.city, m.country, m.lat, m.lon, m.inserted,
      (m.count - (
        SELECT count(*) FROM "mark-time-series" t WHERE t."mark-id" = m.id AND t.display AND t.name IS NOT NULL
      ))::int AS count,
      NULL::text AS name, NULL::text AS organisation
    FROM mark m
  `) as (Mark & { inserted: boolean })[];
  const { inserted, ...mark } = row;
  return { mark, isNew: inserted };
};
