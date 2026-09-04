import { useEffect, useRef, useState } from 'react';
import { id as instantId } from '@instantdb/react-native';
import db from './db';
import {
  findProgressFromTmdb,
  hasAired,
  localDayKey,
  msUntilNextLocalMidnight,
  progressUpdates,
} from './progress';
import { averageEpisodeRuntime, episodeRuntimeMinutes } from './stats';
import { tmdb } from './tmdb';
import { staleCutoff } from './watchlist';

/** Touch timestamp that places a show in "Haven't watched in a while". */
export function staleWatchlistTouchIso(now = new Date()): string {
  return new Date(staleCutoff(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Move a show onto Watching and refresh next-episode fields so it can appear
 * on To watch immediately. From Watch Later, lands in "Haven't watched in a while".
 */
export async function activateShowWatching(opts: {
  userShowId: string;
  tmdbShowId: number;
  watchedKeys: Set<string>;
  fromWatchLater?: boolean;
  startSeason?: number;
  originalLanguage?: string;
}): Promise<void> {
  const progress = await findProgressFromTmdb(
    opts.tmdbShowId,
    opts.watchedKeys,
    opts.startSeason ?? 1
  );
  const updates: Record<string, unknown> = {
    ...progressUpdates(progress),
  };
  // Keep the user's Watching choice if TMDB would mark the show finished.
  if (updates.status === 'finished') {
    updates.status = 'watching';
  }
  if (opts.fromWatchLater) {
    updates.lastTouchedAt = staleWatchlistTouchIso();
  }
  if (opts.originalLanguage) {
    updates.tmdbOriginalLanguage = opts.originalLanguage;
  }
  await db.transact([db.tx.userShows[opts.userShowId].update(updates)]);
}

export function ownerShowKey(userId: string, tmdbShowId: number): string {
  return `${userId}:${tmdbShowId}`;
}

export function createUserShowTx(
  userId: string,
  attrs: {
    tmdbShowId: number;
    tmdbShowName: string;
    tmdbPosterPath?: string;
    status: string;
    addedAt: string;
    lastTouchedAt?: string;
    tmdbOriginalLanguage?: string;
    episodeRuntime?: number;
    totalEpisodes?: number;
    nextSeasonNum?: number;
    nextEpisodeNum?: number;
    nextEpisodeName?: string;
    nextEpisodeAirDate?: string;
    nextEpisodeStillPath?: string;
    tvTimeSeriesId?: number;
  }
) {
  const entityId = instantId();
  return {
    entityId,
    tx: db.tx.userShows[entityId]
      .update({
        ownerShowKey: ownerShowKey(userId, attrs.tmdbShowId),
        ...attrs,
      })
      .link({ $user: userId }),
  };
}

type UserShowRow = {
  id: string;
  tmdbShowId?: unknown;
  lastTouchedAt?: unknown;
  addedAt?: unknown;
  ownerShowKey?: unknown;
};

function timeOf(v: unknown): number {
  if (v == null) return 0;
  const t = new Date(v as string | number).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function isPreferredShow(a: UserShowRow, b: UserShowRow): boolean {
  const ta = timeOf(a.lastTouchedAt) || timeOf(a.addedAt);
  const tb = timeOf(b.lastTouchedAt) || timeOf(b.addedAt);
  if (ta !== tb) return ta > tb;
  return a.id < b.id;
}

/** One row per TMDB show, keeping the most recently touched copy. */
export function uniqueByTmdbShowId<T extends UserShowRow>(shows: T[]): T[] {
  const best = new Map<number, T>();
  for (const show of shows) {
    const tmdbId = Number(show.tmdbShowId);
    if (!Number.isFinite(tmdbId)) continue;
    const prev = best.get(tmdbId);
    if (!prev || isPreferredShow(show, prev)) best.set(tmdbId, show);
  }
  const seen = new Set<number>();
  const out: T[] = [];
  for (const show of shows) {
    const tmdbId = Number(show.tmdbShowId);
    if (!Number.isFinite(tmdbId)) continue;
    if (best.get(tmdbId)?.id !== show.id || seen.has(tmdbId)) continue;
    seen.add(tmdbId);
    out.push(show);
  }
  return out;
}

export function extraDuplicateIds(shows: UserShowRow[]): string[] {
  const keep = new Set(uniqueByTmdbShowId(shows).map(s => s.id));
  return shows.filter(s => !keep.has(s.id)).map(s => s.id);
}

/** Deletes extra copies of the same series and stamps a per-user unique key. */
export function useDedupeUserShows() {
  const { user } = db.useAuth();
  const { data } = db.useQuery(
    user ? { userShows: { $: { where: { '$user.id': user.id } } } } : null
  );
  const busy = useRef(false);

  useEffect(() => {
    if (!user || !data?.userShows || busy.current) return;
    const shows = data.userShows;
    const extras = extraDuplicateIds(shows);
    const keepers = uniqueByTmdbShowId(shows);
    const keyUpdates = keepers.filter(s => {
      const tmdbId = Number(s.tmdbShowId);
      if (!Number.isFinite(tmdbId)) return false;
      return (s.ownerShowKey as string | undefined) !== ownerShowKey(user.id, tmdbId);
    });
    if (extras.length === 0 && keyUpdates.length === 0) return;

    busy.current = true;
    const run = async () => {
      try {
        if (extras.length > 0) {
          await db.transact(extras.map(id => db.tx.userShows[id].delete()));
          return;
        }
        if (keyUpdates.length > 0) {
          await db.transact(
            keyUpdates.map(s =>
              db.tx.userShows[s.id].update({
                ownerShowKey: ownerShowKey(user.id, Number(s.tmdbShowId)),
              })
            )
          );
        }
      } catch (e) {
        console.warn('Failed to dedupe shows', e);
      } finally {
        busy.current = false;
      }
    };
    run();
  }, [user, data?.userShows]);
}

/**
 * When an up-to-date show's next *unwatched* episode airs, flip to watching.
 * Also repairs stale nextEpisode* rows that still point at an already-checked episode
 * (those used to wrongly flood To watch after the air-date promote change).
 */
export function usePromoteAiredUpToDate() {
  const { user } = db.useAuth();
  const { data } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );
  const [dayKey, setDayKey] = useState(() => localDayKey());
  const busy = useRef(false);

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;
    const armMidnight = () => {
      midnightTimer = setTimeout(() => {
        setDayKey(localDayKey());
        armMidnight();
      }, msUntilNextLocalMidnight());
    };
    armMidnight();
    const poll = setInterval(() => {
      const key = localDayKey();
      setDayKey(prev => (prev === key ? prev : key));
    }, 60_000);
    return () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (!user || !data?.userShows || busy.current) return;

    const watchedByShow = new Map<number, Set<string>>();
    for (const e of data.watchedEpisodes ?? []) {
      const tmdbId = Number(e.tmdbShowId);
      if (!Number.isFinite(tmdbId)) continue;
      let set = watchedByShow.get(tmdbId);
      if (!set) {
        set = new Set();
        watchedByShow.set(tmdbId, set);
      }
      set.add(`${e.seasonNumber}x${e.episodeNumber}`);
    }

    const clearStaleNext = {
      nextSeasonNum: null,
      nextEpisodeNum: null,
      nextEpisodeName: '',
      nextEpisodeAirDate: '',
      nextEpisodeStillPath: '',
      nextEpisodeRuntime: null,
      unwatchedAiredCount: 0,
      remainingAiredCount: 0,
    };

    const txs: ReturnType<typeof db.tx.userShows[string]['update']>[] = [];

    for (const s of data.userShows) {
      if (s.status === 'watchLater' || s.status === 'finished') continue;
      const tmdbId = Number(s.tmdbShowId);
      const season = s.nextSeasonNum as number | undefined;
      const ep = s.nextEpisodeNum as number | undefined;
      const air = s.nextEpisodeAirDate as string | undefined;
      const watched = watchedByShow.get(tmdbId);
      const nextKey =
        season != null && ep != null && Number.isFinite(season) && Number.isFinite(ep)
          ? `${season}x${ep}`
          : null;
      const nextAlreadyWatched = Boolean(nextKey && watched?.has(nextKey));

      if (nextAlreadyWatched) {
        // Stale pointer at a checked episode — park as up to date until TMDB refresh.
        txs.push(
          db.tx.userShows[s.id].update({
            status: 'upToDate',
            ...clearStaleNext,
          })
        );
        continue;
      }

      if (s.status === 'upToDate' && hasAired(air) && nextKey) {
        txs.push(db.tx.userShows[s.id].update({ status: 'watching' }));
      }
    }

    if (txs.length === 0) return;

    busy.current = true;
    db.transact(txs)
      .catch(e => console.warn('Failed to promote/repair aired shows', e))
      .finally(() => {
        busy.current = false;
      });
  }, [user, data?.userShows, data?.watchedEpisodes, dayKey]);
}

/**
 * Keep runtimes filled without opening each show.
 * Interval + inFlight (not a one-shot busy skip): Instant writes used to cancel the
 * effect while busy stayed true, so the rest of the queue never ran.
 */
export function useBackfillEpisodeRuntimes() {
  const { user } = db.useAuth();
  const { data } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );
  const inFlight = useRef(false);
  const showsRef = useRef(data?.userShows);
  const watchedRef = useRef(data?.watchedEpisodes);
  showsRef.current = data?.userShows;
  watchedRef.current = data?.watchedEpisodes;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function resolveNextRuntime(show: {
      id: string;
      tmdbShowId?: unknown;
      nextSeasonNum?: unknown;
      nextEpisodeNum?: unknown;
      tmdbOriginalLanguage?: unknown;
      episodeRuntime?: unknown;
      status?: unknown;
      nextEpisodeAirDate?: unknown;
    }): Promise<void> {
      const tmdbId = Number(show.tmdbShowId);
      const seasonNum = Number(show.nextSeasonNum);
      const epNum = Number(show.nextEpisodeNum);
      if (!Number.isFinite(tmdbId) || !Number.isFinite(seasonNum) || !Number.isFinite(epNum)) {
        return;
      }
      const lang = (show.tmdbOriginalLanguage as string | undefined) || undefined;
      let nextRuntime: number | null = null;

      try {
        const season = await tmdb.getSeason(tmdbId, seasonNum, lang);
        const ep = (season.episodes ?? []).find(e => e.episode_number === epNum);
        nextRuntime = episodeRuntimeMinutes(ep?.runtime);
      } catch {
        // Fall through.
      }

      if (nextRuntime == null) {
        try {
          const detail = await tmdb.getEpisode(tmdbId, seasonNum, epNum, lang);
          nextRuntime = episodeRuntimeMinutes(detail.runtime);
        } catch {
          // Fall through.
        }
      }

      let showAvg = Number(show.episodeRuntime);
      if (!(Number.isFinite(showAvg) && showAvg > 0)) showAvg = NaN;

      if (nextRuntime == null && !Number.isFinite(showAvg)) {
        try {
          const details = await tmdb.getShow(tmdbId);
          showAvg = averageEpisodeRuntime(details.episode_run_time) ?? NaN;
          nextRuntime = Number.isFinite(showAvg) ? showAvg : null;
        } catch {
          return;
        }
      } else if (nextRuntime == null && Number.isFinite(showAvg)) {
        nextRuntime = showAvg;
      }

      if (nextRuntime == null) return;

      const updates: Record<string, unknown> = {
        nextEpisodeRuntime: nextRuntime,
      };
      if (!Number.isFinite(Number(show.episodeRuntime)) || Number(show.episodeRuntime) <= 0) {
        updates.episodeRuntime = nextRuntime;
      }
      await db.transact([db.tx.userShows[show.id].update(updates)]);
    }

    async function fillBatch() {
      if (cancelled || inFlight.current) return;
      inFlight.current = true;
      try {
        const shows = uniqueByTmdbShowId(showsRef.current ?? []);

        const missingNext = shows
          .filter(s => {
            if (s.status !== 'watching' && s.status !== 'upToDate') return false;
            const season = Number(s.nextSeasonNum);
            const ep = Number(s.nextEpisodeNum);
            if (!Number.isFinite(season) || season < 1) return false;
            if (!Number.isFinite(ep) || ep < 1) return false;
            const nextRt = Number(s.nextEpisodeRuntime);
            return !(Number.isFinite(nextRt) && nextRt > 0);
          })
          // To watch (aired watching) first so the Episodes list fills sooner.
          .sort((a, b) => {
            const aAired = a.status === 'watching' && hasAired(a.nextEpisodeAirDate as string | undefined) ? 0 : 1;
            const bAired = b.status === 'watching' && hasAired(b.nextEpisodeAirDate as string | undefined) ? 0 : 1;
            return aAired - bAired;
          });

        for (const show of missingNext.slice(0, 8)) {
          if (cancelled) return;
          try {
            await resolveNextRuntime(show);
          } catch (e) {
            console.warn('Failed to fill next episode runtime', e);
          }
          await new Promise(r => setTimeout(r, 100));
        }

        // Show-level averages when still missing (fallback for UI + stats).
        const missingShows = shows.filter(s => {
          const runtime = Number(s.episodeRuntime);
          return !(Number.isFinite(runtime) && runtime > 0);
        });
        for (const show of missingShows.slice(0, 3)) {
          if (cancelled) return;
          const tmdbId = Number(show.tmdbShowId);
          if (!Number.isFinite(tmdbId)) continue;
          try {
            const details = await tmdb.getShow(tmdbId);
            const runtime = averageEpisodeRuntime(details.episode_run_time);
            if (runtime == null) continue;
            await db.transact([
              db.tx.userShows[show.id].update({ episodeRuntime: runtime }),
            ]);
          } catch {
            // Retry on next tick.
          }
        }

        const missingEps = (watchedRef.current ?? []).filter(e => {
          const runtime = Number(e.runtime);
          return !(Number.isFinite(runtime) && runtime > 0);
        });
        if (missingEps.length === 0 || cancelled) return;

        const bySeason = new Map<string, typeof missingEps>();
        for (const ep of missingEps) {
          const tmdbId = Number(ep.tmdbShowId);
          const season = Number(ep.seasonNumber);
          if (!Number.isFinite(tmdbId) || !Number.isFinite(season)) continue;
          const key = `${tmdbId}:${season}`;
          const list = bySeason.get(key) ?? [];
          list.push(ep);
          bySeason.set(key, list);
        }

        for (const key of [...bySeason.keys()].slice(0, 2)) {
          if (cancelled) return;
          const [tmdbRaw, seasonRaw] = key.split(':');
          const tmdbId = Number(tmdbRaw);
          const seasonNum = Number(seasonRaw);
          const rows = bySeason.get(key) ?? [];
          try {
            const show = shows.find(s => Number(s.tmdbShowId) === tmdbId);
            const lang = (show?.tmdbOriginalLanguage as string | undefined) || undefined;
            const season = await tmdb.getSeason(tmdbId, seasonNum, lang);
            const runtimeByEp = new Map<number, number>();
            for (const ep of season.episodes ?? []) {
              const mins = episodeRuntimeMinutes(ep.runtime);
              if (mins != null) runtimeByEp.set(ep.episode_number, mins);
            }
            for (const row of rows.slice(0, 12)) {
              const epNum = Number(row.episodeNumber);
              if (runtimeByEp.has(epNum)) continue;
              try {
                const detail = await tmdb.getEpisode(tmdbId, seasonNum, epNum, lang);
                const mins = episodeRuntimeMinutes(detail.runtime);
                if (mins != null) runtimeByEp.set(epNum, mins);
              } catch {
                // Skip.
              }
            }
            const updates = rows
              .map(row => {
                const mins = runtimeByEp.get(Number(row.episodeNumber));
                if (mins == null) return null;
                return db.tx.watchedEpisodes[row.id].update({ runtime: mins });
              })
              .filter(Boolean) as ReturnType<typeof db.tx.watchedEpisodes[string]['update']>[];
            for (let i = 0; i < updates.length; i += 40) {
              if (cancelled) return;
              await db.transact(updates.slice(i, i + 40));
            }
          } catch (e) {
            console.warn('Failed to backfill watched runtimes', e);
          }
        }
      } finally {
        inFlight.current = false;
      }
    }

    fillBatch();
    const timer = setInterval(fillBatch, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);
}
