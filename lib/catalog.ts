import { tmdb, TmdbEpisode, TmdbSeasonSummary } from './tmdb';
import { getTvmazeEpisodes, lookupTvmazeShow, TvmazeEpisode, TvmazeShow } from './tvmaze';

const MAZE_ID_OFFSET = 1_000_000_000;

export function stripHtml(html?: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tvmazeStill(ep: TvmazeEpisode): string | null {
  return ep.image?.original || ep.image?.medium || null;
}

export function tvmazeToTmdbEpisode(ep: TvmazeEpisode): TmdbEpisode {
  const num = ep.number ?? 0;
  return {
    id: MAZE_ID_OFFSET + ep.id,
    episode_number: num,
    season_number: ep.season,
    name: ep.name ?? '',
    overview: stripHtml(ep.summary),
    air_date: ep.airdate ?? '',
    still_path: tvmazeStill(ep),
    runtime: ep.runtime ?? null,
  };
}

export function mergeTmdbEpisodes(
  tmdbEps: TmdbEpisode[],
  mazeEps: TvmazeEpisode[]
): TmdbEpisode[] {
  const byKey = new Map<string, TmdbEpisode>();
  for (const ep of tmdbEps) {
    if (ep.season_number < 1 || ep.episode_number < 1) continue;
    byKey.set(`${ep.season_number}x${ep.episode_number}`, ep);
  }
  for (const maze of mazeEps) {
    if (maze.season < 1 || maze.number == null || maze.number < 1) continue;
    const key = `${maze.season}x${maze.number}`;
    const incoming = tvmazeToTmdbEpisode(maze);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, incoming);
      continue;
    }
    byKey.set(key, {
      ...prev,
      name: prev.name?.trim() ? prev.name : incoming.name,
      overview: prev.overview?.trim() ? prev.overview : incoming.overview,
      air_date: prev.air_date?.trim() ? prev.air_date : incoming.air_date,
      still_path: prev.still_path || incoming.still_path,
      runtime: prev.runtime && prev.runtime > 0 ? prev.runtime : incoming.runtime,
    });
  }
  return [...byKey.values()].sort((a, b) =>
    a.season_number !== b.season_number
      ? a.season_number - b.season_number
      : a.episode_number - b.episode_number
  );
}

export function mergeSeasonMeta(
  tmdbMeta: TmdbSeasonSummary[],
  mazeEps: TvmazeEpisode[]
): TmdbSeasonSummary[] {
  const bySeason = new Map<number, TmdbSeasonSummary>();
  for (const s of tmdbMeta) {
    if (s.season_number < 1) continue;
    bySeason.set(s.season_number, s);
  }
  const mazeCounts = new Map<number, number>();
  const mazeAir = new Map<number, string>();
  for (const ep of mazeEps) {
    if (ep.season < 1) continue;
    mazeCounts.set(ep.season, (mazeCounts.get(ep.season) ?? 0) + 1);
    if (ep.number === 1 && ep.airdate) mazeAir.set(ep.season, ep.airdate);
  }
  for (const [season, count] of mazeCounts) {
    const prev = bySeason.get(season);
    if (!prev) {
      bySeason.set(season, {
        id: MAZE_ID_OFFSET + season,
        season_number: season,
        episode_count: count,
        name: `Season ${season}`,
        air_date: mazeAir.get(season) ?? null,
      });
      continue;
    }
    bySeason.set(season, {
      ...prev,
      episode_count: Math.max(prev.episode_count ?? 0, count),
      air_date: prev.air_date || mazeAir.get(season) || null,
    });
  }
  return [...bySeason.values()].sort((a, b) => a.season_number - b.season_number);
}

export type CatalogExtras = {
  mazeShow: TvmazeShow | null;
  mazeEpisodes: TvmazeEpisode[];
  imdbId: string | null;
};

const extrasCache = new Map<number, Promise<CatalogExtras>>();

export async function loadCatalogExtras(
  tmdbShowId: number,
  names?: { name?: string | null; original_name?: string | null }
): Promise<CatalogExtras> {
  let pending = extrasCache.get(tmdbShowId);
  if (!pending) {
    pending = (async () => {
      const ids = await tmdb.getExternalIds(tmdbShowId).catch(() => null);
      const imdbId = ids?.imdb_id?.trim() || null;
      const mazeShow = await lookupTvmazeShow({
        imdbId,
        tvdbId: ids?.tvdb_id,
        names: [names?.original_name, names?.name],
      });
      const mazeEpisodes = mazeShow ? await getTvmazeEpisodes(mazeShow.id) : [];
      return { mazeShow, mazeEpisodes, imdbId };
    })();
    extrasCache.set(tmdbShowId, pending);
  }
  return pending;
}
