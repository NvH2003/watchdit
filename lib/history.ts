export type WatchHistoryEntry = {
  id: string;
  kind: 'tv' | 'movie';
  tmdbId: number;
  title: string;
  posterPath: string | null;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: number;
};

export type WatchHistoryDay = {
  key: string;
  label: string;
  entries: WatchHistoryEntry[];
};

type WatchedRow = {
  id: string;
  tmdbShowId?: unknown;
  seasonNumber?: unknown;
  episodeNumber?: unknown;
  watchedAt?: unknown;
};

type ShowRow = {
  tmdbShowId?: unknown;
  tmdbShowName?: unknown;
  tmdbPosterPath?: unknown;
};

type MovieRow = {
  id: string;
  tmdbMovieId?: unknown;
  tmdbMovieName?: unknown;
  tmdbPosterPath?: unknown;
  status?: unknown;
  watchedAt?: unknown;
  runtime?: unknown;
};

function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function watchedAtMs(value: unknown): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
  return Number.isNaN(t) ? null : t;
}

export function historyDayLabel(key: string, now = new Date()): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === yesterday.getTime()) return 'Yesterday';

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  if (date >= weekAgo && date < today) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')} | E${String(episode).padStart(2, '0')}`;
}

export function formatWatchTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function countValidWatches(watched: WatchedRow[]): number {
  let n = 0;
  for (const row of watched) {
    if (typeof row.tmdbShowId !== 'number') continue;
    if (watchedAtMs(row.watchedAt) != null) n++;
  }
  return n;
}

function sortEntries(entries: WatchHistoryEntry[]): WatchHistoryEntry[] {
  return [...entries].sort((a, b) => {
    if (b.watchedAt !== a.watchedAt) return b.watchedAt - a.watchedAt;
    const name = a.title.localeCompare(b.title);
    if (name !== 0) return name;
    if (a.kind !== b.kind) return a.kind === 'tv' ? -1 : 1;
    if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
    return a.episodeNumber - b.episodeNumber;
  });
}

function groupEntriesByDay(
  matched: WatchHistoryEntry[],
  limit: number
): { days: WatchHistoryDay[]; matchedTotal: number } {
  const sliced = matched.slice(0, Math.max(0, limit));
  const days: WatchHistoryDay[] = [];
  const byKey = new Map<string, WatchHistoryDay>();
  for (const entry of sliced) {
    const key = dayKey(entry.watchedAt);
    let day = byKey.get(key);
    if (!day) {
      day = { key, label: historyDayLabel(key), entries: [] };
      byKey.set(key, day);
      days.push(day);
    }
    day.entries.push(entry);
  }
  return { days, matchedTotal: matched.length };
}

export function buildWatchHistory(
  watched: WatchedRow[],
  shows: ShowRow[],
  limit: number,
  query = ''
): { days: WatchHistoryDay[]; matchedTotal: number } {
  const showById = new Map<number, ShowRow>();
  for (const show of shows) {
    if (typeof show.tmdbShowId === 'number' && !showById.has(show.tmdbShowId)) {
      showById.set(show.tmdbShowId, show);
    }
  }

  const entries: WatchHistoryEntry[] = [];
  for (const row of watched) {
    if (typeof row.tmdbShowId !== 'number') continue;
    const t = watchedAtMs(row.watchedAt);
    if (t == null) continue;
    const show = showById.get(row.tmdbShowId);
    entries.push({
      id: row.id,
      kind: 'tv',
      tmdbId: row.tmdbShowId,
      title: (show?.tmdbShowName as string | undefined) || 'Unknown show',
      posterPath: (show?.tmdbPosterPath as string | undefined) || null,
      seasonNumber: Number(row.seasonNumber) || 0,
      episodeNumber: Number(row.episodeNumber) || 0,
      watchedAt: t,
    });
  }

  const sorted = sortEntries(entries);
  const q = query.trim().toLowerCase();
  const matched = q
    ? sorted.filter(entry => entry.title.toLowerCase().includes(q))
    : sorted;
  return groupEntriesByDay(matched, limit);
}

/** Finished movies with a watchedAt, same day grouping as series history. */
export function buildMovieWatchHistory(
  movies: MovieRow[],
  limit: number,
  query = ''
): { days: WatchHistoryDay[]; matchedTotal: number } {
  const entries: WatchHistoryEntry[] = [];
  for (const movie of movies) {
    if (movie.status !== 'finished') continue;
    const tmdbId = Number(movie.tmdbMovieId);
    if (!Number.isFinite(tmdbId)) continue;
    const t = watchedAtMs(movie.watchedAt);
    if (t == null) continue;
    entries.push({
      id: movie.id,
      kind: 'movie',
      tmdbId,
      title: (movie.tmdbMovieName as string | undefined) || 'Unknown movie',
      posterPath: (movie.tmdbPosterPath as string | undefined) || null,
      seasonNumber: 0,
      episodeNumber: 0,
      watchedAt: t,
    });
  }

  const sorted = sortEntries(entries);
  const q = query.trim().toLowerCase();
  const matched = q
    ? sorted.filter(entry => entry.title.toLowerCase().includes(q))
    : sorted;
  return groupEntriesByDay(matched, limit);
}

/** Merge series + movie history into one chronological timeline. */
export function buildCombinedWatchHistory(
  watched: WatchedRow[],
  shows: ShowRow[],
  movies: MovieRow[],
  limit: number,
  query = ''
): { days: WatchHistoryDay[]; matchedTotal: number } {
  const tv = buildWatchHistory(watched, shows, Number.MAX_SAFE_INTEGER, query);
  const film = buildMovieWatchHistory(movies, Number.MAX_SAFE_INTEGER, query);
  const all = sortEntries([
    ...tv.days.flatMap(d => d.entries),
    ...film.days.flatMap(d => d.entries),
  ]);
  return groupEntriesByDay(all, limit);
}

export type WatchHistorySession = {
  id: string;
  kind: 'tv' | 'movie';
  tmdbId: number;
  title: string;
  posterPath: string | null;
  watchedAt: number;
  episodes: { season: number; episode: number }[];
};

/** Collapse consecutive checks of the same show (within a day list) into one row. */
export function collapseHistorySessions(entries: WatchHistoryEntry[]): WatchHistorySession[] {
  const sessions: WatchHistorySession[] = [];
  for (const entry of entries) {
    const last = sessions[sessions.length - 1];
    if (
      last &&
      last.kind === entry.kind &&
      last.tmdbId === entry.tmdbId &&
      entry.kind === 'tv'
    ) {
      last.episodes.push({
        season: entry.seasonNumber,
        episode: entry.episodeNumber,
      });
      continue;
    }
    sessions.push({
      id: entry.id,
      kind: entry.kind,
      tmdbId: entry.tmdbId,
      title: entry.title,
      posterPath: entry.posterPath,
      watchedAt: entry.watchedAt,
      episodes:
        entry.kind === 'tv'
          ? [{ season: entry.seasonNumber, episode: entry.episodeNumber }]
          : [],
    });
  }
  return sessions;
}

/** Compact label: "S02 | E04", range, or "Movie". */
export function formatSessionEpisodes(
  episodes: { season: number; episode: number }[],
  kind: 'tv' | 'movie' = 'tv'
): string {
  if (kind === 'movie') return 'Movie';
  if (episodes.length === 0) return '';
  const sorted = [...episodes].sort((a, b) =>
    a.season !== b.season ? a.season - b.season : a.episode - b.episode
  );
  if (sorted.length === 1) {
    return episodeCode(sorted[0].season, sorted[0].episode);
  }

  const sameSeason = sorted.every(e => e.season === sorted[0].season);
  const consecutive =
    sameSeason &&
    sorted.every((e, i) => i === 0 || e.episode === sorted[i - 1].episode + 1);

  if (consecutive) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return `${sorted.length} ep · S${String(first.season).padStart(2, '0')} | E${String(first.episode).padStart(2, '0')}–E${String(last.episode).padStart(2, '0')}`;
  }

  const first = sorted[0];
  return `${sorted.length} episodes · ${episodeCode(first.season, first.episode)}+`;
}
