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

export function normalizeEpisodeTitle(name?: string | null): string {
  return (name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function episodeTitleKey(name?: string | null): string {
  return normalizeEpisodeTitle(name);
}

export function episodeOverviewKey(text?: string | null): string {
  return normalizeOverview(text);
}

export type WatchedHint = {
  season: number;
  ep: number;
  titleKey?: string | null;
  overviewKey?: string | null;
};

export function watchedHintsFromRows(
  rows: {
    seasonNumber: number;
    episodeNumber: number;
    titleKey?: string | null;
    overviewKey?: string | null;
  }[]
): WatchedHint[] {
  return rows.map(e => ({
    season: Number(e.seasonNumber),
    ep: Number(e.episodeNumber),
    titleKey: e.titleKey ?? undefined,
    overviewKey: e.overviewKey ?? undefined,
  }));
}

/** Extra fields to persist so TMDB numbering remaps keep a check. */
export function watchedTitleFields(
  name?: string | null,
  overview?: string | null
): { titleKey?: string; overviewKey?: string } {
  const titleKey = episodeTitleKey(name);
  const overviewKey = episodeOverviewKey(overview);
  return {
    ...(titleKey ? { titleKey } : {}),
    ...(overviewKey ? { overviewKey } : {}),
  };
}

export function normalizeOverview(text?: string | null): string {
  return stripHtml(text)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Dice coefficient on character bigrams — extra sentences still score high. */
function overviewDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const n = counts.get(gram) ?? 0;
    if (n > 0) {
      overlap++;
      counts.set(gram, n - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

export function overviewsMatch(a?: string | null, b?: string | null): boolean {
  const na = normalizeOverview(a);
  const nb = normalizeOverview(b);
  if (!na && !nb) return true;
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const shorter = na.length <= nb.length ? na : nb;
  if (shorter.length < 24) return false;
  return overviewDice(na, nb) >= 0.82;
}

export type DedupeEpisode = {
  season_number: number;
  episode_number: number;
  name?: string | null;
  overview?: string | null;
  id?: number;
};

function sameWatchIdentity(
  season: number,
  title: string,
  overview: string | null | undefined,
  ep: DedupeEpisode
): boolean {
  if (!title || ep.season_number !== season) return false;
  if (normalizeEpisodeTitle(ep.name) !== title) return false;
  return overviewsMatch(overview, ep.overview);
}

/**
 * Same-season rows share a watch identity only when title and synopsis match.
 * Different overviews (part 1 vs part 2) stay separate. Stored keys keep the
 * check when TMDB later changes the episode number.
 */
export function expandWatchedKeys(
  watched: Set<string>,
  catalog: DedupeEpisode[],
  hints?: WatchedHint[]
): Set<string> {
  const keys = new Set(watched);
  const identities: { season: number; title: string; overview?: string | null }[] = [];

  function addIdentity(season: number, title: string, overview?: string | null) {
    if (!title) return;
    if (
      identities.some(
        id =>
          id.season === season &&
          id.title === title &&
          overviewsMatch(id.overview, overview)
      )
    ) {
      return;
    }
    identities.push({ season, title, overview });
  }

  for (const h of hints ?? []) {
    const title = (h.titleKey ?? '').trim();
    const overview = (h.overviewKey ?? '').trim();
    if (!title || !overview) continue;
    addIdentity(h.season, title, overview);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const ep of catalog) {
      const k = `${ep.season_number}x${ep.episode_number}`;
      const title = normalizeEpisodeTitle(ep.name);
      const marked =
        keys.has(k) ||
        identities.some(id =>
          sameWatchIdentity(id.season, id.title, id.overview, ep)
        );
      if (!marked) continue;
      if (!keys.has(k)) {
        keys.add(k);
        changed = true;
      }
      if (title) {
        const before = identities.length;
        addIdentity(ep.season_number, title, ep.overview);
        if (identities.length > before) changed = true;
      }
    }
  }

  return keys;
}

function isMazeId(id?: number): boolean {
  return id != null && id >= MAZE_ID_OFFSET;
}

function preferDuplicate<T extends DedupeEpisode>(
  a: T,
  b: T,
  watchedKeys?: Set<string>
): T {
  const aKey = `${a.season_number}x${a.episode_number}`;
  const bKey = `${b.season_number}x${b.episode_number}`;
  const aWatched = Boolean(watchedKeys?.has(aKey));
  const bWatched = Boolean(watchedKeys?.has(bKey));
  if (aWatched && !bWatched) return a;
  if (bWatched && !aWatched) return b;
  if (!isMazeId(a.id) && isMazeId(b.id)) return a;
  if (!isMazeId(b.id) && isMazeId(a.id)) return b;
  return a.episode_number <= b.episode_number ? a : b;
}

/** Collapse same-season rows that share a title and synopsis (TMDB + TVmaze dupes). */
export function dedupeEpisodesByTitle<T extends DedupeEpisode>(
  eps: T[],
  watchedKeys?: Set<string>
): T[] {
  const kept: T[] = [];
  const sorted = [...eps].sort((a, b) =>
    a.season_number !== b.season_number
      ? a.season_number - b.season_number
      : a.episode_number - b.episode_number
  );
  for (const ep of sorted) {
    const title = normalizeEpisodeTitle(ep.name);
    if (!title) {
      kept.push(ep);
      continue;
    }
    const dupIdx = kept.findIndex(k => {
      if (k.season_number !== ep.season_number) return false;
      if (normalizeEpisodeTitle(k.name) !== title) return false;
      return overviewsMatch(k.overview, ep.overview);
    });
    if (dupIdx < 0) {
      kept.push(ep);
      continue;
    }
    kept[dupIdx] = preferDuplicate(kept[dupIdx], ep, watchedKeys);
  }
  return kept;
}

/** True when TMDB already lists this slot or the same title in that season. */
export function tmdbAlreadyHasEpisode(
  tmdbEps: { season_number: number; episode_number: number; name?: string | null }[],
  maze: TvmazeEpisode
): boolean {
  if (maze.season < 1 || maze.number == null || maze.number < 1) return true;
  if (
    tmdbEps.some(
      e => e.season_number === maze.season && e.episode_number === maze.number
    )
  ) {
    return true;
  }
  const title = normalizeEpisodeTitle(maze.name);
  if (!title) return false;
  return tmdbEps.some(
    e => e.season_number === maze.season && normalizeEpisodeTitle(e.name) === title
  );
}

export function mergeTmdbEpisodes(
  tmdbEps: TmdbEpisode[],
  mazeEps: TvmazeEpisode[]
): TmdbEpisode[] {
  const byKey = new Map<string, TmdbEpisode>();
  const fromTmdb: TmdbEpisode[] = [];
  for (const ep of tmdbEps) {
    if (ep.season_number < 1 || ep.episode_number < 1) continue;
    byKey.set(`${ep.season_number}x${ep.episode_number}`, ep);
    fromTmdb.push(ep);
  }
  for (const maze of mazeEps) {
    if (tmdbAlreadyHasEpisode(fromTmdb, maze)) continue;
    const incoming = tvmazeToTmdbEpisode(maze);
    const key = `${incoming.season_number}x${incoming.episode_number}`;
    if (byKey.has(key)) continue;
    byKey.set(key, incoming);
  }
  return dedupeEpisodesByTitle(
    [...byKey.values()].sort((a, b) =>
      a.season_number !== b.season_number
        ? a.season_number - b.season_number
        : a.episode_number - b.episode_number
    )
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
    }
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
