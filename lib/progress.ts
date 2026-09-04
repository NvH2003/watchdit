import { averageEpisodeRuntime, episodeRuntimeMinutes } from './stats';
import { tmdb } from './tmdb';

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

/** True only when TMDB has a real air date that is today or earlier. Missing dates are not out. */
export function hasAired(iso?: string | null): boolean {
  const air = parseAirDay(iso);
  if (!air) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return air.getTime() <= today.getTime();
}

/** True when TMDB has a real air date in the future (not a placeholder episode). */
export function isFutureAirDate(iso?: string | null): boolean {
  const air = parseAirDay(iso);
  if (!air) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return air.getTime() > today.getTime();
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
  }
): boolean {
  if (status !== 'watching' && status !== 'upToDate') return false;
  if (!hasAired(nextEpisodeAirDate)) return false;
  const season = opts?.nextSeasonNum;
  const ep = opts?.nextEpisodeNum;
  if (
    opts?.watchedKeys &&
    season != null &&
    ep != null &&
    Number.isFinite(season) &&
    Number.isFinite(ep) &&
    opts.watchedKeys.has(`${season}x${ep}`)
  ) {
    return false;
  }
  return true;
}

/** Show belongs on Coming up while the next unwatched episode still has a future air date. */
export function readyForUpcoming(
  status?: string | null,
  nextEpisodeAirDate?: string | null,
  opts?: {
    nextSeasonNum?: number | null;
    nextEpisodeNum?: number | null;
    watchedKeys?: Set<string>;
  }
): boolean {
  if (status !== 'watching' && status !== 'upToDate') return false;
  if (!isFutureAirDate(nextEpisodeAirDate)) return false;
  const season = opts?.nextSeasonNum;
  const ep = opts?.nextEpisodeNum;
  if (
    opts?.watchedKeys &&
    season != null &&
    ep != null &&
    Number.isFinite(season) &&
    Number.isFinite(ep) &&
    opts.watchedKeys.has(`${season}x${ep}`)
  ) {
    return false;
  }
  return true;
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
};

export type WatchStatus = 'watching' | 'upToDate' | 'finished';

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
  tmdbStatus?: string | null
): ProgressResult {
  const unwatched = episodes.filter(
    e => e.season > 0 && !watched.has(`${e.season}x${e.ep}`)
  );
  const unwatchedAired = unwatched.filter(e => hasAired(e.airDate));
  const nextAired = unwatchedAired[0];
  const nextFuture = unwatched.find(e => isFutureAirDate(e.airDate));
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

  if (nextFuture) {
    const runtime = Number(nextFuture.runtime);
    return {
      status: 'upToDate',
      nextSeasonNum: nextFuture.season,
      nextEpisodeNum: nextFuture.ep,
      nextEpisodeName: nextFuture.name,
      nextEpisodeAirDate: nextFuture.airDate,
      nextEpisodeStillPath: nextFuture.stillPath ?? '',
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
  startSeason = 1
): Promise<ProgressResult> {
  const details = await tmdb.getShow(tmdbShowId);
  const lang = details.original_language || undefined;
  const totalSeasons = details.number_of_seasons ?? 0;
  const from = Math.max(1, startSeason);
  const totalEpisodes = details.number_of_episodes;
  const seasonMeta = details.seasons ?? [];

  type NextEp = {
    season_number: number;
    episode_number: number;
    name: string;
    air_date: string;
    still_path: string | null;
    runtime?: number | null;
  };
  const airedUnwatched: NextEp[] = [];
  let nextFuture: NextEp | null = null;

  for (let s = from; s <= totalSeasons; s++) {
    const meta = seasonMeta.find(m => m.season_number === s);
    if (meta && meta.episode_count === 0 && !isFutureAirDate(meta.air_date)) {
      continue;
    }

    const season = await tmdb.getSeason(tmdbShowId, s, lang);
    const eps = (season.episodes ?? []).filter(e => e.season_number > 0);

    for (const e of eps) {
      if (watched.has(`${e.season_number}x${e.episode_number}`)) continue;

      const airDate = e.air_date ?? '';
      if (hasAired(airDate)) {
        airedUnwatched.push({
          season_number: e.season_number,
          episode_number: e.episode_number,
          name: e.name,
          air_date: airDate,
          still_path: e.still_path ?? null,
          runtime: e.runtime,
        });
        continue;
      }

      if (isFutureAirDate(airDate) && !nextFuture) {
        nextFuture = {
          season_number: e.season_number,
          episode_number: e.episode_number,
          name: e.name,
          air_date: airDate,
          still_path: e.still_path ?? null,
          runtime: e.runtime,
        };
      }
    }

    const seasonAir =
      season.air_date ??
      seasonMeta.find(m => m.season_number === s)?.air_date ??
      '';
    const seasonTouched = eps.some(e =>
      watched.has(`${e.season_number}x${e.episode_number}`) || hasAired(e.air_date)
    );
    if (airedUnwatched.length === 0 && !nextFuture && !seasonTouched && isFutureAirDate(seasonAir)) {
      nextFuture = {
        season_number: s,
        episode_number: 1,
        name: '',
        air_date: seasonAir,
        still_path: null,
      };
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
        const detail = await tmdb.getEpisode(tmdbShowId, season, ep, lang);
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
      originalLanguage: lang ?? '',
      totalEpisodes,
      unwatchedAiredCount: airedUnwatched.length,
      remainingAiredCount: Math.max(0, airedUnwatched.length - 1),
    };
  }

  if (nextFuture) {
    const nextEpisodeRuntime = await resolveRuntime(
      nextFuture.season_number,
      nextFuture.episode_number,
      nextFuture.runtime
    );
    return {
      status: 'upToDate',
      nextSeasonNum: nextFuture.season_number,
      nextEpisodeNum: nextFuture.episode_number,
      nextEpisodeName: nextFuture.name,
      nextEpisodeAirDate: nextFuture.air_date,
      nextEpisodeStillPath: nextFuture.still_path ?? '',
      ...(nextEpisodeRuntime != null ? { nextEpisodeRuntime } : {}),
      originalLanguage: lang ?? '',
      totalEpisodes,
      unwatchedAiredCount: 0,
      remainingAiredCount: 0,
    };
  }

  return {
    status: isShowEnded(details.status) ? 'finished' : 'upToDate',
    originalLanguage: lang ?? '',
    totalEpisodes,
    unwatchedAiredCount: 0,
    remainingAiredCount: 0,
  };
}
