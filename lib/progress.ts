import { averageEpisodeRuntime, episodeRuntimeMinutes } from './stats';
import { tmdb } from './tmdb';
import { loadCatalogExtras, tvmazeToTmdbEpisode } from './catalog';

export function parseAirDay(iso?: string | null): Date | null {
  if (!iso) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (day) {
    return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

const MAX_EARLY_ACCESS_DAYS = 28;

export function clampEarlyAccessDays(n: unknown): number {
  const d = Number(n);
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, Math.min(MAX_EARLY_ACCESS_DAYS, Math.round(d)));
}

/** TMDB air calendar day shifted earlier by `daysEarly`. */
export function shiftAirDate(iso?: string | null, daysEarly = 0): string | null {
  const air = parseAirDay(iso);
  if (!air) return null;
  air.setDate(air.getDate() - clampEarlyAccessDays(daysEarly));
  const y = air.getFullYear();
  const m = String(air.getMonth() + 1).padStart(2, '0');
  const d = String(air.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True when the episode is available (TMDB air day minus daysEarly is today or earlier). */
export function hasAired(iso?: string | null, daysEarly = 0): boolean {
  const air = parseAirDay(iso);
  if (!air) return false;
  air.setDate(air.getDate() - clampEarlyAccessDays(daysEarly));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return air.getTime() <= today.getTime();
}

/** True when the episode is not yet available given daysEarly. */
export function isFutureAirDate(iso?: string | null, daysEarly = 0): boolean {
  const air = parseAirDay(iso);
  if (!air) return false;
  air.setDate(air.getDate() - clampEarlyAccessDays(daysEarly));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return air.getTime() > today.getTime();
}

export type EpisodeAvailability = {
  airDate?: string | null;
  stillPath?: string | null;
  runtime?: number | null;
  overview?: string | null;
};

/** TMDB listed the episode as published (still, runtime, or synopsis) even without an air date. */
export function episodeLooksReleased(ep: EpisodeAvailability): boolean {
  if (ep.stillPath) return true;
  if (episodeRuntimeMinutes(ep.runtime) != null) return true;
  return (ep.overview?.trim().length ?? 0) >= 20;
}

/** Available to watch: aired by date, or released on TMDB with no future air date. */
export function episodeIsAvailable(ep: EpisodeAvailability, daysEarly = 0): boolean {
  if (hasAired(ep.airDate, daysEarly)) return true;
  if (isFutureAirDate(ep.airDate, daysEarly)) return false;
  return episodeLooksReleased(ep);
}

/** Local calendar day key — changes at midnight so aired lists can refresh. */
export function localDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Ms until the next local midnight (+buffer), for scheduling day rollovers. */
export function msUntilNextLocalMidnight(now = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(50, next.getTime() - now.getTime() + 50);
}

/**
 * Show belongs on To watch once its next *unwatched* episode has aired.
 * Ignores stale nextEpisode* fields that still point at an already-checked episode.
 */
export function readyForWatchlist(
  status?: string | null,
  nextEpisodeAirDate?: string | null,
  opts?: {
    nextSeasonNum?: number | null;
    nextEpisodeNum?: number | null;
    watchedKeys?: Set<string>;
    daysEarly?: number;
  }
): boolean {
  if (status !== 'watching' && status !== 'upToDate') return false;
  const season = opts?.nextSeasonNum;
  const ep = opts?.nextEpisodeNum;
  if (
    opts?.watchedKeys &&
    hasNextPointer(season, ep) &&
    opts.watchedKeys.has(`${season}x${ep}`)
  ) {
    return false;
  }
  if (hasAired(nextEpisodeAirDate, opts?.daysEarly)) return true;
  return (
    status === 'watching' &&
    hasNextPointer(season, ep) &&
    !isFutureAirDate(nextEpisodeAirDate, opts?.daysEarly)
  );
}

function hasNextPointer(
  season?: number | null,
  ep?: number | null
): boolean {
  return (
    season != null &&
    ep != null &&
    Number.isFinite(season) &&
    Number.isFinite(ep) &&
    season >= 1 &&
    ep >= 1
  );
}

/** Show belongs on Coming up while the next unwatched episode is scheduled or TBA. */
export function readyForUpcoming(
  status?: string | null,
  nextEpisodeAirDate?: string | null,
  opts?: {
    nextSeasonNum?: number | null;
    nextEpisodeNum?: number | null;
    watchedKeys?: Set<string>;
    daysEarly?: number;
  }
): boolean {
  if (status !== 'watching' && status !== 'upToDate') return false;
  const season = opts?.nextSeasonNum;
  const ep = opts?.nextEpisodeNum;
  if (
    opts?.watchedKeys &&
    hasNextPointer(season, ep) &&
    opts.watchedKeys.has(`${season}x${ep}`)
  ) {
    return false;
  }
  if (isFutureAirDate(nextEpisodeAirDate, opts?.daysEarly)) return true;
  return (
    status === 'upToDate' &&
    hasNextPointer(season, ep) &&
    !hasAired(nextEpisodeAirDate, opts?.daysEarly)
  );
}

/** TMDB TV status: Ended / Canceled vs still running. */
export function isShowEnded(tmdbStatus?: string | null): boolean {
  const s = (tmdbStatus ?? '').toLowerCase();
  return s === 'ended' || s === 'canceled' || s === 'cancelled';
}

export type ProgressEpisode = {
  season: number;
  ep: number;
  name: string;
  airDate: string;
  stillPath?: string | null;
  runtime?: number | null;
  overview?: string | null;
};

export type WatchStatus = 'watching' | 'upToDate' | 'finished';

export type TrackFrom = {
  season: number;
  episode: number;
};

export function trackFromOf(show: {
  trackFromSeason?: unknown;
  trackFromEpisode?: unknown;
} | null | undefined): TrackFrom | null {
  if (!show) return null;
  const season = Number(show.trackFromSeason);
  if (!Number.isFinite(season) || season < 1) return null;
  const episode = Number(show.trackFromEpisode);
  return {
    season,
    episode: Number.isFinite(episode) && episode >= 1 ? episode : 1,
  };
}

export function isBeforeTrackFrom(
  season: number,
  ep: number,
  trackFrom?: TrackFrom | null
): boolean {
  if (!trackFrom) return false;
  return (
    season < trackFrom.season ||
    (season === trackFrom.season && ep < trackFrom.episode)
  );
}

/** Contiguous watched-season run ending at the latest check (or lastSeasonHint). */
export function deriveTrackFrom(
  watchedKeys: Iterable<string>,
  lastSeasonHint?: number | null
): TrackFrom | null {
  const items: { season: number; ep: number }[] = [];
  for (const key of watchedKeys) {
    const match = /^(\d+)x(\d+)$/.exec(String(key));
    if (!match) continue;
    const season = Number(match[1]);
    const ep = Number(match[2]);
    if (season < 1 || ep < 1) continue;
    items.push({ season, ep });
  }
  if (items.length === 0) {
    const hint = Number(lastSeasonHint);
    if (Number.isFinite(hint) && hint >= 1) return { season: hint, episode: 1 };
    return null;
  }
  const seasons = new Set(items.map(i => i.season));
  const hint = Number(lastSeasonHint);
  let lastSeason =
    Number.isFinite(hint) && hint >= 1 && seasons.has(hint)
      ? hint
      : Math.max(...items.map(i => i.season));
  let start = lastSeason;
  while (seasons.has(start - 1)) start -= 1;
  const eps = items.filter(i => i.season === start).map(i => i.ep);
  return { season: start, episode: Math.min(...eps) };
}

export type ProgressResult = {
  status: WatchStatus;
  nextSeasonNum?: number;
  nextEpisodeNum?: number;
  nextEpisodeName?: string;
  nextEpisodeAirDate?: string;
  nextEpisodeStillPath?: string;
  nextEpisodeRuntime?: number;
  originalLanguage?: string;
  totalEpisodes?: number;
  unwatchedAiredCount?: number;
  remainingAiredCount?: number;
};

/**
 * watching  — unwatched episodes that have already aired
 * upToDate  — all aired episodes watched, show still running
 * finished  — all episodes watched, show has ended
 */
export function computeProgress(
  episodes: ProgressEpisode[],
  watched: Set<string>,
  tmdbStatus?: string | null,
  daysEarly = 0,
  trackFrom?: TrackFrom | null
): ProgressResult {
  const unwatched = episodes.filter(
    e =>
      e.season > 0 &&
      !watched.has(`${e.season}x${e.ep}`) &&
      !isBeforeTrackFrom(e.season, e.ep, trackFrom)
  );
  const unwatchedAired = unwatched.filter(e =>
    episodeIsAvailable(
      { airDate: e.airDate, stillPath: e.stillPath, runtime: e.runtime, overview: e.overview },
      daysEarly
    )
  );
  const nextAired = unwatchedAired[0];
  const nextFuture = unwatched.find(e => isFutureAirDate(e.airDate, daysEarly));
  const nextTba = unwatched.find(
    e =>
      !episodeIsAvailable(
        { airDate: e.airDate, stillPath: e.stillPath, runtime: e.runtime, overview: e.overview },
        daysEarly
      ) && !isFutureAirDate(e.airDate, daysEarly)
  );
  const ended = isShowEnded(tmdbStatus);

  if (nextAired) {
    const runtime = Number(nextAired.runtime);
    return {
      status: 'watching',
      nextSeasonNum: nextAired.season,
      nextEpisodeNum: nextAired.ep,
      nextEpisodeName: nextAired.name,
      nextEpisodeAirDate: nextAired.airDate,
      nextEpisodeStillPath: nextAired.stillPath ?? '',
      ...(Number.isFinite(runtime) && runtime > 0 ? { nextEpisodeRuntime: Math.round(runtime) } : {}),
      totalEpisodes: episodes.length,
      unwatchedAiredCount: unwatchedAired.length,
      remainingAiredCount: Math.max(0, unwatchedAired.length - 1),
    };
  }

  if (nextFuture || nextTba) {
    const next = nextFuture ?? nextTba!;
    const runtime = Number(next.runtime);
    return {
      status: 'upToDate',
      nextSeasonNum: next.season,
      nextEpisodeNum: next.ep,
      nextEpisodeName: next.name,
      nextEpisodeAirDate: next.airDate,
      nextEpisodeStillPath: next.stillPath ?? '',
      ...(Number.isFinite(runtime) && runtime > 0 ? { nextEpisodeRuntime: Math.round(runtime) } : {}),
      totalEpisodes: episodes.length,
      unwatchedAiredCount: 0,
      remainingAiredCount: 0,
    };
  }

  return {
    status: ended ? 'finished' : 'upToDate',
    totalEpisodes: episodes.length,
    unwatchedAiredCount: 0,
    remainingAiredCount: 0,
  };
}

export function progressUpdates(result: ProgressResult): Record<string, unknown> {
  // Always write next-episode fields so a catch-up / finish doesn't leave a stale
  // aired SxE that would wrongly reappear on To watch.
  const updates: Record<string, unknown> = {
    status: result.status,
    nextSeasonNum: result.nextSeasonNum ?? null,
    nextEpisodeNum: result.nextEpisodeNum ?? null,
    nextEpisodeName: result.nextEpisodeName ?? '',
    nextEpisodeAirDate: result.nextEpisodeAirDate ?? '',
    nextEpisodeStillPath: result.nextEpisodeStillPath ?? '',
    nextEpisodeRuntime: result.nextEpisodeRuntime ?? null,
    unwatchedAiredCount: result.unwatchedAiredCount ?? 0,
    remainingAiredCount: result.remainingAiredCount ?? 0,
  };
  if (result.totalEpisodes != null) updates.totalEpisodes = result.totalEpisodes;
  if (result.originalLanguage != null) updates.tmdbOriginalLanguage = result.originalLanguage;
  return updates;
}

/** Extra episodes after the one currently shown (aired + unwatched only). */
export function remainingAfterCurrent(unwatchedAiredCount: number): number {
  return Math.max(0, unwatchedAiredCount - 1);
}

/**
 * Walk TMDB seasons from `startSeason` to find the next unwatched episode
 * and count remaining aired unwatched episodes for the +N badge.
 */
export async function findProgressFromTmdb(
  tmdbShowId: number,
  watched: Set<string>,
  startSeason = 1,
  daysEarly = 0,
  trackFrom?: TrackFrom | null
): Promise<ProgressResult> {
  const details = await tmdb.getShow(tmdbShowId);
  const originalLanguage = details.original_language || '';
  const seasonMeta = details.seasons ?? [];
  const metaMax = seasonMeta.reduce((max, m) => {
    const n = m.season_number;
    return n > 0 && n > max ? n : max;
  }, 0);
  const totalSeasons = Math.max(details.number_of_seasons ?? 0, metaMax);
  const from = Math.max(1, trackFrom?.season ?? startSeason);
  const totalEpisodes = details.number_of_episodes;

  type NextEp = {
    season_number: number;
    episode_number: number;
    name: string;
    air_date: string;
    still_path: string | null;
    runtime?: number | null;
    overview?: string;
  };

  function toNext(e: {
    season_number?: number | null;
    episode_number?: number | null;
    name?: string | null;
    air_date?: string | null;
    still_path?: string | null;
    runtime?: number | null;
    overview?: string | null;
  }): NextEp | null {
    const season_number = Number(e.season_number);
    const episode_number = Number(e.episode_number);
    if (!Number.isFinite(season_number) || season_number < 1) return null;
    if (!Number.isFinite(episode_number) || episode_number < 1) return null;
    if (isBeforeTrackFrom(season_number, episode_number, trackFrom)) return null;
    if (watched.has(`${season_number}x${episode_number}`)) return null;
    return {
      season_number,
      episode_number,
      name: e.name ?? '',
      air_date: e.air_date ?? '',
      still_path: e.still_path ?? null,
      runtime: e.runtime,
      overview: e.overview ?? '',
    };
  }

  const airedUnwatched: NextEp[] = [];
  let nextFuture: NextEp | null = null;
  let nextTba: NextEp | null = null;
  const byKey = new Map<string, NextEp>();
  const emptySeasonStubs: { season: number; air: string }[] = [];

  function ingest(item: NextEp | null) {
    if (!item) return;
    const key = `${item.season_number}x${item.episode_number}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      return;
    }
    byKey.set(key, {
      season_number: prev.season_number,
      episode_number: prev.episode_number,
      name: prev.name || item.name,
      air_date: prev.air_date || item.air_date,
      still_path: prev.still_path || item.still_path,
      runtime: prev.runtime || item.runtime,
      overview: prev.overview || item.overview,
    });
  }

  for (let s = from; s <= totalSeasons; s++) {
    let season;
    try {
      season = await tmdb.getSeason(tmdbShowId, s);
    } catch {
      continue;
    }
    const eps = (season.episodes ?? []).filter(e => e.season_number > 0);
    for (const e of eps) ingest(toNext(e));
    if (eps.length === 0) {
      emptySeasonStubs.push({
        season: s,
        air:
          season.air_date ??
          seasonMeta.find(m => m.season_number === s)?.air_date ??
          '',
      });
    }
  }

  try {
    const extras = await loadCatalogExtras(tmdbShowId, {
      name: details.name,
      original_name: details.original_name,
    });
    for (const maze of extras.mazeEpisodes) {
      if (maze.season < from) continue;
      ingest(toNext(tvmazeToTmdbEpisode(maze)));
    }
  } catch (e) {
    console.warn('TVmaze catalog merge failed', e);
  }

  for (const stub of emptySeasonStubs) {
    const hasSeason = [...byKey.keys()].some(k => k.startsWith(`${stub.season}x`));
    if (hasSeason) continue;
    ingest({
      season_number: stub.season,
      episode_number: 1,
      name: '',
      air_date: stub.air,
      still_path: null,
    });
  }

  const merged = [...byKey.values()].sort((a, b) =>
    a.season_number !== b.season_number
      ? a.season_number - b.season_number
      : a.episode_number - b.episode_number
  );

  for (const item of merged) {
    if (
      episodeIsAvailable(
        {
          airDate: item.air_date,
          stillPath: item.still_path,
          runtime: item.runtime,
          overview: item.overview,
        },
        daysEarly
      )
    ) {
      airedUnwatched.push(item);
      continue;
    }
    if (isFutureAirDate(item.air_date, daysEarly)) {
      if (!nextFuture) nextFuture = item;
      continue;
    }
    if (!nextTba) nextTba = item;
  }

  if (airedUnwatched.length === 0 && !nextFuture && !nextTba) {
    const fallback = toNext(details.next_episode_to_air ?? {});
    if (fallback) {
      if (
        episodeIsAvailable(
          {
            airDate: fallback.air_date,
            stillPath: fallback.still_path,
            runtime: fallback.runtime,
            overview: fallback.overview,
          },
          daysEarly
        )
      ) {
        airedUnwatched.push(fallback);
      } else if (isFutureAirDate(fallback.air_date, daysEarly)) nextFuture = fallback;
      else nextTba = fallback;
    }
  }

  const showAvg = averageEpisodeRuntime(details.episode_run_time);

  async function resolveRuntime(
    season: number,
    ep: number,
    listed?: number | null
  ): Promise<number | undefined> {
    let mins = episodeRuntimeMinutes(listed);
    if (mins == null) {
      try {
        const detail = await tmdb.getEpisode(tmdbShowId, season, ep);
        mins = episodeRuntimeMinutes(detail.runtime);
      } catch {
        // Fall through to show average.
      }
    }
    if (mins == null) mins = showAvg;
    return mins ?? undefined;
  }

  const nextAired = airedUnwatched[0];
  if (nextAired) {
    const nextEpisodeRuntime = await resolveRuntime(
      nextAired.season_number,
      nextAired.episode_number,
      nextAired.runtime
    );
    return {
      status: 'watching',
      nextSeasonNum: nextAired.season_number,
      nextEpisodeNum: nextAired.episode_number,
      nextEpisodeName: nextAired.name,
      nextEpisodeAirDate: nextAired.air_date,
      nextEpisodeStillPath: nextAired.still_path ?? '',
      ...(nextEpisodeRuntime != null ? { nextEpisodeRuntime } : {}),
      originalLanguage,
      totalEpisodes,
      unwatchedAiredCount: airedUnwatched.length,
      remainingAiredCount: Math.max(0, airedUnwatched.length - 1),
    };
  }

  const upcoming = nextFuture ?? nextTba;
  if (upcoming) {
    const nextEpisodeRuntime = await resolveRuntime(
      upcoming.season_number,
      upcoming.episode_number,
      upcoming.runtime
    );
    return {
      status: 'upToDate',
      nextSeasonNum: upcoming.season_number,
      nextEpisodeNum: upcoming.episode_number,
      nextEpisodeName: upcoming.name,
      nextEpisodeAirDate: upcoming.air_date,
      nextEpisodeStillPath: upcoming.still_path ?? '',
      ...(nextEpisodeRuntime != null ? { nextEpisodeRuntime } : {}),
      originalLanguage,
      totalEpisodes,
      unwatchedAiredCount: 0,
      remainingAiredCount: 0,
    };
  }

  return {
    status: isShowEnded(details.status) ? 'finished' : 'upToDate',
    originalLanguage,
    totalEpisodes,
    unwatchedAiredCount: 0,
    remainingAiredCount: 0,
  };
}
