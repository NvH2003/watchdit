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
}

export interface TmdbEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string;
  still_path: string | null;
}

export interface TmdbSeason {
  id: number;
  season_number: number;
  episode_count: number;
  name: string;
  episodes?: TmdbEpisode[];
}

export function posterUrl(
  path: string | null | undefined,
  size: 'w185' | 'w342' | 'w500' = 'w342'
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

  getSeason: (showId: number, seasonNumber: number) =>
    get<TmdbSeason>(`/tv/${showId}/season/${seasonNumber}`),

  getSeasons: (showId: number, totalSeasons: number): Promise<TmdbSeason[]> => {
    const nums = Array.from({ length: totalSeasons }, (_, i) => i + 1);
    return Promise.all(nums.map(n => tmdb.getSeason(showId, n)));
  },
};
