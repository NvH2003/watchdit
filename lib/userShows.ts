import { useEffect, useRef, useState } from 'react';
import { id as instantId } from '@instantdb/react-native';
import db from './db';
import { hasAired, localDayKey, msUntilNextLocalMidnight } from './progress';

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
 * When an up-to-date show's next episode airs (calendar day), flip to watching
 * immediately so To watch / Profile update without waiting for a TMDB refresh.
 */
export function usePromoteAiredUpToDate() {
  const { user } = db.useAuth();
  const { data } = db.useQuery(
    user ? { userShows: { $: { where: { '$user.id': user.id } } } } : null
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
    const due = data.userShows.filter(
      s =>
        s.status === 'upToDate' &&
        hasAired(s.nextEpisodeAirDate as string | undefined)
    );
    if (due.length === 0) return;

    busy.current = true;
    db.transact(due.map(s => db.tx.userShows[s.id].update({ status: 'watching' })))
      .catch(e => console.warn('Failed to promote aired up-to-date shows', e))
      .finally(() => {
        busy.current = false;
      });
  }, [user, data?.userShows, dayKey]);
}
