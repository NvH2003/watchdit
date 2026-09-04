const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '';
const BASE_URL = 'https://api.themoviedb.org/3';
export const IMG_BASE = 'https://image.tmdb.org/t/p';

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('api_key', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export interface TmdbSeasonSummary {
  id: number;
  season_number: number;
  episode_count: number;
  name: string;
  air_date?: string | null;
}

export interface TmdbShow {
  id: number;
  name: string;
  poster_path: string | null;
  overview: string;
  first_air_date: string;
  vote_average: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  original_language?: string;
  original_name?: string;
  /** Typical episode lengths in minutes. */
  episode_run_time?: number[];
  seasons?: TmdbSeasonSummary[];
}

export interface TmdbEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string;
  still_path: string | null;
  /** Episode length in minutes when TMDB has it. */
  runtime?: number | null;
}

export interface TmdbSeason {
  id: number;
  season_number: number;
  episode_count: number;
  name: string;
  air_date?: string | null;
  episodes?: TmdbEpisode[];
}

export interface TmdbCollectionRef {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface TmdbMovie {
  id: number;
  title: string;
  poster_path: string | null;
  overview: string;
  release_date: string;
  vote_average: number;
  runtime?: number | null;
  status?: string;
  original_language?: string;
  original_title?: string;
  belongs_to_collection?: TmdbCollectionRef | null;
}

export type MediaKind = 'tv' | 'movie';

export type SearchHit = {
  kind: MediaKind;
  id: number;
  name: string;
  poster_path: string | null;
  overview: string;
  year?: string;
  airDate?: string;
};

export interface TmdbWatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority: number;
}

export interface TmdbWatchProvidersResponse {
  results: Record<
    string,
    {
      link?: string;
      flatrate?: TmdbWatchProvider[];
      rent?: TmdbWatchProvider[];
      buy?: TmdbWatchProvider[];
    }
  >;
}

export function posterUrl(
  path: string | null | undefined,
  size: 'w185' | 'w342' | 'w500' = 'w342'
): string | null {
  if (!path) return null;
  return `${IMG_BASE}/${size}${path}`;
}

export function stillUrl(
  path: string | null | undefined,
  size: 'w185' | 'w300' = 'w185'
): string | null {
  if (!path) return null;
  return `${IMG_BASE}/${size}${path}`;
}

export const tmdb = {
  searchShows: (query: string) =>
    get<{ results: TmdbShow[] }>('/search/tv', { query }),

  getShow: (id: number) =>
    get<TmdbShow>(`/tv/${id}`),

  getTrending: () =>
    get<{ results: TmdbShow[] }>('/trending/tv/week'),

  getPopular: () =>
    get<{ results: TmdbShow[] }>('/tv/popular'),

  getSeason: (showId: number, seasonNumber: number, language?: string | null) =>
    get<TmdbSeason>(
      `/tv/${showId}/season/${seasonNumber}`,
      language ? { language } : {}
    ),

  getEpisode: (
    showId: number,
    seasonNumber: number,
    episodeNumber: number,
    language?: string | null
  ) =>
    get<TmdbEpisode>(
      `/tv/${showId}/season/${seasonNumber}/episode/${episodeNumber}`,
      language ? { language } : {}
    ),

  getSeasons: async (
    showId: number,
    totalSeasons: number,
    language?: string | null
  ): Promise<TmdbSeason[]> => {
    const seasons: TmdbSeason[] = [];
    for (let n = 1; n <= totalSeasons; n++) {
      seasons.push(await tmdb.getSeason(showId, n, language));
    }
    return seasons;
  },

  getWatchProviders: (showId: number) =>
    get<TmdbWatchProvidersResponse>(`/tv/${showId}/watch/providers`),

  searchMovies: (query: string) =>
    get<{ results: TmdbMovie[] }>('/search/movie', { query }),

  getMovie: (id: number) =>
    get<TmdbMovie>(`/movie/${id}`),

  getTrendingMovies: () =>
    get<{ results: TmdbMovie[] }>('/trending/movie/week'),

  getPopularMovies: () =>
    get<{ results: TmdbMovie[] }>('/movie/popular'),

  getMovieWatchProviders: (movieId: number) =>
    get<TmdbWatchProvidersResponse>(`/movie/${movieId}/watch/providers`),

  findByTvdbId: (tvdbId: number) =>
    get<{ tv_results: TmdbShow[] }>(`/find/${tvdbId}`, {
      external_source: 'tvdb_id',
    }),
};

export function providerLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${IMG_BASE}/w92${path}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Display TMDB date strings as DD-MM-YYYY (European). */
export function formatEuropeanDate(iso?: string | null): string | null {
  if (!iso) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (day) return `${day[3]}-${day[2]}-${day[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** Returns "Airs 15 Sep" when the date is in the future, otherwise null. */
export function formatAirsLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const air = new Date(d);
  air.setHours(0, 0, 0, 0);
  if (air.getTime() <= today.getTime()) return null;
  return `Airs ${air.getDate()} ${MONTHS[air.getMonth()]}`;
}

export function formatRuntime(minutes?: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function showToSearchHit(show: TmdbShow): SearchHit {
  return {
    kind: 'tv',
    id: show.id,
    name: show.name,
    poster_path: show.poster_path,
    overview: show.overview,
    year: show.first_air_date ? show.first_air_date.slice(0, 4) : undefined,
    airDate: show.first_air_date || undefined,
  };
}

export function movieToSearchHit(movie: TmdbMovie): SearchHit {
  return {
    kind: 'movie',
    id: movie.id,
    name: movie.title,
    poster_path: movie.poster_path,
    overview: movie.overview,
    year: movie.release_date ? movie.release_date.slice(0, 4) : undefined,
    airDate: movie.release_date || undefined,
  };
}
