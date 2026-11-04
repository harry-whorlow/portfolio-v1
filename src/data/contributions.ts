import { GITHUB_USER, OPEN_SOURCE } from '../config/contributions';

export interface ContributionDay {
  date: string;
  weekday: number;
  openSource: number;
  personal: number;
}

export interface ContributionYear {
  weeks: ContributionDay[][];
  totals: { openSource: number; personal: number };
  fetched?: boolean;
}

interface IssueItem {
  created_at: string;
  repository_url: string;
}

interface CommitItem {
  commit: { author: { date: string } };
  repository: { full_name: string };
}

const SEARCH = 'https://api.github.com/search';
const PER_PAGE = 100;
const MAX_PAGES = 10;
const DAY_MS = 86_400_000;
const KEEP_MS = 10 * 60_000;
const RETRY_MS = 60_000;
const DISK_CACHE = 'node_modules/.cache/portfolio/contributions.json';

const patterns = OPEN_SOURCE.map((entry) => entry.toLowerCase());

const isOpenSource = (nameWithOwner: string) => {
  const name = nameWithOwner.toLowerCase();
  const owner = name.split('/')[0];
  return patterns.some((pattern) => (pattern.includes('/') ? pattern === name : pattern === owner));
};

const dateOf = (timestamp: string) => new Date(timestamp).toISOString().slice(0, 10);

const search = async <T>(endpoint: 'commits' | 'issues', q: string): Promise<T[]> => {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({ q, per_page: String(PER_PAGE), page: String(page) });
    const response = await fetch(`${SEARCH}/${endpoint}?${params}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'portfolio-contribution-graph' },
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`GitHub search ${response.status}: ${json.message ?? JSON.stringify(json)}`);
    items.push(...json.items);
    if (json.items.length < PER_PAGE || items.length >= json.total_count) break;
  }
  return items;
};

const fetchContributions = async (from: string) => {
  const [commits, pullRequests, reviews] = await Promise.all([
    search<CommitItem>('commits', `author:${GITHUB_USER} author-date:>=${from}`),
    search<IssueItem>('issues', `type:pr author:${GITHUB_USER} created:>=${from}`),
    search<IssueItem>('issues', `type:pr reviewed-by:${GITHUB_USER} -author:${GITHUB_USER} created:>=${from}`),
  ]);

  return [
    ...commits.map((item) => ({ date: dateOf(item.commit.author.date), repo: item.repository.full_name })),
    ...[...pullRequests, ...reviews].map((item) => ({
      date: dateOf(item.created_at),
      repo: item.repository_url.split('/repos/')[1],
    })),
  ];
};

const emptyYear = (): ContributionYear => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = today.getTime() - (52 * 7 + today.getUTCDay()) * DAY_MS;
  const weeks: ContributionDay[][] = [];
  for (let t = start; t <= today.getTime(); t += DAY_MS) {
    const date = new Date(t);
    if (date.getUTCDay() === 0) weeks.push([]);
    weeks
      .at(-1)!
      .push({ date: date.toISOString().slice(0, 10), weekday: date.getUTCDay(), openSource: 0, personal: 0 });
  }
  return { weeks, totals: { openSource: 0, personal: 0 } };
};

const loadContributions = async (): Promise<ContributionYear> => {
  const year = emptyYear();
  const byDate = new Map(year.weeks.flat().map((day) => [day.date, day]));

  try {
    for (const { date, repo } of await fetchContributions(year.weeks[0][0].date)) {
      const day = byDate.get(date);
      if (!day) continue;
      const key = isOpenSource(repo) ? 'openSource' : 'personal';
      day[key] += 1;
      year.totals[key] += 1;
    }
    return { ...year, fetched: true };
  } catch (error) {
    console.error('[contributions] failed to fetch, rendering an empty contribution graph', error);
    return year;
  }
};

interface FileSystem {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
}

const fileSystem = () => import(/* @vite-ignore */ 'node:fs/promises' as string) as Promise<FileSystem>;

const readDisk = async (): Promise<{ at: number; year: ContributionYear } | undefined> => {
  try {
    const entry = JSON.parse(await (await fileSystem()).readFile(DISK_CACHE, 'utf8'));
    return Date.now() - entry.at < KEEP_MS ? entry : undefined;
  } catch {
    return undefined;
  }
};

const writeDisk = async (year: ContributionYear) => {
  try {
    const fs = await fileSystem();
    await fs.mkdir(DISK_CACHE.slice(0, DISK_CACHE.lastIndexOf('/')), { recursive: true });
    await fs.writeFile(DISK_CACHE, JSON.stringify({ at: Date.now(), year }));
  } catch {}
};

interface CacheEntry {
  at: number;
  ttl: number;
  year: Promise<ContributionYear>;
}

let cached: CacheEntry | undefined;

const fill = async (entry: CacheEntry) => {
  const disk = await readDisk();
  if (disk) {
    entry.at = disk.at;
    return disk.year;
  }
  const year = await loadContributions();
  if (year.fetched) await writeDisk(year);
  else entry.ttl = RETRY_MS;
  return year;
};

export const getContributions = () => {
  if (cached && Date.now() - cached.at < cached.ttl) return cached.year;
  const entry = { at: Date.now(), ttl: KEEP_MS } as CacheEntry;
  entry.year = fill(entry);
  cached = entry;
  return entry.year;
};
