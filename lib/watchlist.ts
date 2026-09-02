import { parseAirDay } from './progress';

/** Shows land in "Haven't watched in a while" after this many calendar months. */
export const STALE_MONTHS = 2;

export function staleCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - STALE_MONTHS);
  return cutoff;
}

export type WatchlistBucket = 'watchNext' | 'stale' | 'notStarted';

export type WatchlistShow = {
  id: string;
  status?: unknown;
  tmdbShowId?: unknown;
  addedAt?: unknown;
  lastTouchedAt?: unknown;
};

export function lastWatchedAt(
  watchedEps: { tmdbShowId?: unknown; watchedAt?: unknown }[],
  tmdbShowId: number
): number | null {
  let max = 0;
  for (const e of watchedEps) {
    if (e.tmdbShowId !== tmdbShowId) continue;
    const t = new Date(e.watchedAt as string | number).getTime();
    if (t > max) max = t;
  }
  return max || null;
}

export function watchedCount(
  watchedEps: { tmdbShowId?: unknown }[],
  tmdbShowId: number
): number {
  let n = 0;
  for (const e of watchedEps) {
    if (e.tmdbShowId === tmdbShowId) n++;
  }
  return n;
}

/** Sort key: explicit last edit, else last watch, else date added. */
export function sortTime(
  show: WatchlistShow,
  lastWatch: number | null
): number {
  if (show.lastTouchedAt != null) {
    const t = new Date(show.lastTouchedAt as string | number).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (lastWatch) return lastWatch;
  const added = new Date(show.addedAt as string | number).getTime();
  return Number.isNaN(added) ? 0 : added;
}

export function bucketForShow(
  show: WatchlistShow,
  episodeCount: number,
  lastWatch: number | null
): WatchlistBucket {
  if (episodeCount === 0) return 'notStarted';
  const last = lastWatch ?? sortTime(show, null);
  if (last < staleCutoff().getTime()) return 'stale';
  return 'watchNext';
}

export function sortWatchNext<T extends WatchlistShow>(
  shows: T[],
  lastWatchOf: (show: T) => number | null
): T[] {
  return [...shows].sort(
    (a, b) => sortTime(b, lastWatchOf(b)) - sortTime(a, lastWatchOf(a))
  );
}

export function sortStale<T extends WatchlistShow>(
  shows: T[],
  lastWatchOf: (show: T) => number | null
): T[] {
  return [...shows].sort((a, b) => {
    const la = lastWatchOf(a) ?? sortTime(a, null);
    const lb = lastWatchOf(b) ?? sortTime(b, null);
    return la - lb;
  });
}

export function sortNotStarted<T extends WatchlistShow>(
  shows: T[],
  lastWatchOf: (show: T) => number | null
): T[] {
  return [...shows].sort(
    (a, b) => sortTime(b, lastWatchOf(b)) - sortTime(a, lastWatchOf(a))
  );
}

export type UpcomingBucket =
  | 'today'
  | 'thisWeek'
  | 'nextWeek'
  | 'laterThisMonth'
  | 'nextMonth'
  | 'later';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday 00:00 of the calendar week containing `d` (ISO / European week). */
function mondayOf(d = new Date()): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const offset = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + offset);
  return x;
}

function lastDayOfMonth(year: number, month: number): Date {
  return startOfDay(new Date(year, month + 1, 0));
}

export function airDateMs(iso?: string | null): number | null {
  const d = parseAirDay(iso);
  return d ? d.getTime() : null;
}

/**
 * Chronological upcoming groups without overlapping labels:
 * today → rest of this week → next week → later this month → next month → later.
 */
export function upcomingBucket(airDate?: string | null): UpcomingBucket {
  const air = airDateMs(airDate);
  if (air == null) return 'later';

  const today = startOfDay();
  if (air === today.getTime()) return 'today';

  const thisMonday = mondayOf(today);
  const thisWeekEnd = new Date(thisMonday.getTime() + 6 * DAY_MS);
  const nextWeekEnd = new Date(thisMonday.getTime() + 13 * DAY_MS);
  const thisMonthEnd = lastDayOfMonth(today.getFullYear(), today.getMonth());
  const nextMonthEnd = lastDayOfMonth(today.getFullYear(), today.getMonth() + 1);

  if (air <= thisWeekEnd.getTime()) return 'thisWeek';
  if (air <= nextWeekEnd.getTime()) return 'nextWeek';
  if (air <= thisMonthEnd.getTime()) return 'laterThisMonth';
  if (air <= nextMonthEnd.getTime()) return 'nextMonth';
  return 'later';
}

export function sortByAirDate<T>(
  shows: T[],
  airOf: (show: T) => string | null | undefined
): T[] {
  return [...shows].sort((a, b) => {
    const aa = airDateMs(airOf(a)) ?? Number.MAX_SAFE_INTEGER;
    const bb = airDateMs(airOf(b)) ?? Number.MAX_SAFE_INTEGER;
    if (aa !== bb) return aa - bb;
    return 0;
  });
}
