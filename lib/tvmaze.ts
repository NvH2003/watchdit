const BASE_URL = 'https://api.tvmaze.com';
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'watchdit/1.0 (https://github.com/NvH2003/watchdit)',
};

export type TvmazeShow = {
  id: number;
  name: string;
  url: string;
  externals?: {
    tvrage?: number | null;
    thetvdb?: number | null;
    imdb?: string | null;
  };
};

export type TvmazeEpisode = {
  id: number;
  name: string;
  season: number;
  number: number | null;
  airdate?: string | null;
  runtime?: number | null;
  summary?: string | null;
  image?: { medium?: string | null; original?: string | null } | null;
};

type SearchHit = { score: number; show: TvmazeShow };

const showCache = new Map<string, Promise<TvmazeShow | null>>();
const episodeCache = new Map<number, Promise<TvmazeEpisode[]>>();

async function getJson<T>(path: string, params: Record<string, string> = {}, attempt = 0): Promise<T | null> {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v) url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (res.status === 404) return null;
  if (res.status === 429 && attempt < 2) {
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    return getJson<T>(path, params, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

function cacheKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export async function lookupTvmazeShow(opts: {
  imdbId?: string | null;
  tvdbId?: number | null;
  names?: (string | null | undefined)[];
}): Promise<TvmazeShow | null> {
  const imdb = opts.imdbId?.trim();
  if (imdb) {
    const key = cacheKey('imdb', imdb);
    let pending = showCache.get(key);
    if (!pending) {
      pending = getJson<TvmazeShow>('/lookup/shows', { imdb });
      showCache.set(key, pending);
    }
    const found = await pending;
    if (found) return found;
  }

  const tvdb = opts.tvdbId;
  if (tvdb && Number.isFinite(tvdb) && tvdb > 0) {
    const key = cacheKey('tvdb', String(tvdb));
    let pending = showCache.get(key);
    if (!pending) {
      pending = getJson<TvmazeShow>('/lookup/shows', { thetvdb: String(tvdb) });
      showCache.set(key, pending);
    }
    const found = await pending;
    if (found) return found;
  }

  for (const raw of opts.names ?? []) {
    const q = raw?.trim();
    if (!q) continue;
    const key = cacheKey('search', q.toLowerCase());
    let pending = showCache.get(key);
    if (!pending) {
      pending = pickSearchMatch(q);
      showCache.set(key, pending);
    }
    const found = await pending;
    if (found) return found;
  }

  return null;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function pickSearchMatch(query: string): Promise<TvmazeShow | null> {
  const hits = await getJson<SearchHit[]>('/search/shows', { q: query });
  if (!hits?.length) return null;
  const want = normalizeName(query);
  const exact = hits.find(h => normalizeName(h.show.name) === want);
  if (exact) return exact.show;
  const close = hits.find(h => h.score >= 0.8 && normalizeName(h.show.name).includes(want));
  if (close) return close.show;
  return hits[0].score >= 0.9 ? hits[0].show : null;
}

export async function getTvmazeEpisodes(showId: number): Promise<TvmazeEpisode[]> {
  let pending = episodeCache.get(showId);
  if (!pending) {
    pending = (async () => {
      const eps = await getJson<TvmazeEpisode[]>(`/shows/${showId}/episodes`);
      return (eps ?? []).filter(e => e.season > 0 && e.number != null && e.number > 0);
    })();
    episodeCache.set(showId, pending);
  }
  return pending;
}
