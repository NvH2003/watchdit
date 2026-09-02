export type WatchHistoryEntry = {
  id: string;
  tmdbShowId: number;
  showName: string;
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
      tmdbShowId: row.tmdbShowId,
      showName: (show?.tmdbShowName as string | undefined) || 'Unknown show',
      posterPath: (show?.tmdbPosterPath as string | undefined) || null,
      seasonNumber: Number(row.seasonNumber) || 0,
      episodeNumber: Number(row.episodeNumber) || 0,
      watchedAt: t,
    });
  }

  entries.sort((a, b) => {
    if (b.watchedAt !== a.watchedAt) return b.watchedAt - a.watchedAt;
    const name = a.showName.localeCompare(b.showName);
    if (name !== 0) return name;
    if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
    return a.episodeNumber - b.episodeNumber;
  });
  const q = query.trim().toLowerCase();
  const matched = q
    ? entries.filter(entry => entry.showName.toLowerCase().includes(q))
    : entries;
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
