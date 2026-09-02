import { parseCSV, SeriesRecord } from './csvImport';

export interface NamedCsv {
  name: string;
  text: string;
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
