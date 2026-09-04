import { useEffect, useRef } from 'react';
import { id as instantId } from '@instantdb/react-native';
import db from './db';
import { tmdb, TmdbMovie } from './tmdb';

export function ownerMovieKey(userId: string, tmdbMovieId: number): string {
  return `${userId}:movie:${tmdbMovieId}`;
}

export type MovieCollectionAttrs = {
  tmdbCollectionId?: number;
  tmdbCollectionName?: string;
  collectionSyncedAt?: string;
};

/** Persistable collection fields from a TMDB movie details payload. */
export function collectionAttrsFromTmdb(movie: TmdbMovie): MovieCollectionAttrs {
  const now = new Date().toISOString();
  const collection = movie.belongs_to_collection;
  if (collection?.id && collection.name) {
    return {
      tmdbCollectionId: collection.id,
      tmdbCollectionName: collection.name,
      collectionSyncedAt: now,
    };
  }
  return { collectionSyncedAt: now };
}

export function createUserMovieTx(
  userId: string,
  attrs: {
    tmdbMovieId: number;
    tmdbMovieName: string;
    tmdbPosterPath?: string;
    status: string;
    addedAt: string;
    watchedAt?: string;
    lastTouchedAt?: string;
    tmdbReleaseDate?: string;
    runtime?: number;
  } & MovieCollectionAttrs
) {
  const entityId = instantId();
  return {
    entityId,
    tx: db.tx.userMovies[entityId]
      .update({
        ownerMovieKey: ownerMovieKey(userId, attrs.tmdbMovieId),
        ...attrs,
      })
      .link({ $user: userId }),
  };
}

type MovieRow = {
  id: string;
  tmdbMovieId?: unknown;
  tmdbCollectionId?: unknown;
  tmdbCollectionName?: unknown;
  collectionSyncedAt?: unknown;
};

export function uniqueByTmdbMovieId<T extends MovieRow>(movies: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const movie of movies) {
    const tmdbId = Number(movie.tmdbMovieId);
    if (!Number.isFinite(tmdbId) || seen.has(tmdbId)) continue;
    seen.add(tmdbId);
    out.push(movie);
  }
  return out;
}

export const ALL_COLLECTIONS = 'all';
export const NO_COLLECTION = 'none';

export function collectionFilterKey(movie: MovieRow): string {
  const id = Number(movie.tmdbCollectionId);
  if (Number.isFinite(id) && id > 0) return String(id);
  return NO_COLLECTION;
}

/** "James Bond Collection" → "James Bond" */
export function shortCollectionName(name: string): string {
  return name.replace(/\s+Collection$/i, '').trim() || name;
}

export function buildCollectionFilterOptions(
  movies: MovieRow[]
): { key: string; label: string }[] {
  const byId = new Map<string, string>();
  let hasStandalone = false;

  for (const movie of movies) {
    const key = collectionFilterKey(movie);
    if (key === NO_COLLECTION) {
      hasStandalone = true;
      continue;
    }
    const name = String(movie.tmdbCollectionName ?? '').trim();
    if (!byId.has(key) && name) {
      byId.set(key, shortCollectionName(name));
    }
  }

  const named = [...byId.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const options = [{ key: ALL_COLLECTIONS, label: 'All' }, ...named];
  if (hasStandalone && named.length > 0) {
    options.push({ key: NO_COLLECTION, label: 'Other' });
  }
  return options;
}

/**
 * Fill TMDB collection (franchise) ids for movies that have never been synced.
 */
export function useBackfillMovieCollections() {
  const { user } = db.useAuth();
  const { data } = db.useQuery(
    user ? { userMovies: { $: { where: { '$user.id': user.id } } } } : null
  );
  const inFlight = useRef(false);
  const moviesRef = useRef(data?.userMovies);
  moviesRef.current = data?.userMovies;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fillBatch() {
      if (cancelled || inFlight.current) return;
      inFlight.current = true;
      try {
        const pending = uniqueByTmdbMovieId(moviesRef.current ?? []).filter(
          m => !m.collectionSyncedAt
        );
        const batch = pending.slice(0, 8);
        for (let i = 0; i < batch.length; i++) {
          if (cancelled) return;
          const movie = batch[i];
          const tmdbId = Number(movie.tmdbMovieId);
          if (!Number.isFinite(tmdbId)) continue;
          try {
            const details = await tmdb.getMovie(tmdbId);
            if (cancelled) return;
            await db.transact([
              db.tx.userMovies[movie.id].update(collectionAttrsFromTmdb(details)),
            ]);
          } catch (e) {
            console.warn('Failed to backfill movie collection', tmdbId, e);
            // Mark synced so we don't hammer a bad id forever.
            try {
              await db.transact([
                db.tx.userMovies[movie.id].update({
                  collectionSyncedAt: new Date().toISOString(),
                }),
              ]);
            } catch {
              // ignore
            }
          }
          if (i < batch.length - 1) {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      } finally {
        inFlight.current = false;
      }
    }

    fillBatch();
    const timer = setInterval(fillBatch, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, data?.userMovies]);
}
