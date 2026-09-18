import { tmdb } from './tmdb';

export type EpisodeOverviewExtras = {
  overview: string;
  stillPath?: string | null;
  name?: string;
  runtime?: number | null;
  airDate?: string;
  voteAverage?: number | null;
};

function firstOverview(
  translations: { iso_639_1: string; data?: { overview?: string } }[] | undefined,
  lang: string
): string {
  for (const t of translations ?? []) {
    if (t.iso_639_1 !== lang) continue;
    const text = t.data?.overview?.trim() ?? '';
    if (text) return text;
  }
  return '';
}

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

  const english = firstOverview(translations?.translations, 'en');
  const fromDetail = detail?.overview?.trim() ?? '';
  let overview = english || fromDetail;
  if (!overview) {
    for (const t of translations?.translations ?? []) {
      const text = t.data?.overview?.trim() ?? '';
      if (text) {
        overview = text;
        break;
      }
    }
  }
  if (!overview) overview = current;

  return {
    overview,
    stillPath: detail?.still_path ?? undefined,
    name: detail?.name,
    runtime: detail?.runtime,
    airDate: detail?.air_date,
    voteAverage: detail?.vote_average,
  };
}
