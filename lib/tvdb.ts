import { TmdbEpisode, TmdbSeasonSummary } from './tmdb';

const BASE_URL = 'https://api4.thetvdb.com/v4';
const TVDB_EPISODE_ID_OFFSET = 2_000_000_000;

export type NetflixCatalog = {
  tvdbId: number;
  url: string;
  seasons: TmdbSeasonSummary[];
  episodes: TmdbEpisode[];
};

type TvdbSeasonType = {
  id?: number;
  name?: string | null;
  type?: string | null;
  alternateName?: string | null;
};

type TvdbSeason = {
  id?: number;
  number?: number | null;
  type?: TvdbSeasonType | null;
};

type TvdbSeries = {
  slug?: string | null;
  seasons?: TvdbSeason[] | null;
  seasonTypes?: TvdbSeasonType[] | null;
};

type TvdbEpisode = {
  id?: number;
  name?: string | null;
  aired?: string | null;
  runtime?: number | null;
  overview?: string | null;
  image?: string | null;
  number?: number | null;
  seasonNumber?: number | null;
};

type SeasonExtended = {
  episodes?: TvdbEpisode[] | null;
};

let tokenPromise: Promise<string | null> | null = null;

export function tvdbConfigured(): boolean {
  return !!process.env.EXPO_PUBLIC_TVDB_API_KEY?.trim();
}

export function isTvdbEpisode(id?: number | null): boolean {
  return id != null && id >= TVDB_EPISODE_ID_OFFSET;
}

function isNetflixLabel(type?: TvdbSeasonType | null): boolean {
  return /netflix/i.test(`${type?.alternateName ?? ''} ${type?.name ?? ''}`);
}

export function netflixSeasons(series: TvdbSeries | null): TvdbSeason[] {
  const seasons = (series?.seasons ?? []).filter(season => (season.number ?? 0) > 0 && season.id);
  const labeled = seasons.filter(season => isNetflixLabel(season.type));
  if (labeled.length > 0) return labeled;
  const typeSlugs = new Set(
    (series?.seasonTypes ?? []).filter(isNetflixLabel).map(type => type.type).filter(Boolean)
  );
  if (typeSlugs.size === 0) return [];
  return seasons.filter(season => season.type?.type && typeSlugs.has(season.type.type));
}

function tvdbImage(image?: string | null): string | null {
  const path = image?.trim();
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return `https://artworks.thetvdb.com${path}`;
  return `https://artworks.thetvdb.com/banners/${path}`;
}

function tvdbAirDate(aired?: string | null): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec((aired ?? '').trim());
  return match ? match[1] : '';
}

function mapEpisode(ep: TvdbEpisode, seasonNumber: number): TmdbEpisode | null {
  const episodeNumber = Number(ep.number);
  const season = Number(ep.seasonNumber) > 0 ? Number(ep.seasonNumber) : seasonNumber;
  if (!Number.isFinite(episodeNumber) || episodeNumber < 1) return null;
  if (!Number.isFinite(season) || season < 1) return null;
  const id = Number(ep.id);
  return {
    id: Number.isFinite(id) ? TVDB_EPISODE_ID_OFFSET + id : TVDB_EPISODE_ID_OFFSET + season * 1000 + episodeNumber,
    episode_number: episodeNumber,
    season_number: season,
    name: ep.name?.trim() || `Episode ${episodeNumber}`,
    overview: ep.overview?.trim() ?? '',
    air_date: tvdbAirDate(ep.aired),
    still_path: tvdbImage(ep.image),
    runtime: ep.runtime ?? null,
  };
}

async function getToken(): Promise<string | null> {
  const apikey = process.env.EXPO_PUBLIC_TVDB_API_KEY?.trim();
  if (!apikey) return null;
  if (!tokenPromise) {
    const pin = process.env.EXPO_PUBLIC_TVDB_PIN?.trim();
    tokenPromise = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(pin ? { apikey, pin } : { apikey }),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { data?: { token?: string }; token?: string };
        return json.data?.token ?? json.token ?? null;
      } catch {
        return null;
      }
    })().then(token => {
      if (!token) tokenPromise = null;
      return token;
    });
  }
  return tokenPromise;
}

async function tvdbGet<T>(path: string, retry = true): Promise<T | null> {
  const bearer = await getToken();
  if (!bearer) return null;
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
      'Accept-Language': 'en',
    },
  });
  if (res.status === 401 && retry) {
    tokenPromise = null;
    return tvdbGet<T>(path, false);
  }
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: T };
  return json.data ?? null;
}

export async function loadTvdbNetflixOrder(tvdbId: number): Promise<NetflixCatalog | null> {
  if (!tvdbConfigured() || !Number.isFinite(tvdbId) || tvdbId <= 0) return null;
  const series = await tvdbGet<TvdbSeries>(`/series/${tvdbId}/extended`);
  const seasons = netflixSeasons(series);
  if (seasons.length === 0) return null;

  const episodes: TmdbEpisode[] = [];
  const meta: TmdbSeasonSummary[] = [];
  for (const season of seasons.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
    const seasonId = season.id;
    const seasonNumber = Number(season.number);
    if (!seasonId || seasonNumber < 1) continue;
    const extended = await tvdbGet<SeasonExtended>(`/seasons/${seasonId}/extended`);
    const mapped = (extended?.episodes ?? [])
      .map(ep => mapEpisode(ep, seasonNumber))
      .filter((ep): ep is TmdbEpisode => !!ep)
      .sort((a, b) => a.episode_number - b.episode_number);
    const unique: TmdbEpisode[] = [];
    for (const ep of mapped) {
      if (unique.some(kept => kept.episode_number === ep.episode_number)) continue;
      unique.push(ep);
    }
    if (unique.length === 0) continue;
    episodes.push(...unique);
    const premiere = unique.map(ep => ep.air_date).find(Boolean) ?? null;
    meta.push({
      id: seasonId,
      season_number: seasonNumber,
      episode_count: unique.length,
      name: `Season ${seasonNumber}`,
      air_date: premiere,
    });
  }

  if (episodes.length === 0) return null;
  const slug = series?.slug?.trim();
  return {
    tvdbId,
    url: slug
      ? `https://thetvdb.com/series/${slug}`
      : `https://thetvdb.com/?tab=series&id=${tvdbId}`,
    seasons: meta,
    episodes,
  };
}
