import { parseCSV, SeriesRecord, ImportStatus } from './csvImport';
import { tmdb, TmdbMovie } from './tmdb';

export interface NamedCsv {
  name: string;
  text: string;
}

export type ImportScope = 'series' | 'movies' | 'both';

export type GdprFileRole =
  | 'user_tv_show_data'
  | 'tracking_v2'
  | 'followed_tv_show'
  | 'user_show_special_status'
  | 'tracking_records';

export type GdprFileSpec = {
  role: GdprFileRole;
  label: string;
  required: boolean;
  scopes: ImportScope[];
  why: string;
  match: (name: string, text: string) => boolean;
};

export const GDPR_FILE_SPECS: GdprFileSpec[] = [
  {
    role: 'user_tv_show_data',
    label: 'user_tv_show_data.csv',
    required: true,
    scopes: ['series', 'both'],
    why: 'Your followed shows, titles, and how many episodes you watched.',
    match: (name, text) =>
      name.includes('user_tv_show_data') || text.includes('nb_episodes_seen'),
  },
  {
    role: 'tracking_v2',
    label: 'tracking-prod-records-v2.csv',
    required: false,
    scopes: ['series', 'both'],
    why: 'Last watched season/episode — marks every episode up to that point as seen.',
    match: (name, text) =>
      name.includes('tracking-prod-records-v2') || text.includes('most_recent_ep_watched'),
  },
  {
    role: 'followed_tv_show',
    label: 'followed_tv_show.csv',
    required: false,
    scopes: ['series', 'both'],
    why: 'Which shows you archived (finished).',
    match: (name) => name.includes('followed_tv_show') && !name.includes('source'),
  },
  {
    role: 'user_show_special_status',
    label: 'user_show_special_status.csv',
    required: false,
    scopes: ['series', 'both'],
    why: 'Watch Later (for_later) flags.',
    match: (name, text) =>
      name.includes('user_show_special_status') || text.includes('for_later'),
  },
  {
    role: 'tracking_records',
    label: 'tracking-prod-records.csv',
    required: true,
    scopes: ['movies', 'both'],
    why: 'Your movies (watched, to-watch, and followed). Not the -v2 file.',
    match: (name, text) => {
      const n = name.toLowerCase();
      if (n.includes('tracking-prod-records-v2')) return false;
      return n.includes('tracking-prod-records') || text.includes('entity_type');
    },
  },
];

export function specsForScope(scope: ImportScope): GdprFileSpec[] {
  return GDPR_FILE_SPECS.filter(s => s.scopes.includes(scope));
}

export function detectFileRole(file: NamedCsv): GdprFileRole | null {
  const name = file.name.toLowerCase();
  for (const spec of GDPR_FILE_SPECS) {
    if (spec.match(name, file.text)) return spec.role;
  }
  return null;
}

export function selectedRoles(files: NamedCsv[]): Set<GdprFileRole> {
  const roles = new Set<GdprFileRole>();
  for (const file of files) {
    const role = detectFileRole(file);
    if (role) roles.add(role);
  }
  return roles;
}

export function requiredReady(scope: ImportScope, files: NamedCsv[]): boolean {
  const roles = selectedRoles(files);
  return specsForScope(scope)
    .filter(s => s.required)
    .every(s => roles.has(s.role));
}

function fileOf(files: NamedCsv[], ...needles: string[]): NamedCsv | undefined {
  return files.find(f => {
    const n = f.name.toLowerCase();
    return needles.every(needle => n.includes(needle.toLowerCase()));
  });
}

function parseSimple(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (cols[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Build series records from the useful GDPR files:
 * - user_tv_show_data.csv: TVDB/TV Time show id + nb_episodes_seen
 * - followed_tv_show.csv: archived
 * - user_show_special_status.csv: for_later
 * - tracking-prod-records-v2.csv: last watched S/E
 */
export function mergeGdprFiles(files: NamedCsv[]): SeriesRecord[] {
  const showsFile =
    fileOf(files, 'user_tv_show_data') ??
    files.find(f => f.text.includes('nb_episodes_seen'));
  if (!showsFile) return [];

  const followedFile = files.find(f => {
    const n = f.name.toLowerCase();
    return n.includes('followed_tv_show') && !n.includes('source');
  });
  const statusFile =
    fileOf(files, 'user_show_special_status') ??
    files.find(f => f.text.includes('for_later'));
  const trackingFile =
    fileOf(files, 'tracking-prod-records-v2') ??
    files.find(f => f.text.includes('most_recent_ep_watched'));

  const archived = new Set<number>();
  if (followedFile) {
    for (const row of parseSimple(followedFile.text)) {
      const id = parseInt(row.tv_show_id ?? '', 10);
      if (!id) continue;
      if (row.archived === '1' || row.archived === 'true') archived.add(id);
    }
  }

  const forLater = new Set<number>();
  if (statusFile) {
    for (const row of parseSimple(statusFile.text)) {
      const id = parseInt(row.tv_show_id ?? '', 10);
      if (!id) continue;
      if ((row.status ?? '').toLowerCase() === 'for_later') forLater.add(id);
    }
  }

  const lastById = new Map<number, { s: number | null; ep: number | null }>();
  if (trackingFile) {
    const parsed = parseCSV(trackingFile.text);
    for (const s of parsed.series) {
      lastById.set(s.tvTimeSeriesId, { s: s.lastSeasonNum, ep: s.lastEpNum });
    }
  }

  const series: SeriesRecord[] = [];
  const seen = new Set<number>();

  for (const row of parseSimple(showsFile.text)) {
    const id = parseInt(row.tv_show_id ?? '', 10);
    const name = (row.tv_show_name ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const followed = row.is_followed === '1' || row.is_followed === 'true';
    const epWatchCount = parseInt(row.nb_episodes_seen ?? '0', 10) || 0;
    if (!followed && epWatchCount === 0) continue;

    const last = lastById.get(id);

    series.push({
      tvTimeSeriesId: id,
      seriesName: name || `Show ${id}`,
      isForLater: forLater.has(id),
      isArchived: archived.has(id),
      isFollowed: followed || epWatchCount > 0,
      lastSeasonNum: last?.s ?? null,
      lastEpNum: last?.ep ?? null,
      epWatchCount,
    });
  }

  return series;
}

export function isGdprBundle(files: NamedCsv[]): boolean {
  return files.some(
    f =>
      f.name.toLowerCase().includes('user_tv_show_data') ||
      f.text.includes('nb_episodes_seen')
  );
}

export type MovieRecord = {
  movieName: string;
  status: Exclude<ImportStatus, 'upToDate'>;
  watchedAt: string | null;
  runtimeMinutes: number | null;
  releaseDate: string | null;
  tvTimeUuid: string;
};

function toIsoDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const t = new Date(raw.trim()).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function runtimeMinutes(raw: string | undefined): number | null {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // TV Time stores movie runtime in seconds in this export.
  if (n > 500) return Math.round(n / 60);
  return n;
}

const MOVIE_STATUS_RANK: Record<MovieRecord['status'], number> = {
  finished: 3,
  watchLater: 2,
  watching: 1,
};

function movieStatusFromType(type: string): MovieRecord['status'] | null {
  const t = type.toLowerCase();
  if (t === 'watch') return 'finished';
  if (t === 'towatch') return 'watchLater';
  if (t === 'follow') return 'watching';
  return null;
}

/** Movies from tracking-prod-records.csv (entity_type=movie). */
export function mergeGdprMovies(files: NamedCsv[]): MovieRecord[] {
  const tracking =
    files.find(f => {
      const n = f.name.toLowerCase();
      return n.includes('tracking-prod-records') && !n.includes('v2');
    }) ?? files.find(f => f.text.includes('entity_type') && f.text.includes('movie_name'));

  if (!tracking) return [];

  const byKey = new Map<string, MovieRecord>();

  for (const row of parseSimple(tracking.text)) {
    if ((row.entity_type ?? '').toLowerCase() !== 'movie') continue;
    const name = (row.movie_name ?? '').trim();
    if (!name) continue;
    const status = movieStatusFromType(row.type ?? '');
    if (!status) continue;

    const uuid = (row.uuid ?? '').trim() || name.toLowerCase();
    const watchedAt =
      status === 'finished'
        ? toIsoDate(row.watch_date) ?? toIsoDate(row.updated_at) ?? toIsoDate(row.created_at)
        : null;
    const next: MovieRecord = {
      movieName: name,
      status,
      watchedAt,
      runtimeMinutes: runtimeMinutes(row.runtime),
      releaseDate: toIsoDate(row.release_date),
      tvTimeUuid: uuid,
    };

    const prev = byKey.get(uuid) ?? byKey.get(name.toLowerCase());
    if (!prev || MOVIE_STATUS_RANK[next.status] >= MOVIE_STATUS_RANK[prev.status]) {
      byKey.set(uuid, next);
      byKey.set(name.toLowerCase(), next);
    }
  }

  const out: MovieRecord[] = [];
  const seen = new Set<string>();
  for (const movie of byKey.values()) {
    const key = movie.movieName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(movie);
  }
  return out;
}

export type MatchedMovie = {
  record: MovieRecord;
  tmdbMovie: TmdbMovie;
  status: MovieRecord['status'];
};

export type UnmatchedMovie = {
  record: MovieRecord;
};

function yearOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const y = parseInt(iso.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export async function matchMoviesToTmdb(
  movies: MovieRecord[],
  onProgress?: (done: number, total: number) => void
): Promise<{ matched: MatchedMovie[]; unmatched: UnmatchedMovie[] }> {
  const matched: MatchedMovie[] = [];
  const unmatched: UnmatchedMovie[] = [];
  const total = movies.length;

  for (let i = 0; i < movies.length; i++) {
    const record = movies[i];
    onProgress?.(i, total);
    try {
      const { results } = await tmdb.searchMovies(record.movieName);
      const wantYear = yearOf(record.releaseDate);
      let best = results[0] ?? null;
      if (wantYear != null && results.length > 0) {
        const yearMatch = results.find(r => yearOf(r.release_date) === wantYear);
        if (yearMatch) best = yearMatch;
      }
      if (!best) {
        unmatched.push({ record });
      } else {
        matched.push({ record, tmdbMovie: best, status: record.status });
      }
    } catch {
      unmatched.push({ record });
    }
    if (i > 0 && i % 5 === 0) await new Promise(r => setTimeout(r, 200));
  }

  onProgress?.(total, total);
  return { matched, unmatched };
}
