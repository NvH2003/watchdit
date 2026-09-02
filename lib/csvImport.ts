import { tmdb, TmdbShow } from './tmdb';

// ─── CSV row types ────────────────────────────────────────────────────────────

export interface SeriesRecord {
  tvTimeSeriesId: number;
  seriesName: string;
  isForLater: boolean;
  isArchived: boolean;
  isFollowed: boolean;
  /** most_recent_ep_watched parsed from the "map[...]" string */
  lastSeasonNum: number | null;
  lastEpNum: number | null;
  epWatchCount: number;
}

export interface EpisodeRecord {
  tvTimeSeriesId: number;
  seriesName: string;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: string; // ISO string
}

export interface ParsedCSV {
  series: SeriesRecord[];
  episodes: EpisodeRecord[];
}

// ─── Status mapping ───────────────────────────────────────────────────────────

export type ImportStatus = 'watching' | 'watchLater' | 'finished' | 'upToDate';

export function mapStatus(r: SeriesRecord): ImportStatus {
  if (r.isArchived) return 'finished';
  if (r.isForLater) return 'watchLater';
  return 'watching';
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Parse a line of CSV respecting quoted fields.
 * TV Time CSVs don't use complex quoting, but we handle it defensively.
 */
function parseLine(line: string): string[] {
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
 * Extract season + episode numbers from the most_recent_ep_watched field.
 * TV Time stores this as: map[ep_id:... ep_no:5 s_no:4 uuid:... watch_date:...]
 */
function parseLastEpisode(raw: string): { s: number | null; ep: number | null } {
  if (!raw || raw.trim() === '') return { s: null, ep: null };
  const sMatch = raw.match(/s_no:(\d+)/);
  const epMatch = raw.match(/ep_no:(\d+)/);
  return {
    s: sMatch ? parseInt(sMatch[1], 10) : null,
    ep: epMatch ? parseInt(epMatch[1], 10) : null,
  };
}

export function parseCSV(text: string): ParsedCSV {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { series: [], episodes: [] };

  const headers = parseLine(lines[0]).map(h => h.trim());

  const idx = (name: string) => headers.indexOf(name);
  const iKey = idx('key');
  const iSId = idx('s_id');
  const iSeriesName = idx('series_name');
  const iSeasonNumber = idx('season_number');
  const iSNo = idx('s_no');
  const iEpNo = idx('ep_no');
  const iCreatedAt = idx('created_at');
  const iIsForLater = idx('is_for_later');
  const iIsArchived = idx('is_archived');
  const iIsFollowed = idx('is_followed');
  const iMostRecent = idx('most_recent_ep_watched');
  const iGsi = idx('gsi');
  const iEpWatchCount = idx('ep_watch_count');

  const series: SeriesRecord[] = [];
  const episodes: EpisodeRecord[] = [];
  // Deduplicate episodes: same show + season + ep
  const epSeen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const key = (cols[iKey] ?? '').trim();
    const sIdRaw = (cols[iSId] ?? '').trim();
    const seriesName = (cols[iSeriesName] ?? '').trim();

    if (!key || !sIdRaw || !seriesName) continue;
    const tvTimeSeriesId = parseInt(sIdRaw, 10);
    if (isNaN(tvTimeSeriesId)) continue;

    if (key.startsWith('user-series-')) {
      const isFollowed = (cols[iIsFollowed] ?? '').trim() === 'true';
      if (!isFollowed) continue; // skip unfollowed shows

      const isForLater = (cols[iIsForLater] ?? '').trim() === 'true';
      const isArchived = (cols[iIsArchived] ?? '').trim() === 'true';
      const mostRecent = cols[iMostRecent] ?? '';
      const { s, ep } = parseLastEpisode(mostRecent);

      series.push({
        tvTimeSeriesId,
        seriesName,
        isForLater,
        isArchived,
        isFollowed,
        lastSeasonNum: s,
        lastEpNum: ep,
        epWatchCount: parseInt((cols[iEpWatchCount] ?? '').trim(), 10) || 0,
      });
    } else if (
      key.startsWith('watch-episode-') ||
      key.startsWith('rewatch-episode-') ||
      (cols[iGsi] ?? '').trim().startsWith('watch-episode-') ||
      (cols[iGsi] ?? '').trim().startsWith('rewatch-episode-')
    ) {
      const seasonRaw = (cols[iSeasonNumber] ?? cols[iSNo] ?? '').trim();
      const epRaw = (cols[iEpNo] ?? '').trim();
      if (!seasonRaw || !epRaw) continue;

      const seasonNumber = parseInt(seasonRaw, 10);
      const episodeNumber = parseInt(epRaw, 10);
      if (isNaN(seasonNumber) || isNaN(episodeNumber) || seasonNumber < 1) continue;

      const dedupeKey = `${tvTimeSeriesId}-${seasonNumber}-${episodeNumber}`;
      if (epSeen.has(dedupeKey)) continue;
      epSeen.add(dedupeKey);

      const watchedAt = (cols[iCreatedAt] ?? '').trim() || new Date().toISOString();

      episodes.push({
        tvTimeSeriesId,
        seriesName,
        seasonNumber,
        episodeNumber,
        watchedAt: new Date(watchedAt).toISOString(),
      });
    }
  }

  return { series, episodes };
}

// ─── TMDB matching ────────────────────────────────────────────────────────────

export interface MatchedShow {
  seriesRecord: SeriesRecord;
  tmdbShow: TmdbShow;
  episodeCount: number;
  status: ImportStatus;
}

export interface UnmatchedShow {
  seriesRecord: SeriesRecord;
  episodeCount: number;
}

export interface MatchResult {
  matched: MatchedShow[];
  unmatched: UnmatchedShow[];
}

/**
 * Match each unique series record to a TMDB show by name.
 * Fires one search per unique series name, rate-limited to avoid hammering TMDB.
 */
export async function matchShowsToTmdb(
  series: SeriesRecord[],
  episodes: EpisodeRecord[],
  onProgress?: (done: number, total: number) => void
): Promise<MatchResult> {
  // Deduplicate series by tvTimeSeriesId (keep first occurrence)
  const uniqueSeries = series.filter(
    (s, idx, arr) => arr.findIndex(x => x.tvTimeSeriesId === s.tvTimeSeriesId) === idx
  );

  // Episode counts per tvTimeSeriesId
  const epCounts = new Map<number, number>();
  for (const ep of episodes) {
    epCounts.set(ep.tvTimeSeriesId, (epCounts.get(ep.tvTimeSeriesId) ?? 0) + 1);
  }

  const matched: MatchedShow[] = [];
  const unmatched: UnmatchedShow[] = [];

  for (let i = 0; i < uniqueSeries.length; i++) {
    const sr = uniqueSeries[i];
    onProgress?.(i, uniqueSeries.length);

    try {
      // Small delay to avoid rate-limiting
      if (i > 0 && i % 10 === 0) await sleep(500);

      const res = await tmdb.searchShows(sr.seriesName);
      const top = res.results[0] ?? null;

      if (top) {
        matched.push({
          seriesRecord: sr,
          tmdbShow: top,
          episodeCount: epCounts.get(sr.tvTimeSeriesId) ?? sr.epWatchCount,
          status: mapStatus(sr),
        });
      } else {
        unmatched.push({
          seriesRecord: sr,
          episodeCount: epCounts.get(sr.tvTimeSeriesId) ?? 0,
        });
      }
    } catch {
      unmatched.push({
        seriesRecord: sr,
        episodeCount: epCounts.get(sr.tvTimeSeriesId) ?? 0,
      });
    }
  }

  onProgress?.(uniqueSeries.length, uniqueSeries.length);
  return { matched, unmatched };
}

export async function matchShowsByTvdb(
  series: SeriesRecord[],
  onProgress?: (done: number, total: number) => void
): Promise<MatchResult> {
  const uniqueSeries = series.filter(
    (s, idx, arr) => arr.findIndex(x => x.tvTimeSeriesId === s.tvTimeSeriesId) === idx
  );

  const matched: MatchedShow[] = [];
  const unmatched: UnmatchedShow[] = [];

  for (let i = 0; i < uniqueSeries.length; i++) {
    const sr = uniqueSeries[i];
    onProgress?.(i, uniqueSeries.length);

    try {
      if (i > 0 && i % 10 === 0) await sleep(400);

      let top: TmdbShow | null = null;
      try {
        const found = await tmdb.findByTvdbId(sr.tvTimeSeriesId);
        top = found.tv_results[0] ?? null;
      } catch {
        // Not every TV Time id is a TVDB id
      }

      if (!top && sr.seriesName) {
        const res = await tmdb.searchShows(sr.seriesName);
        top = res.results[0] ?? null;
      }

      if (top) {
        matched.push({
          seriesRecord: sr,
          tmdbShow: top,
          episodeCount: sr.epWatchCount,
          status: mapStatus(sr),
        });
      } else {
        unmatched.push({ seriesRecord: sr, episodeCount: sr.epWatchCount });
      }
    } catch {
      unmatched.push({ seriesRecord: sr, episodeCount: sr.epWatchCount });
    }
  }

  onProgress?.(uniqueSeries.length, uniqueSeries.length);
  return { matched, unmatched };
}

/**
 * TV Time's CSV mostly stores the last watched episode per show, not every check-in.
 * Fill in every earlier TMDB episode so the library matches "watched up to SxEy".
 */
export async function expandWatchedEpisodes(
  matched: MatchedShow[],
  extraEpisodes: EpisodeRecord[],
  onProgress?: (done: number, total: number) => void
): Promise<EpisodeRecord[]> {
  const tvTimeToTmdb = new Map(
    matched.map(m => [m.seriesRecord.tvTimeSeriesId, m.tmdbShow.id])
  );

  const seen = new Set<string>();
  const result: EpisodeRecord[] = [];

  function add(ep: EpisodeRecord) {
    const tmdbId = tvTimeToTmdb.get(ep.tvTimeSeriesId);
    if (tmdbId == null) return;
    const dedupe = `${tmdbId}-${ep.seasonNumber}-${ep.episodeNumber}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    result.push(ep);
  }

  for (const ep of extraEpisodes) add(ep);

  for (let i = 0; i < matched.length; i++) {
    onProgress?.(i, matched.length);
    const m = matched[i];
    const lastS = m.seriesRecord.lastSeasonNum;
    const lastE = m.seriesRecord.lastEpNum;
    const count = m.seriesRecord.epWatchCount;

    try {
      if (i > 0 && i % 5 === 0) await sleep(400);

      if (lastS && lastE) {
        for (let s = 1; s <= lastS; s++) {
          const season = await tmdb.getSeason(m.tmdbShow.id, s);
          for (const e of season.episodes ?? []) {
            if (e.season_number <= 0) continue;
            const beforeLastSeason = s < lastS;
            const inLastSeason = s === lastS && e.episode_number <= lastE;
            if (!beforeLastSeason && !inLastSeason) continue;
            add({
              tvTimeSeriesId: m.seriesRecord.tvTimeSeriesId,
              seriesName: m.seriesRecord.seriesName,
              seasonNumber: e.season_number,
              episodeNumber: e.episode_number,
              watchedAt: new Date().toISOString(),
            });
          }
        }
      } else if (count > 0) {
        const details = await tmdb.getShow(m.tmdbShow.id);
        const totalSeasons = details.number_of_seasons ?? 0;
        let remaining = count;
        for (let s = 1; s <= totalSeasons && remaining > 0; s++) {
          const season = await tmdb.getSeason(m.tmdbShow.id, s);
          const eps = (season.episodes ?? []).filter(e => e.season_number > 0);
          for (const e of eps) {
            if (remaining <= 0) break;
            add({
              tvTimeSeriesId: m.seriesRecord.tvTimeSeriesId,
              seriesName: m.seriesRecord.seriesName,
              seasonNumber: e.season_number,
              episodeNumber: e.episode_number,
              watchedAt: new Date().toISOString(),
            });
            remaining--;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to expand watched episodes for', m.tmdbShow.name, e);
    }
  }

  onProgress?.(matched.length, matched.length);
  return result;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
