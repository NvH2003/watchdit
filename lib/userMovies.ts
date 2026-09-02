import { id as instantId } from '@instantdb/react-native';
import db from './db';

export function ownerMovieKey(userId: string, tmdbMovieId: number): string {
  return `${userId}:movie:${tmdbMovieId}`;
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
  }
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
