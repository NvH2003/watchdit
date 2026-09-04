import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { id as instantId } from '@instantdb/react-native';
import db from '@/lib/db';
import {
  parseCSV,
  matchShowsToTmdb,
  matchShowsByTvdb,
  expandWatchedEpisodes,
  MatchedShow,
  UnmatchedShow,
  EpisodeRecord,
  ImportStatus,
} from '@/lib/csvImport';
import {
  ImportScope,
  NamedCsv,
  GdprFileRole,
  specsForScope,
  selectedRoles,
  requiredReady,
  detectFileRole,
  mergeGdprFiles,
  mergeGdprMovies,
  matchMoviesToTmdb,
  MatchedMovie,
  UnmatchedMovie,
  isGdprBundle,
} from '@/lib/gdprImport';
import { findProgressFromTmdb, progressUpdates } from '@/lib/progress';
import { theme } from '@/constants/theme';
import { createUserShowTx } from '@/lib/userShows';
import { createUserMovieTx } from '@/lib/userMovies';

type Step =
  | 'scope'
  | 'files'
  | 'confirm'
  | 'matching'
  | 'preview'
  | 'resetting'
  | 'expanding'
  | 'importing'
  | 'classifying'
  | 'done';

type ResetTarget = 'series' | 'movies' | 'everything';

const CHUNK_SIZE = 50;

const SCOPE_OPTIONS: {
  value: ImportScope;
  title: string;
  subtitle: string;
}[] = [
  {
    value: 'series',
    title: 'Series only',
    subtitle: 'Import your TV shows and watched episodes.',
  },
  {
    value: 'movies',
    title: 'Movies only',
    subtitle: 'Import watched and watch-later movies.',
  },
  {
    value: 'both',
    title: 'Both',
    subtitle: 'Import series and movies from the same GDPR dump.',
  },
];

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function mergeFilesByName(prev: NamedCsv[], next: NamedCsv[]): NamedCsv[] {
  const map = new Map(prev.map(f => [f.name.toLowerCase(), f]));
  for (const file of next) {
    map.set(file.name.toLowerCase(), file);
  }
  return Array.from(map.values());
}

function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function ImportScreen() {
  const router = useRouter();
  const { user } = db.useAuth();

  const { data: dbData } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
          userMovies: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );

  const [step, setStep] = useState<Step>('scope');
  const [scope, setScope] = useState<ImportScope | null>(null);
  const [files, setFiles] = useState<NamedCsv[]>([]);
  const [confirmReady, setConfirmReady] = useState(false);

  const [matchProgress, setMatchProgress] = useState({ done: 0, total: 0, label: '' });
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  const [matchedShows, setMatchedShows] = useState<MatchedShow[]>([]);
  const [unmatchedShows, setUnmatchedShows] = useState<UnmatchedShow[]>([]);
  const [matchedMovies, setMatchedMovies] = useState<MatchedMovie[]>([]);
  const [unmatchedMovies, setUnmatchedMovies] = useState<UnmatchedMovie[]>([]);
  const [allEpisodes, setAllEpisodes] = useState<EpisodeRecord[]>([]);
  const [deselectedShows, setDeselectedShows] = useState<Set<number>>(new Set());
  const [deselectedMovies, setDeselectedMovies] = useState<Set<number>>(new Set());

  const [importedShowCount, setImportedShowCount] = useState(0);
  const [importedMovieCount, setImportedMovieCount] = useState(0);
  const [importedEpCount, setImportedEpCount] = useState(0);

  const [error, setError] = useState('');

  const hasSeriesData =
    (dbData?.userShows?.length ?? 0) > 0 || (dbData?.watchedEpisodes?.length ?? 0) > 0;
  const hasMovieData = (dbData?.userMovies?.length ?? 0) > 0;

  const fileAnalysis = useMemo(() => {
    const recognized: NamedCsv[] = [];
    const ignored: NamedCsv[] = [];
    for (const file of files) {
      if (detectFileRole(file)) recognized.push(file);
      else ignored.push(file);
    }
    return { recognized, ignored, roles: selectedRoles(files) };
  }, [files]);

  const canContinueFiles = scope ? requiredReady(scope, files) : false;

  function pickScope(next: ImportScope) {
    setScope(next);
    setError('');
    setConfirmReady(false);
    setStep('files');
  }

  async function addFiles() {
    setError('');
    try {
      const picked = Platform.OS === 'web' ? await pickFilesWeb() : await pickFilesNative();
      if (picked.length === 0) return;
      setFiles(prev => mergeFilesByName(prev, picked));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to read file');
    }
  }

  function pickFilesWeb(): Promise<NamedCsv[]> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv,text/plain';
      input.multiple = true;
      input.onchange = async () => {
        const list = Array.from(input.files ?? []);
        if (list.length === 0) {
          resolve([]);
          return;
        }
        try {
          const out: NamedCsv[] = [];
          for (const file of list) {
            out.push({ name: file.name, text: await file.text() });
          }
          resolve(out);
        } catch (e) {
          reject(e);
        }
      };
      input.click();
    });
  }

  async function pickFilesNative(): Promise<NamedCsv[]> {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return [];
    const out: NamedCsv[] = [];
    for (const asset of result.assets) {
      const response = await fetch(asset.uri);
      out.push({ name: asset.name ?? 'file.csv', text: await response.text() });
    }
    return out;
  }

  async function resetLibrary(target: ResetTarget) {
    if (!user) return;

    const messages: Record<ResetTarget, { title: string; body: string; label: string }> = {
      series: {
        title: 'Reset series',
        body: 'This deletes all your shows and watched episodes so you can import series again.',
        label: 'Delete series',
      },
      movies: {
        title: 'Reset movies',
        body: 'This deletes all your movies so you can import movies again.',
        label: 'Delete movies',
      },
      everything: {
        title: 'Reset everything',
        body: 'This deletes all shows, watched episodes, and movies so you can import again.',
        label: 'Delete everything',
      },
    };

    const msg = messages[target];
    const ok = await confirmDestructive(msg.title, msg.body, msg.label);
    if (!ok) return;

    setError('');
    setStep('resetting');

    const shows = target === 'movies' ? [] : (dbData?.userShows ?? []);
    const episodes = target === 'movies' ? [] : (dbData?.watchedEpisodes ?? []);
    const movies = target === 'series' ? [] : (dbData?.userMovies ?? []);
    const total = shows.length + episodes.length + movies.length;
    let done = 0;
    setImportProgress({ done: 0, total: Math.max(total, 1) });

    try {
      for (const chunk of chunkArray(episodes, CHUNK_SIZE)) {
        await db.transact(chunk.map(e => db.tx.watchedEpisodes[e.id].delete()));
        done += chunk.length;
        setImportProgress({ done, total: Math.max(total, 1) });
      }
      for (const chunk of chunkArray(shows, CHUNK_SIZE)) {
        await db.transact(chunk.map(s => db.tx.userShows[s.id].delete()));
        done += chunk.length;
        setImportProgress({ done, total: Math.max(total, 1) });
      }
      for (const chunk of chunkArray(movies, CHUNK_SIZE)) {
        await db.transact(chunk.map(m => db.tx.userMovies[m.id].delete()));
        done += chunk.length;
        setImportProgress({ done, total: Math.max(total, 1) });
      }
      setStep('files');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reset failed');
      setStep('files');
    }
  }

  async function startMatching() {
    if (!scope || !user) return;
    setStep('matching');
    setMatchProgress({ done: 0, total: 0, label: '' });
    setError('');
    setMatchedShows([]);
    setUnmatchedShows([]);
    setMatchedMovies([]);
    setUnmatchedMovies([]);
    setDeselectedShows(new Set());
    setDeselectedMovies(new Set());
    setAllEpisodes([]);

    try {
      const includeSeries = scope === 'series' || scope === 'both';
      const includeMovies = scope === 'movies' || scope === 'both';

      if (includeSeries) {
        setMatchProgress({ done: 0, total: 0, label: 'Matching shows…' });
        if (isGdprBundle(files)) {
          const series = mergeGdprFiles(files);
          const tracking = files.find(
            f =>
              f.name.toLowerCase().includes('tracking-prod-records-v2') ||
              f.text.includes('most_recent_ep_watched')
          );
          const extra = tracking ? parseCSV(tracking.text).episodes : [];
          setAllEpisodes(extra);

          if (series.length === 0) {
            setError('No shows found in user_tv_show_data.csv.');
            setStep('files');
            return;
          }

          const result = await matchShowsByTvdb(series, (done, total) => {
            setMatchProgress({ done, total, label: 'Matching shows…' });
          });
          setMatchedShows(result.matched);
          setUnmatchedShows(result.unmatched);
          if (!tracking) {
            setError(
              'No tracking-prod-records-v2.csv found. Episode checkmarks will use episode counts only, not your last watched S/E.'
            );
          }
        } else {
          const text = files[0]?.text ?? '';
          const { series, episodes } = parseCSV(text);
          setAllEpisodes(episodes);

          if (series.length === 0) {
            setError(
              'Those files are not the TV Time GDPR CSVs we need for series. Select at least user_tv_show_data.csv.'
            );
            setStep('files');
            return;
          }

          const result = await matchShowsToTmdb(series, episodes, (done, total) => {
            setMatchProgress({ done, total, label: 'Matching shows…' });
          });
          setMatchedShows(result.matched);
          setUnmatchedShows(result.unmatched);
        }
      }

      if (includeMovies) {
        const movieRecords = mergeGdprMovies(files);
        if (movieRecords.length === 0 && scope === 'movies') {
          setError('No movies found in tracking-prod-records.csv.');
          setStep('files');
          return;
        }
        if (movieRecords.length > 0) {
          setMatchProgress({ done: 0, total: movieRecords.length, label: 'Matching movies…' });
          const result = await matchMoviesToTmdb(movieRecords, (done, total) => {
            setMatchProgress({ done, total, label: 'Matching movies…' });
          });
          setMatchedMovies(result.matched);
          setUnmatchedMovies(result.unmatched);
        }
      }

      setStep('preview');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Matching failed');
      setStep('files');
    }
  }

  function toggleShow(tmdbId: number) {
    setDeselectedShows(prev => {
      const next = new Set(prev);
      if (next.has(tmdbId)) next.delete(tmdbId);
      else next.add(tmdbId);
      return next;
    });
  }

  function toggleMovie(tmdbId: number) {
    setDeselectedMovies(prev => {
      const next = new Set(prev);
      if (next.has(tmdbId)) next.delete(tmdbId);
      else next.add(tmdbId);
      return next;
    });
  }

  async function runImport() {
    if (!user || !scope) return;

    const toImportShows = matchedShows.filter(m => !deselectedShows.has(m.tmdbShow.id));
    const toImportMovies = matchedMovies.filter(m => !deselectedMovies.has(m.tmdbMovie.id));

    if (toImportShows.length === 0 && toImportMovies.length === 0) return;

    setStep('importing');
    setImportedShowCount(0);
    setImportedMovieCount(0);
    setImportedEpCount(0);

    const existingByTmdb = new Map(
      (dbData?.userShows ?? []).map(s => [s.tmdbShowId as number, s.id])
    );
    const existingMoviesByTmdb = new Map(
      (dbData?.userMovies ?? []).map(m => [m.tmdbMovieId as number, m.id])
    );

    type ToClassify = {
      tmdbId: number;
      startSeason: number;
      entityId: string;
    };
    const toClassify: ToClassify[] = [];

    try {
      let expandedEpisodes: EpisodeRecord[] = [];
      let validEpisodes: EpisodeRecord[] = [];
      let tvTimeTmdbMap = new Map<number, number>();

      if (toImportShows.length > 0) {
        setStep('expanding');
        setImportProgress({ done: 0, total: toImportShows.length });
        expandedEpisodes = await expandWatchedEpisodes(
          toImportShows,
          allEpisodes,
          (done, total) => setImportProgress({ done, total })
        );

        setStep('importing');
        setImportProgress({ done: 0, total: toImportShows.length });
        let doneShows = 0;
        const seenTmdb = new Set<number>();

        for (const m of toImportShows) {
          const startSeason = Math.max(1, m.seriesRecord.lastSeasonNum ?? 1);
          const tmdbId = m.tmdbShow.id;
          if (seenTmdb.has(tmdbId)) {
            doneShows++;
            setImportProgress({ done: doneShows, total: toImportShows.length });
            continue;
          }
          seenTmdb.add(tmdbId);

          const existingId = existingByTmdb.get(tmdbId);
          if (existingId) {
            if (m.status === 'watching') {
              toClassify.push({ entityId: existingId, tmdbId, startSeason });
            }
            doneShows++;
            setImportProgress({ done: doneShows, total: toImportShows.length });
            continue;
          }

          const { entityId, tx } = createUserShowTx(user.id, {
            tmdbShowId: tmdbId,
            tmdbShowName: m.tmdbShow.name,
            tmdbPosterPath: m.tmdbShow.poster_path ?? '',
            status: m.status,
            addedAt: new Date().toISOString(),
            tvTimeSeriesId: m.seriesRecord.tvTimeSeriesId,
            totalEpisodes: 0,
            nextSeasonNum: startSeason,
            nextEpisodeNum: m.seriesRecord.lastEpNum ?? 1,
            nextEpisodeName: '',
          });
          await db.transact([tx]);
          if (m.status === 'watching') {
            toClassify.push({ entityId, tmdbId, startSeason });
          }
          doneShows++;
          setImportProgress({ done: doneShows, total: toImportShows.length });
        }

        const importedTmdbIds = new Set(toImportShows.map(m => m.tmdbShow.id));
        tvTimeTmdbMap = new Map(
          toImportShows.map(m => [m.seriesRecord.tvTimeSeriesId, m.tmdbShow.id])
        );

        validEpisodes = expandedEpisodes.filter(ep => {
          const tmdbId = tvTimeTmdbMap.get(ep.tvTimeSeriesId);
          return tmdbId != null && importedTmdbIds.has(tmdbId);
        });

        const epChunks = chunkArray(validEpisodes, CHUNK_SIZE);
        const totalEpChunks = epChunks.length;
        let doneEpChunks = 0;

        for (const chunk of epChunks) {
          await db.transact(
            chunk.map(ep => {
              const tmdbId = tvTimeTmdbMap.get(ep.tvTimeSeriesId)!;
              return db.tx.watchedEpisodes[instantId()]
                .update({
                  tmdbShowId: tmdbId,
                  seasonNumber: ep.seasonNumber,
                  episodeNumber: ep.episodeNumber,
                  watchedAt: ep.watchedAt,
                })
                .link({ $user: user.id });
            })
          );
          doneEpChunks++;
          setImportProgress({
            done: toImportShows.length + doneEpChunks,
            total: toImportShows.length + totalEpChunks,
          });
          await new Promise(r => setTimeout(r, 100));
        }
      }

      if (toImportMovies.length > 0) {
        setStep('importing');
        setImportProgress({ done: 0, total: toImportMovies.length });
        let doneMovies = 0;
        const seenMovie = new Set<number>();
        const now = new Date().toISOString();

        for (const m of toImportMovies) {
          const tmdbId = m.tmdbMovie.id;
          if (seenMovie.has(tmdbId) || existingMoviesByTmdb.has(tmdbId)) {
            doneMovies++;
            setImportProgress({ done: doneMovies, total: toImportMovies.length });
            continue;
          }
          seenMovie.add(tmdbId);

          const { tx } = createUserMovieTx(user.id, {
            tmdbMovieId: tmdbId,
            tmdbMovieName: m.tmdbMovie.title,
            tmdbPosterPath: m.tmdbMovie.poster_path ?? '',
            status: m.status,
            addedAt: now,
            watchedAt: m.record.watchedAt ?? undefined,
            lastTouchedAt: now,
            tmdbReleaseDate: m.tmdbMovie.release_date || m.record.releaseDate || '',
            runtime: m.record.runtimeMinutes ?? undefined,
          });
          await db.transact([tx]);
          doneMovies++;
          setImportProgress({ done: doneMovies, total: toImportMovies.length });
        }
      }

      if (toClassify.length > 0) {
        setStep('classifying');
        setImportProgress({ done: 0, total: toClassify.length });

        const watchedByTmdb = new Map<number, Set<string>>();
        for (const ep of dbData?.watchedEpisodes ?? []) {
          const tmdbId = ep.tmdbShowId as number;
          let set = watchedByTmdb.get(tmdbId);
          if (!set) {
            set = new Set();
            watchedByTmdb.set(tmdbId, set);
          }
          set.add(`${ep.seasonNumber}x${ep.episodeNumber}`);
        }
        for (const ep of validEpisodes) {
          const tmdbId = tvTimeTmdbMap.get(ep.tvTimeSeriesId);
          if (tmdbId == null) continue;
          let set = watchedByTmdb.get(tmdbId);
          if (!set) {
            set = new Set();
            watchedByTmdb.set(tmdbId, set);
          }
          set.add(`${ep.seasonNumber}x${ep.episodeNumber}`);
        }

        for (let i = 0; i < toClassify.length; i++) {
          const item = toClassify[i];
          try {
            if (i > 0 && i % 5 === 0) await new Promise(r => setTimeout(r, 400));
            const watched = watchedByTmdb.get(item.tmdbId) ?? new Set();
            const progress = await findProgressFromTmdb(
              item.tmdbId,
              watched,
              item.startSeason
            );
            await db.transact([
              db.tx.userShows[item.entityId].update(progressUpdates(progress)),
            ]);
          } catch (e) {
            console.warn('Failed to classify show', item.tmdbId, e);
          }
          setImportProgress({ done: i + 1, total: toClassify.length });
        }
      }

      const epCount = toImportShows.reduce(
        (sum, m) => sum + (m.seriesRecord.epWatchCount || m.episodeCount),
        0
      );
      setImportedShowCount(toImportShows.length);
      setImportedMovieCount(toImportMovies.length);
      setImportedEpCount(epCount);
      setStep('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
      setStep('preview');
    }
  }

  const selectedShowCount = matchedShows.filter(m => !deselectedShows.has(m.tmdbShow.id)).length;
  const selectedMovieCount = matchedMovies.filter(
    m => !deselectedMovies.has(m.tmdbMovie.id)
  ).length;
  const selectedEpCount = matchedShows
    .filter(m => !deselectedShows.has(m.tmdbShow.id))
    .reduce((sum, m) => sum + (m.seriesRecord.epWatchCount || m.episodeCount), 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Import from TV Time',
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
        {step === 'scope' && <ScopeStep onSelect={pickScope} />}

        {step === 'files' && scope && (
          <FilesStep
            scope={scope}
            files={files}
            roles={fileAnalysis.roles}
            recognized={fileAnalysis.recognized}
            ignored={fileAnalysis.ignored}
            canContinue={canContinueFiles}
            hasSeriesData={hasSeriesData}
            hasMovieData={hasMovieData}
            error={error}
            onAddFiles={addFiles}
            onContinue={() => {
              setConfirmReady(false);
              setError('');
              setStep('confirm');
            }}
            onBack={() => {
              setError('');
              setStep('scope');
            }}
            onReset={resetLibrary}
            onClearFiles={() => setFiles([])}
          />
        )}

        {step === 'confirm' && scope && (
          <ConfirmStep
            scope={scope}
            files={files}
            checked={confirmReady}
            onToggle={() => setConfirmReady(v => !v)}
            onBack={() => setStep('files')}
            onStart={startMatching}
          />
        )}

        {step === 'resetting' && (
          <ProgressStep
            title="Clearing your library…"
            subtitle={`${importProgress.done} / ${importProgress.total} records deleted`}
            progress={
              importProgress.total > 0 ? importProgress.done / importProgress.total : 0
            }
          />
        )}

        {step === 'matching' && (
          <ProgressStep
            title={matchProgress.label || 'Matching…'}
            subtitle={`${matchProgress.done} / ${matchProgress.total} searched`}
            progress={
              matchProgress.total > 0 ? matchProgress.done / matchProgress.total : 0
            }
          />
        )}

        {step === 'preview' && (
          <PreviewStep
            matchedShows={matchedShows}
            unmatchedShows={unmatchedShows}
            matchedMovies={matchedMovies}
            unmatchedMovies={unmatchedMovies}
            deselectedShows={deselectedShows}
            deselectedMovies={deselectedMovies}
            selectedShowCount={selectedShowCount}
            selectedMovieCount={selectedMovieCount}
            selectedEpCount={selectedEpCount}
            onToggleShow={toggleShow}
            onToggleMovie={toggleMovie}
            onConfirm={runImport}
            onBack={() => setStep('files')}
            error={error}
          />
        )}

        {step === 'expanding' && (
          <ProgressStep
            title="Rebuilding watch history…"
            subtitle={`${importProgress.done} / ${importProgress.total} shows — marking every episode up to your last watched`}
            progress={
              importProgress.total > 0 ? importProgress.done / importProgress.total : 0
            }
          />
        )}

        {step === 'importing' && (
          <ProgressStep
            title="Importing…"
            subtitle={`${importProgress.done} / ${importProgress.total} items written`}
            progress={
              importProgress.total > 0 ? importProgress.done / importProgress.total : 0
            }
          />
        )}

        {step === 'classifying' && (
          <ProgressStep
            title="Sorting your shows…"
            subtitle={`${importProgress.done} / ${importProgress.total} placed in Watching, Up to Date, or Finished`}
            progress={
              importProgress.total > 0 ? importProgress.done / importProgress.total : 0
            }
          />
        )}

        {step === 'done' && (
          <DoneStep
            showCount={importedShowCount}
            movieCount={importedMovieCount}
            epCount={importedEpCount}
            onClose={() => router.back()}
          />
        )}
      </SafeAreaView>
    </>
  );
}

// ─── Sub-screens ─────────────────────────────────────────────────────────────

function ScopeStep({ onSelect }: { onSelect: (scope: ImportScope) => void }) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.pickScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.pickTitle}>What do you want to import?</Text>
      <Text style={styles.pickLead}>
        Choose series, movies, or both. Next you’ll pick the matching CSV files
        from your TV Time GDPR export.
      </Text>

      {SCOPE_OPTIONS.map(opt => (
        <TouchableOpacity
          key={opt.value}
          style={styles.scopeCard}
          onPress={() => onSelect(opt.value)}
          activeOpacity={0.85}
        >
          <Text style={styles.scopeTitle}>{opt.title}</Text>
          <Text style={styles.scopeSubtitle}>{opt.subtitle}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function FilesStep({
  scope,
  files,
  roles,
  recognized,
  ignored,
  canContinue,
  hasSeriesData,
  hasMovieData,
  error,
  onAddFiles,
  onContinue,
  onBack,
  onReset,
  onClearFiles,
}: {
  scope: ImportScope;
  files: NamedCsv[];
  roles: Set<GdprFileRole>;
  recognized: NamedCsv[];
  ignored: NamedCsv[];
  canContinue: boolean;
  hasSeriesData: boolean;
  hasMovieData: boolean;
  error: string;
  onAddFiles: () => void;
  onContinue: () => void;
  onBack: () => void;
  onReset: (target: ResetTarget) => void;
  onClearFiles: () => void;
}) {
  const specs = specsForScope(scope);
  const scopeLabel =
    scope === 'series' ? 'series' : scope === 'movies' ? 'movies' : 'series and movies';

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.pickScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.pickTitle}>Select GDPR files</Text>
      <Text style={styles.pickLead}>
        Add the CSVs needed for {scopeLabel}. You can select multiple files at
        once; picking the same name again replaces it.
      </Text>

      {specs.map(spec => {
        const ready = roles.has(spec.role);
        return (
          <View
            key={spec.role}
            style={[styles.fileCard, ready && styles.fileCardReady]}
          >
            <View style={styles.fileCardTop}>
              <View style={[styles.fileCheck, ready && styles.fileCheckOn]}>
                {ready ? (
                  <Ionicons name="checkmark" size={14} color={theme.bg} />
                ) : null}
              </View>
              <Text style={styles.fileName}>{spec.label}</Text>
              <Text style={spec.required ? styles.badgeRequired : styles.badgeOptional}>
                {spec.required ? 'Required' : 'Recommended'}
              </Text>
            </View>
            <Text style={styles.fileWhy}>{spec.why}</Text>
          </View>
        );
      })}

      <TouchableOpacity style={styles.primaryBtn} onPress={onAddFiles}>
        <Text style={styles.primaryBtnText}>
          {files.length > 0 ? 'Add more CSV files' : 'Select CSV files'}
        </Text>
      </TouchableOpacity>

      {recognized.length > 0 && (
        <View style={styles.fileStatusBlock}>
          <Text style={styles.sectionLabel}>RECOGNIZED ({recognized.length})</Text>
          {recognized.map(f => (
            <Text key={f.name} style={styles.fileStatusOk}>
              ✓ {f.name}
            </Text>
          ))}
        </View>
      )}

      {ignored.length > 0 && (
        <View style={styles.fileStatusBlock}>
          <Text style={styles.sectionLabel}>IGNORED ({ignored.length})</Text>
          {ignored.map(f => (
            <Text key={f.name} style={styles.fileStatusIgnored}>
              {f.name}
            </Text>
          ))}
        </View>
      )}

      {files.length > 0 && (
        <TouchableOpacity onPress={onClearFiles} style={styles.clearFilesBtn}>
          <Text style={styles.clearFilesText}>Clear selected files</Text>
        </TouchableOpacity>
      )}

      {(hasSeriesData || hasMovieData) && (
        <View style={styles.resetHint}>
          <Text style={styles.resetHintText}>
            You already have library data. Reset before importing if you want a
            clean slate — otherwise existing items are skipped when matched.
          </Text>
          {hasSeriesData && (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => onReset('series')}
            >
              <Text style={styles.resetBtnText}>Reset series</Text>
            </TouchableOpacity>
          )}
          {hasMovieData && (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => onReset('movies')}
            >
              <Text style={styles.resetBtnText}>Reset movies</Text>
            </TouchableOpacity>
          )}
          {hasSeriesData && hasMovieData && (
            <TouchableOpacity
              style={[styles.resetBtn, { marginBottom: 0 }]}
              onPress={() => onReset('everything')}
            >
              <Text style={styles.resetBtnText}>Reset everything</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.footerRow}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
          <Text style={styles.secondaryBtnText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            styles.footerPrimary,
            !canContinue && styles.btnDisabled,
          ]}
          onPress={onContinue}
          disabled={!canContinue}
        >
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function ConfirmStep({
  scope,
  files,
  checked,
  onToggle,
  onBack,
  onStart,
}: {
  scope: ImportScope;
  files: NamedCsv[];
  checked: boolean;
  onToggle: () => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const specs = specsForScope(scope);
  const roles = selectedRoles(files);
  const scopeLabel =
    scope === 'series' ? 'Series only' : scope === 'movies' ? 'Movies only' : 'Series and movies';

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.pickScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.pickTitle}>Confirm import</Text>
      <Text style={styles.pickLead}>
        Scope: {scopeLabel}. Matching will search TMDB for each title — this can
        take a few minutes for large libraries.
      </Text>

      <Text style={styles.sectionLabel}>FILES READY</Text>
      {specs.map(spec => {
        const ready = roles.has(spec.role);
        return (
          <View key={spec.role} style={styles.confirmFileRow}>
            <View style={[styles.fileCheck, ready && styles.fileCheckOn]}>
              {ready ? <Ionicons name="checkmark" size={14} color={theme.bg} /> : null}
            </View>
            <Text style={[styles.confirmFileName, !ready && styles.confirmFileMissing]}>
              {spec.label}
              {!ready && spec.required ? ' (missing)' : !ready ? ' (optional, skipped)' : ''}
            </Text>
          </View>
        );
      })}

      <TouchableOpacity style={styles.confirmCheckRow} onPress={onToggle} activeOpacity={0.8}>
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
        <Text style={styles.confirmCheckLabel}>I want to start this import</Text>
      </TouchableOpacity>

      <View style={styles.footerRow}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
          <Text style={styles.secondaryBtnText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, styles.footerPrimary, !checked && styles.btnDisabled]}
          onPress={onStart}
          disabled={!checked}
        >
          <Text style={styles.primaryBtnText}>Start matching</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function ProgressStep({
  title,
  subtitle,
  progress,
}: {
  title: string;
  subtitle: string;
  progress: number;
}) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.accent} size="large" style={{ marginBottom: 24 }} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <View style={styles.progressBar}>
        <View
          style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any }]}
        />
      </View>
    </View>
  );
}

const STATUS_COLORS: Record<ImportStatus, string> = {
  watching: theme.accent,
  watchLater: theme.gold,
  finished: theme.check,
  upToDate: theme.sky,
};
const STATUS_LABELS: Record<ImportStatus, string> = {
  watching: 'Watching',
  watchLater: 'Watch Later',
  finished: 'Finished',
  upToDate: 'Up to Date',
};

function PreviewStep({
  matchedShows,
  unmatchedShows,
  matchedMovies,
  unmatchedMovies,
  deselectedShows,
  deselectedMovies,
  selectedShowCount,
  selectedMovieCount,
  selectedEpCount,
  onToggleShow,
  onToggleMovie,
  onConfirm,
  onBack,
  error,
}: {
  matchedShows: MatchedShow[];
  unmatchedShows: UnmatchedShow[];
  matchedMovies: MatchedMovie[];
  unmatchedMovies: UnmatchedMovie[];
  deselectedShows: Set<number>;
  deselectedMovies: Set<number>;
  selectedShowCount: number;
  selectedMovieCount: number;
  selectedEpCount: number;
  onToggleShow: (id: number) => void;
  onToggleMovie: (id: number) => void;
  onConfirm: () => void;
  onBack: () => void;
  error: string;
}) {
  const parts: string[] = [];
  if (matchedShows.length > 0) {
    parts.push(`${selectedShowCount} shows`);
    if (selectedEpCount > 0) parts.push(`${selectedEpCount} episodes`);
  }
  if (matchedMovies.length > 0) parts.push(`${selectedMovieCount} movies`);
  const summary = parts.join(' · ') || 'Nothing selected';
  const canImport = selectedShowCount + selectedMovieCount > 0;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.previewHeader}>
        <Text style={styles.title}>Review import</Text>
        <Text style={styles.subtitle}>{summary}</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={styles.previewList}>
        {matchedShows.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>MATCHED SERIES ({matchedShows.length})</Text>
            {matchedShows.map(m => {
              const sel = !deselectedShows.has(m.tmdbShow.id);
              return (
                <TouchableOpacity
                  key={`show-${m.tmdbShow.id}`}
                  style={[styles.previewRow, !sel && styles.previewRowDim]}
                  onPress={() => onToggleShow(m.tmdbShow.id)}
                >
                  <View style={[styles.checkbox, sel && styles.checkboxChecked]}>
                    {sel ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                  <View style={styles.previewInfo}>
                    <Text style={styles.previewName} numberOfLines={1}>
                      {m.tmdbShow.name}
                    </Text>
                    <Text style={styles.previewMeta} numberOfLines={1}>
                      {m.seriesRecord.seriesName !== m.tmdbShow.name
                        ? `TV Time: "${m.seriesRecord.seriesName}" · `
                        : ''}
                      {m.episodeCount > 0 ? `${m.episodeCount} ep · ` : ''}
                      <Text style={{ color: STATUS_COLORS[m.status] }}>
                        {STATUS_LABELS[m.status]}
                      </Text>
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {unmatchedShows.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
              SERIES NOT MATCHED ({unmatchedShows.length}) — skipped
            </Text>
            {unmatchedShows.map(u => (
              <View key={u.seriesRecord.tvTimeSeriesId} style={styles.unmatchedRow}>
                <Text style={styles.unmatchedName}>{u.seriesRecord.seriesName}</Text>
                {u.episodeCount > 0 && (
                  <Text style={styles.unmatchedMeta}>{u.episodeCount} ep</Text>
                )}
              </View>
            ))}
          </>
        )}

        {matchedMovies.length > 0 && (
          <>
            <Text
              style={[
                styles.sectionLabel,
                { marginTop: matchedShows.length > 0 || unmatchedShows.length > 0 ? 24 : 0 },
              ]}
            >
              MATCHED MOVIES ({matchedMovies.length})
            </Text>
            {matchedMovies.map(m => {
              const sel = !deselectedMovies.has(m.tmdbMovie.id);
              const year = m.tmdbMovie.release_date?.slice(0, 4);
              return (
                <TouchableOpacity
                  key={`movie-${m.tmdbMovie.id}`}
                  style={[styles.previewRow, !sel && styles.previewRowDim]}
                  onPress={() => onToggleMovie(m.tmdbMovie.id)}
                >
                  <View style={[styles.checkbox, sel && styles.checkboxChecked]}>
                    {sel ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                  <View style={styles.previewInfo}>
                    <Text style={styles.previewName} numberOfLines={1}>
                      {m.tmdbMovie.title}
                      {year ? ` (${year})` : ''}
                    </Text>
                    <Text style={styles.previewMeta} numberOfLines={1}>
                      {m.record.movieName !== m.tmdbMovie.title
                        ? `TV Time: "${m.record.movieName}" · `
                        : ''}
                      <Text style={{ color: STATUS_COLORS[m.status] }}>
                        {STATUS_LABELS[m.status]}
                      </Text>
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {unmatchedMovies.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
              MOVIES NOT MATCHED ({unmatchedMovies.length}) — skipped
            </Text>
            {unmatchedMovies.map(u => (
              <View key={u.record.tvTimeUuid} style={styles.unmatchedRow}>
                <Text style={styles.unmatchedName}>{u.record.movieName}</Text>
              </View>
            ))}
          </>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.previewFooter}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
          <Text style={styles.secondaryBtnText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { flex: 1, marginLeft: 10 },
            !canImport && styles.btnDisabled,
          ]}
          onPress={onConfirm}
          disabled={!canImport}
        >
          <Text style={styles.primaryBtnText}>
            Import
            {selectedShowCount > 0 ? ` ${selectedShowCount} shows` : ''}
            {selectedShowCount > 0 && selectedMovieCount > 0 ? ' ·' : ''}
            {selectedMovieCount > 0 ? ` ${selectedMovieCount} movies` : ''}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DoneStep({
  showCount,
  movieCount,
  epCount,
  onClose,
}: {
  showCount: number;
  movieCount: number;
  epCount: number;
  onClose: () => void;
}) {
  const parts: string[] = [];
  if (showCount > 0) parts.push(`${showCount} shows`);
  if (movieCount > 0) parts.push(`${movieCount} movies`);
  if (epCount > 0) parts.push(`${epCount} episodes`);
  const summary =
    parts.length > 0
      ? `${parts.join(', ')} have been added to your library.`
      : 'Import finished.';

  return (
    <View style={styles.centered}>
      <Text style={styles.doneIcon}>✅</Text>
      <Text style={styles.title}>Import complete</Text>
      <Text style={styles.subtitle}>{summary}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
        <Text style={styles.primaryBtnText}>Go to my list</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  doneIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 32,
  },
  pickTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  pickScroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  pickLead: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 20,
  },
  scopeCard: {
    backgroundColor: theme.elevated,
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  scopeTitle: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  scopeSubtitle: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  fileCard: {
    backgroundColor: theme.elevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  fileCardReady: {
    borderColor: theme.check,
  },
  fileCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  fileCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  fileCheckOn: {
    backgroundColor: theme.check,
    borderColor: theme.check,
  },
  fileName: {
    flex: 1,
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  badgeRequired: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  badgeOptional: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  fileWhy: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 18,
    marginLeft: 30,
  },
  fileStatusBlock: {
    marginTop: 16,
  },
  fileStatusOk: {
    color: theme.check,
    fontSize: 13,
    marginBottom: 4,
  },
  fileStatusIgnored: {
    color: theme.faint,
    fontSize: 13,
    marginBottom: 4,
  },
  clearFilesBtn: {
    marginTop: 12,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  clearFilesText: {
    color: theme.muted,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  resetHint: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  resetHintText: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  resetBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: theme.accent,
    marginBottom: 10,
  },
  resetBtnText: {
    color: theme.accent,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: theme.muted,
    fontSize: 15,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 10,
  },
  footerPrimary: {
    flex: 1,
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: theme.elevated,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 16,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.accent,
    borderRadius: 3,
  },
  errorText: {
    color: theme.accent,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  confirmFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  confirmFileName: {
    flex: 1,
    color: theme.text,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  confirmFileMissing: {
    color: theme.faint,
  },
  confirmCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 24,
    marginBottom: 8,
    paddingVertical: 8,
  },
  confirmCheckLabel: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  previewHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  previewList: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  previewRowDim: {
    opacity: 0.4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  checkMark: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  previewInfo: {
    flex: 1,
  },
  previewName: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  previewMeta: {
    color: theme.muted,
    fontSize: 12,
  },
  unmatchedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  unmatchedName: {
    color: '#555',
    fontSize: 13,
    flex: 1,
  },
  unmatchedMeta: {
    color: '#444',
    fontSize: 12,
    marginLeft: 8,
  },
  previewFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
});
