import { tmdb } from './tmdb';

export type EpisodeOverviewExtras = {
  overview: string;
  stillPath?: string | null;
  name?: string;
  runtime?: number | null;
  airDate?: string;
  voteAverage?: number | null;
};

export async function fetchLongerEpisodeOverview(opts: {
  showId: number;
  season: number;
  episode: number;
  current?: string;
  originalLanguage?: string | null;
}): Promise<EpisodeOverviewExtras> {
  const current = opts.current?.trim() ?? '';
  const [detail, translations] = await Promise.all([
    tmdb.getEpisode(opts.showId, opts.season, opts.episode).catch(() => null),
    tmdb.getEpisodeTranslations(opts.showId, opts.season, opts.episode).catch(() => null),
  ]);

  const preferred = new Set(
    ['en', 'nl', opts.originalLanguage].filter((code): code is string => !!code)
  );
  let best = current;
  const prefer = (text?: string | null) => {
    const next = text?.trim() ?? '';
    if (next.length > best.length) best = next;
  };
  prefer(detail?.overview);
  for (const t of translations?.translations ?? []) {
    if (preferred.has(t.iso_639_1)) prefer(t.data?.overview);
  }
  if (best.length <= current.length) {
    for (const t of translations?.translations ?? []) {
      prefer(t.data?.overview);
    }
  }

  return {
    overview: best,
    stillPath: detail?.still_path ?? undefined,
    name: detail?.name,
    runtime: detail?.runtime,
    airDate: detail?.air_date,
    voteAverage: detail?.vote_average,
  };
}
