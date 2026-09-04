/** Default only when TMDB has no per-episode or show-level runtime. */
export const DEFAULT_EPISODE_MINUTES = 42;
/** Default when a finished movie has no stored runtime. */
export const DEFAULT_MOVIE_MINUTES = 110;

/** Exact minutes from a TMDB episode `runtime` field. */
export function episodeRuntimeMinutes(
  runtime?: number | null
): number | null {
  const n = Number(runtime);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

type WatchedRow = {
  tmdbShowId?: unknown;
  watchedAt?: unknown;
  runtime?: unknown;
};

type ShowRow = {
  id: string;
  tmdbShowId?: unknown;
  status?: unknown;
  episodeRuntime?: unknown;
};

type MovieRow = {
  status?: unknown;
  runtime?: unknown;
  watchedAt?: unknown;
};

function watchedAtMs(value: unknown): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
  return Number.isNaN(t) ? null : t;
}

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Average TMDB `episode_run_time` entry, or null if missing. */
export function averageEpisodeRuntime(runTimes?: number[] | null): number | null {
  if (!runTimes?.length) return null;
  const valid = runTimes.filter(n => typeof n === 'number' && n > 0);
  if (!valid.length) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/**
 * Profile duration: years / months / days / hours.
 * Years are omitted when still zero. Zero units are skipped.
 * Under one hour, shows minutes.
 */
export function formatDurationMinutes(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < 60) return `${mins}m`;

  const totalHours = Math.floor(mins / 60);
  const hoursPerDay = 24;
  const hoursPerMonth = hoursPerDay * 30;
  const hoursPerYear = hoursPerDay * 365;

  const years = Math.floor(totalHours / hoursPerYear);
  let rem = totalHours % hoursPerYear;
  const months = Math.floor(rem / hoursPerMonth);
  rem = rem % hoursPerMonth;
  const days = Math.floor(rem / hoursPerDay);
  const hours = rem % hoursPerDay;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}mo`);
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || parts.length === 0) parts.push(`${hours}h`);
  return parts.join(' ');
}

export type WatchStats = {
  episodeCount: number;
  movieWatchedCount: number;
  showCount: number;
  finishedShows: number;
  watchingShows: number;
  upToDateShows: number;
  episodeMinutes: number;
  movieMinutes: number;
  totalMinutes: number;
  thisWeekEpisodes: number;
  thisWeekMinutes: number;
  activeDays: number;
  usedEpisodeFallback: boolean;
};

export function computeWatchStats(
  watchedEpisodes: WatchedRow[],
  shows: ShowRow[],
  movies: MovieRow[],
  now = new Date()
): WatchStats {
  const runtimeByShow = new Map<number, number>();
  let usedEpisodeFallback = false;
  for (const show of shows) {
    const tmdbId = Number(show.tmdbShowId);
    if (!Number.isFinite(tmdbId)) continue;
    const stored = Number(show.episodeRuntime);
    if (Number.isFinite(stored) && stored > 0) {
      runtimeByShow.set(tmdbId, stored);
    }
  }

  const weekStart = startOfDay(now);
  weekStart.setDate(weekStart.getDate() - 6);

  let episodeCount = 0;
  let episodeMinutes = 0;
  let thisWeekEpisodes = 0;
  let thisWeekMinutes = 0;
  const dayKeys = new Set<string>();

  for (const row of watchedEpisodes) {
    const tmdbId = Number(row.tmdbShowId);
    if (!Number.isFinite(tmdbId)) continue;
    const t = watchedAtMs(row.watchedAt);
    if (t == null) continue;

    episodeCount++;
    const exact = episodeRuntimeMinutes(row.runtime as number | null | undefined);
    let mins = exact ?? runtimeByShow.get(tmdbId) ?? null;
    if (mins == null) {
      mins = DEFAULT_EPISODE_MINUTES;
      usedEpisodeFallback = true;
    }
    episodeMinutes += mins;

    const day = new Date(t);
    dayKeys.add(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    );

    if (t >= weekStart.getTime()) {
      thisWeekEpisodes++;
      thisWeekMinutes += mins;
    }
  }

  let movieWatchedCount = 0;
  let movieMinutes = 0;
  for (const movie of movies) {
    if (movie.status !== 'finished') continue;
    movieWatchedCount++;
    const runtime = Number(movie.runtime);
    movieMinutes += Number.isFinite(runtime) && runtime > 0 ? runtime : DEFAULT_MOVIE_MINUTES;
  }

  let finishedShows = 0;
  let watchingShows = 0;
  let upToDateShows = 0;
  for (const show of shows) {
    if (show.status === 'finished') finishedShows++;
    else if (show.status === 'watching') watchingShows++;
    else if (show.status === 'upToDate') upToDateShows++;
  }

  return {
    episodeCount,
    movieWatchedCount,
    showCount: shows.length,
    finishedShows,
    watchingShows,
    upToDateShows,
    episodeMinutes,
    movieMinutes,
    totalMinutes: episodeMinutes + movieMinutes,
    thisWeekEpisodes,
    thisWeekMinutes,
    activeDays: dayKeys.size,
    usedEpisodeFallback,
  };
}
