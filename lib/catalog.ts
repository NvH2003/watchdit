import { tmdb, TmdbEpisode, TmdbSeasonSummary, TmdbWatchProvidersResponse } from './tmdb';
import { getTvmazeEpisodes, lookupTvmazeShow, TvmazeEpisode, TvmazeShow } from './tvmaze';
import { loadTvdbNetflixOrder, NetflixCatalog, tvdbConfigured } from './tvdb';

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

/** TMDB/TVmaze default titles like "Episode 1" / "Aflevering 12" with no real name. */
export function isGenericEpisodeTitle(name?: string | null): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  return /^(episode|aflevering|episodio|folge|capitulo|capítulo)\s*\d+$/i.test(n);
}

function hasListedAirDate(iso?: string | null): boolean {
  const s = (iso ?? '').trim();
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}/.test(s) || !Number.isNaN(Date.parse(s));
}

/**
 * Announced-but-empty TMDB row: generic name, no air date, no synopsis.
 * Still image and runtime are not enough — TMDB often copies the season poster.
 */
export function isUnpublishedPlaceholder(ep: {
  name?: string | null;
  air_date?: string | null;
  overview?: string | null;
}): boolean {
  if (hasListedAirDate(ep.air_date)) return false;
  if (!isGenericEpisodeTitle(ep.name)) return false;
  return (ep.overview?.trim().length ?? 0) < 20;
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

/**
 * Netflix episode numbers are a different cut from the broadcast list.
 * Keep a stored check only when its title matches that cut, or when the
 * stored row has no title and the season/episode slot is the only clue.
 */
export function alignWatchedToCatalog(
  watched: Set<string>,
  hints: WatchedHint[] | undefined,
  catalog: DedupeEpisode[]
): Set<string> {
  const hintByKey = new Map<string, WatchedHint>();
  for (const hint of hints ?? []) hintByKey.set(`${hint.season}x${hint.ep}`, hint);
  const keys = new Set<string>();
  for (const ep of catalog) {
    const key = `${ep.season_number}x${ep.episode_number}`;
    const storedTitle = (hintByKey.get(key)?.titleKey ?? '').trim();
    const epTitle = normalizeEpisodeTitle(ep.name);
    if (watched.has(key) && (!storedTitle || !epTitle || storedTitle === epTitle)) {
      keys.add(key);
      continue;
    }
    for (const hint of hints ?? []) {
      const title = (hint.titleKey ?? '').trim();
      if (hint.season === ep.season_number && title && title === epTitle) {
        keys.add(key);
        break;
      }
    }
  }
  return keys;
}

const NETFLIX_PROVIDER_ID = 8;

export function watchProvidersIncludeNetflix(
  providers?: TmdbWatchProvidersResponse | null
): boolean {
  for (const code of ['NL', 'BE']) {
    const flatrate = providers?.results?.[code]?.flatrate ?? [];
    if (
      flatrate.some(
        provider =>
          provider.provider_id === NETFLIX_PROVIDER_ID || /^netflix$/i.test(provider.provider_name)
      )
    ) {
      return true;
    }
  }
  return false;
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
    if (isUnpublishedPlaceholder(ep)) continue;
    byKey.set(`${ep.season_number}x${ep.episode_number}`, ep);
    fromTmdb.push(ep);
  }
  for (const maze of mazeEps) {
    if (tmdbAlreadyHasEpisode(fromTmdb, maze)) continue;
    const incoming = tvmazeToTmdbEpisode(maze);
    if (isUnpublishedPlaceholder(incoming)) continue;
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

/** Premiere dates within this many days are the same season, even if the season index differs. */
const PREMIERE_MATCH_DAYS = 45;
/** A new season has to fall on this show's own calendar, not a nearby special. */
const MAX_CONTINUATION_MONTH_DISTANCE = 2;

export type SeasonAir = {
  seasonNumber: number;
  airDate?: string | null;
};

function isoDay(iso?: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec((iso ?? '').trim());
  return match ? match[1] : null;
}

function dayNumber(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

function daysBetween(a: string, b: string): number | null {
  const left = dayNumber(a);
  const right = dayNumber(b);
  if (left == null || right == null) return null;
  return Math.abs(left - right);
}

function monthOf(iso: string): number | null {
  const month = Number(iso.slice(5, 7));
  return month >= 1 && month <= 12 ? month : null;
}

function yearOf(iso: string): number | null {
  const year = Number(iso.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function monthDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 12 - diff);
}

/** "Wie is de Mol? NPO Start-editie" and the main series share this stem. */
export function titleStem(name: string): string {
  return (name.split(/[?:]/)[0] ?? name).replace(/\s+/g, ' ').trim();
}

export function namesShareStem(a: string, b: string): boolean {
  const left = a.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const right = b.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (left.length < 4 || right.length < 4) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

type MazeSeasonGroup = {
  season: number;
  episodes: TvmazeEpisode[];
  premiere: string | null;
};

function groupMazeSeasons(episodes: TvmazeEpisode[]): MazeSeasonGroup[] {
  const bySeason = new Map<number, TvmazeEpisode[]>();
  for (const ep of episodes) {
    if (ep.season < 1 || ep.number == null || ep.number < 1) continue;
    const list = bySeason.get(ep.season) ?? [];
    list.push(ep);
    bySeason.set(ep.season, list);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, group]) => {
      const premieres = group
        .map(ep => isoDay(ep.airdate))
        .filter((day): day is string => !!day)
        .sort();
      return { season, episodes: group, premiere: premieres[0] ?? null };
    });
}

function closestSeason(premiere: string, seasons: SeasonAir[]): SeasonAir | null {
  let best: SeasonAir | null = null;
  let bestDays = PREMIERE_MATCH_DAYS + 1;
  for (const season of seasons) {
    const air = isoDay(season.airDate);
    if (!air) continue;
    const days = daysBetween(premiere, air);
    if (days == null || days > PREMIERE_MATCH_DAYS || days >= bestDays) continue;
    best = season;
    bestDays = days;
  }
  return best;
}

function withSeason(ep: TvmazeEpisode, season: number): TvmazeEpisode {
  return ep.season === season ? ep : { ...ep, season };
}

function premiereMonths(seasons: SeasonAir[]): number[] {
  const months: number[] = [];
  for (const season of seasons) {
    const air = isoDay(season.airDate);
    const month = air ? monthOf(air) : null;
    if (month != null) months.push(month);
  }
  return months;
}

function nearestMonthDistance(month: number, months: number[]): number | null {
  if (!months.length) return null;
  return Math.min(...months.map(known => monthDistance(month, known)));
}

function latestPremiere(seasons: SeasonAir[]): string | null {
  let latest: string | null = null;
  for (const season of seasons) {
    const air = isoDay(season.airDate);
    if (!air) continue;
    if (!latest || air > latest) latest = air;
  }
  return latest;
}

function hasSeasonInYear(seasons: SeasonAir[], year: number): boolean {
  return seasons.some(season => {
    const air = isoDay(season.airDate);
    return air != null && yearOf(air) === year;
  });
}

function earliestPremiere(seasons: SeasonAir[]): string | null {
  let earliest: string | null = null;
  for (const season of seasons) {
    const air = isoDay(season.airDate);
    if (!air) continue;
    if (!earliest || air < earliest) earliest = air;
  }
  return earliest;
}

function isPrimaryShow(showSeasons: SeasonAir[], siblingSeasons: SeasonAir[][]): boolean {
  const count = showSeasons.length;
  return siblingSeasons.every(sibling => sibling.length < count);
}

/** Off-calendar run of the main show, such as Renaissance, not a sister edition. */
function isJubileeInsert(
  premiere: string,
  showSeasons: SeasonAir[],
  siblingSeasons: SeasonAir[][]
): boolean {
  if (!isPrimaryShow(showSeasons, siblingSeasons)) return false;
  if (siblingSeasons.some(sibling => continuesShow(premiere, sibling))) return false;
  const earliest = earliestPremiere(showSeasons);
  const latest = latestPremiere(showSeasons);
  if (!earliest || !latest) return false;
  const year = yearOf(premiere);
  if (year != null && hasSeasonInYear(showSeasons, year)) return true;
  return premiere >= earliest && premiere <= latest;
}

export function isAnniversarySeasonName(name?: string | null): boolean {
  return /^(jubileumseizoen|anniversary season)\b/i.test((name ?? '').trim());
}

/** A later run on this show's own premiere month, not a special tucked into a year it already aired. */
function continuesShow(premiere: string, seasons: SeasonAir[]): boolean {
  const latest = latestPremiere(seasons);
  if (!latest || premiere <= latest) return false;
  const year = yearOf(premiere);
  const month = monthOf(premiere);
  if (year == null || month == null || hasSeasonInYear(seasons, year)) return false;
  const distance = nearestMonthDistance(month, premiereMonths(seasons));
  return distance != null && distance <= MAX_CONTINUATION_MONTH_DISTANCE;
}

function acceptsContinuation(
  premiere: string,
  seasons: SeasonAir[],
  siblingSeasons: SeasonAir[][]
): boolean {
  if (!continuesShow(premiere, seasons)) return false;
  const month = monthOf(premiere);
  const year = yearOf(premiere);
  if (month == null || year == null) return false;
  const ownDistance = nearestMonthDistance(month, premiereMonths(seasons));
  if (ownDistance == null) return false;
  for (const sibling of siblingSeasons) {
    // Another edition already aired that year: only an exact repeat of this show's month stays here.
    if (hasSeasonInYear(sibling, year) && ownDistance > 0) return false;
    if (!continuesShow(premiere, sibling)) continue;
    const siblingDistance = nearestMonthDistance(month, premiereMonths(sibling));
    if (siblingDistance != null && siblingDistance < ownDistance) return false;
  }
  return true;
}

/**
 * Keep TVmaze episodes that belong to this TMDB show.
 * Season indexes often diverge once a sister edition (streaming) or a special is inserted,
 * so seasons are matched on premiere date. A season neither show has yet is appended
 * when it continues this show's calendar. Jubilee runs stay on the main show under their own label.
 */
export function alignMazeToShow(
  tmdbMeta: TmdbSeasonSummary[],
  mazeEpisodes: TvmazeEpisode[],
  siblingSeasons: SeasonAir[][] = []
): { meta: TmdbSeasonSummary[]; episodes: TvmazeEpisode[] } {
  const showSeasons: SeasonAir[] = tmdbMeta
    .filter(season => season.season_number > 0)
    .map(season => ({ seasonNumber: season.season_number, airDate: season.air_date }));
  const bySeason = new Map<number, TmdbSeasonSummary>();
  for (const season of tmdbMeta) {
    if (season.season_number < 1) continue;
    bySeason.set(season.season_number, season);
  }

  const episodes: TvmazeEpisode[] = [];
  const extras: MazeSeasonGroup[] = [];
  const jubilees: MazeSeasonGroup[] = [];
  for (const group of groupMazeSeasons(mazeEpisodes)) {
    if (!group.premiere) continue;
    const own = closestSeason(group.premiere, showSeasons);
    if (own) {
      for (const ep of group.episodes) episodes.push(withSeason(ep, own.seasonNumber));
      continue;
    }
    if (siblingSeasons.some(seasons => closestSeason(group.premiere as string, seasons))) continue;
    if (acceptsContinuation(group.premiere, showSeasons, siblingSeasons)) {
      extras.push(group);
      continue;
    }
    if (isJubileeInsert(group.premiere, showSeasons, siblingSeasons)) jubilees.push(group);
  }

  const byPremiere = (a: MazeSeasonGroup, b: MazeSeasonGroup) =>
    (a.premiere ?? '') < (b.premiere ?? '') ? -1 : 1;
  extras.sort(byPremiere);
  jubilees.sort(byPremiere);
  let nextNumber = showSeasons.reduce((max, season) => Math.max(max, season.seasonNumber), 0);
  const usesDutch = tmdbMeta.some(season => /seizoen/i.test(season.name));
  function appendGroup(group: MazeSeasonGroup, name: string) {
    nextNumber += 1;
    bySeason.set(nextNumber, {
      id: MAZE_ID_OFFSET + group.season,
      season_number: nextNumber,
      episode_count: group.episodes.length,
      name,
      air_date: group.premiere,
    });
    for (const ep of group.episodes) episodes.push(withSeason(ep, nextNumber));
  }
  for (const group of extras) {
    appendGroup(group, usesDutch ? `Seizoen ${nextNumber + 1}` : `Season ${nextNumber + 1}`);
  }
  for (const group of jubilees) {
    const year = group.premiere?.slice(0, 4) ?? '';
    appendGroup(group, usesDutch ? `Jubileumseizoen ${year}` : `Anniversary season ${year}`);
  }

  return {
    meta: [...bySeason.values()].sort((a, b) => {
      const aDay = isoDay(a.air_date);
      const bDay = isoDay(b.air_date);
      if (aDay && bDay && aDay !== bDay) return aDay < bDay ? -1 : 1;
      return a.season_number - b.season_number;
    }),
    episodes,
  };
}

function feedMatchesShow(episodes: TvmazeEpisode[], seasons: SeasonAir[]): boolean {
  return groupMazeSeasons(episodes).some(
    group => !!group.premiere && !!closestSeason(group.premiere, seasons)
  );
}

export type CatalogExtras = {
  mazeShow: TvmazeShow | null;
  mazeEpisodes: TvmazeEpisode[];
  imdbId: string | null;
  /** Premiere dates of sister editions, such as the streaming version of the same series. */
  siblingSeasons: SeasonAir[][];
};

const extrasCache = new Map<number, Promise<CatalogExtras>>();

async function loadSiblingSeasons(
  tmdbShowId: number,
  stem: string
): Promise<SeasonAir[][]> {
  if (stem.length < 4) return [];
  const [en, nl] = await Promise.all([
    tmdb.searchShows(stem).catch(() => null),
    tmdb.searchShows(stem, 'nl-NL').catch(() => null),
  ]);
  const byId = new Map<number, { id: number; name?: string | null; original_name?: string | null }>();
  for (const hit of [...(en?.results ?? []), ...(nl?.results ?? [])]) {
    if (hit.id === tmdbShowId || byId.has(hit.id)) continue;
    const name = hit.name || hit.original_name || '';
    if (!namesShareStem(name, stem)) continue;
    byId.set(hit.id, hit);
  }
  const shows = await Promise.all(
    [...byId.values()].slice(0, 5).map(hit => tmdb.getShow(hit.id).catch(() => null))
  );
  return shows
    .filter((show): show is NonNullable<typeof show> => !!show)
    .map(show =>
      (show.seasons ?? [])
        .filter(season => season.season_number > 0)
        .map(season => ({ seasonNumber: season.season_number, airDate: season.air_date ?? null }))
    );
}

export async function loadCatalogExtras(
  tmdbShowId: number,
  names?: { name?: string | null; original_name?: string | null }
): Promise<CatalogExtras> {
  let pending = extrasCache.get(tmdbShowId);
  if (!pending) {
    pending = (async () => {
      const details = await tmdb.getShow(tmdbShowId).catch(() => null);
      const ids = await tmdb.getExternalIds(tmdbShowId).catch(() => null);
      const imdbId = ids?.imdb_id?.trim() || null;
      const showName = details?.name || names?.name || '';
      const originalName = details?.original_name || names?.original_name || '';
      const ownSeasons: SeasonAir[] = (details?.seasons ?? [])
        .filter(season => season.season_number > 0)
        .map(season => ({ seasonNumber: season.season_number, airDate: season.air_date ?? null }));
      const stem = titleStem(originalName || showName);
      const siblingSeasons = await loadSiblingSeasons(tmdbShowId, stem).catch(() => []);
      let mazeShow = await lookupTvmazeShow({
        imdbId,
        tvdbId: ids?.tvdb_id,
        names: [originalName, showName],
      });
      let mazeEpisodes = mazeShow ? await getTvmazeEpisodes(mazeShow.id) : [];
      // Sister editions often have no TVmaze record of their own. Their episodes sit on the main show.
      if (stem && !feedMatchesShow(mazeEpisodes, ownSeasons)) {
        const parent = await lookupTvmazeShow({ names: [stem] });
        if (parent && parent.id !== mazeShow?.id) {
          const parentEpisodes = await getTvmazeEpisodes(parent.id);
          if (feedMatchesShow(parentEpisodes, ownSeasons)) {
            mazeShow = parent;
            mazeEpisodes = parentEpisodes;
          }
        }
      }
      return { mazeShow, mazeEpisodes, imdbId, siblingSeasons };
    })();
    extrasCache.set(tmdbShowId, pending);
  }
  return pending;
}

const netflixCache = new Map<number, Promise<NetflixCatalog | null>>();

export async function loadNetflixCatalog(tmdbShowId: number): Promise<NetflixCatalog | null> {
  if (!tvdbConfigured()) return null;
  let pending = netflixCache.get(tmdbShowId);
  if (!pending) {
    pending = (async () => {
      const [ids, providers] = await Promise.all([
        tmdb.getExternalIds(tmdbShowId).catch(() => null),
        tmdb.getWatchProviders(tmdbShowId).catch(() => null),
      ]);
      const tvdbId = ids?.tvdb_id;
      if (!tvdbId || tvdbId <= 0 || !watchProvidersIncludeNetflix(providers)) return null;
      return loadTvdbNetflixOrder(tvdbId);
    })().catch(() => null);
    netflixCache.set(tmdbShowId, pending);
  }
  return pending;
}
