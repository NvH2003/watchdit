import { useState, useCallback } from 'react';
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
import { mergeGdprFiles, isGdprBundle, NamedCsv } from '@/lib/gdprImport';
import { findProgressFromTmdb, progressUpdates } from '@/lib/progress';
import { theme } from '@/constants/theme';
import { createUserShowTx } from '@/lib/userShows';

type Step = 'pick' | 'matching' | 'preview' | 'resetting' | 'expanding' | 'importing' | 'classifying' | 'done';

const CHUNK_SIZE = 50;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export default function ImportScreen() {
  const router = useRouter();
  const { user } = db.useAuth();

  // Existing shows for deduplication
  const { data: dbData } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );

  const [step, setStep] = useState<Step>('pick');
  const [matchProgress, setMatchProgress] = useState({ done: 0, total: 0 });
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  const [matched, setMatched] = useState<MatchedShow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedShow[]>([]);
  const [allEpisodes, setAllEpisodes] = useState<EpisodeRecord[]>([]);
  // Which matched shows the user deselected
  const [deselected, setDeselected] = useState<Set<number>>(new Set());

  const [error, setError] = useState('');

  async function pickFile() {
    setError('');
    try {
      const files = Platform.OS === 'web' ? await pickFilesWeb() : await pickFilesNative();
      if (files.length === 0) return;
      await processFiles(files);
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
        if (list.length === 0) { resolve([]); return; }
        try {
          const files: NamedCsv[] = [];
          for (const file of list) {
            files.push({ name: file.name, text: await file.text() });
          }
          resolve(files);
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
    const files: NamedCsv[] = [];
    for (const asset of result.assets) {
      const response = await fetch(asset.uri);
      files.push({ name: asset.name ?? 'file.csv', text: await response.text() });
    }
    return files;
  }

  async function processFiles(files: NamedCsv[]) {
    setStep('matching');
    setMatchProgress({ done: 0, total: 0 });
    setError('');
    try {
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
          setStep('pick');
          return;
        }

        const result = await matchShowsByTvdb(series, (done, total) => {
          setMatchProgress({ done, total });
        });
        setMatched(result.matched);
        setUnmatched(result.unmatched);
        if (!tracking) {
          setError(
            'No tracking-prod-records-v2.csv found. Episode checkmarks will use episode counts only, not your last watched S/E. You can go back and add that file for a more accurate import.'
          );
        }
        setStep('preview');
        return;
      }

      const text = files[0]?.text ?? '';
      const { series, episodes } = parseCSV(text);
      setAllEpisodes(episodes);

      if (series.length === 0) {
        setError(
          'Those files are not the TV Time GDPR CSVs we need. Select at least user_tv_show_data.csv. For accurate checkmarks also add tracking-prod-records-v2.csv, followed_tv_show.csv, and user_show_special_status.csv. Skip the rest of the dump.'
        );
        setStep('pick');
        return;
      }

      const result = await matchShowsToTmdb(series, episodes, (done, total) => {
        setMatchProgress({ done, total });
      });

      setMatched(result.matched);
      setUnmatched(result.unmatched);
      setStep('preview');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Matching failed');
      setStep('pick');
    }
  }

  async function resetLibrary() {
    if (!user) return;
    const ok =
      Platform.OS === 'web'
        ? window.confirm(
            'This deletes all your shows and watched episodes so you can import again. Continue?'
          )
        : await new Promise<boolean>(resolve => {
            Alert.alert(
              'Reset library',
              'This deletes all your shows and watched episodes so you can import again.',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Delete everything', style: 'destructive', onPress: () => resolve(true) },
              ]
            );
          });
    if (!ok) return;

    setError('');
    setStep('resetting');
    const shows = dbData?.userShows ?? [];
    const episodes = dbData?.watchedEpisodes ?? [];
    const total = shows.length + episodes.length;
    let done = 0;
    setImportProgress({ done: 0, total: Math.max(total, 1) });

    try {
      for (const chunk of chunkArray(episodes, CHUNK_SIZE)) {
        await db.transact(chunk.map(e => db.tx.watchedEpisodes[e.id].delete()));
        done += chunk.length;
        setImportProgress({ done, total });
      }
      for (const chunk of chunkArray(shows, CHUNK_SIZE)) {
        await db.transact(chunk.map(s => db.tx.userShows[s.id].delete()));
        done += chunk.length;
        setImportProgress({ done, total });
      }
      setStep('pick');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reset failed');
      setStep('pick');
    }
  }

  function toggleShow(tmdbId: number) {
    setDeselected(prev => {
      const next = new Set(prev);
      if (next.has(tmdbId)) next.delete(tmdbId);
      else next.add(tmdbId);
      return next;
    });
  }

  async function runImport() {
    if (!user) return;
    setStep('importing');

    const toImport = matched.filter(m => !deselected.has(m.tmdbShow.id));
    const totalShows = toImport.length;
    let doneShows = 0;
    setImportProgress({ done: 0, total: totalShows });

    const existingByTmdb = new Map(
      (dbData?.userShows ?? []).map(s => [s.tmdbShowId as number, s.id])
    );

    type ToClassify = {
      tmdbId: number;
      startSeason: number;
      entityId: string;
    };
    const toClassify: ToClassify[] = [];

    try {
      setStep('expanding');
      setImportProgress({ done: 0, total: toImport.length });
      const expandedEpisodes = await expandWatchedEpisodes(
        toImport,
        allEpisodes,
        (done, total) => setImportProgress({ done, total })
      );

      setStep('importing');
      setImportProgress({ done: 0, total: toImport.length });
      doneShows = 0;

      const seenTmdb = new Set<number>();
      for (const m of toImport) {
        const startSeason = Math.max(1, m.seriesRecord.lastSeasonNum ?? 1);
        const tmdbId = m.tmdbShow.id;
        if (seenTmdb.has(tmdbId)) {
          doneShows++;
          setImportProgress({ done: doneShows, total: totalShows });
          continue;
        }
        seenTmdb.add(tmdbId);

        const existingId = existingByTmdb.get(tmdbId);
        if (existingId) {
          if (m.status === 'watching') {
            toClassify.push({ entityId: existingId, tmdbId, startSeason });
          }
          doneShows++;
          setImportProgress({ done: doneShows, total: totalShows });
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
        setImportProgress({ done: doneShows, total: totalShows });
      }

      const importedTmdbIds = new Set(toImport.map(m => m.tmdbShow.id));
      const tvTimeTmdbMap = new Map(
        toImport.map(m => [m.seriesRecord.tvTimeSeriesId, m.tmdbShow.id])
      );

      const validEpisodes = expandedEpisodes.filter(ep => {
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
            return db.tx.watchedEpisodes[instantId()].update({
              tmdbShowId: tmdbId,
              seasonNumber: ep.seasonNumber,
              episodeNumber: ep.episodeNumber,
              watchedAt: ep.watchedAt,
            }).link({ $user: user.id });
          })
        );
        doneEpChunks++;
        setImportProgress({
          done: totalShows + doneEpChunks,
          total: totalShows + totalEpChunks,
        });
        await new Promise(r => setTimeout(r, 100));
      }

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

      setStep('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
      setStep('preview');
    }
  }

  const selectedCount = matched.filter(m => !deselected.has(m.tmdbShow.id)).length;
  const selectedEpCount = matched
    .filter(m => !deselected.has(m.tmdbShow.id))
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
        {step === 'pick' && (
          <PickStep
            onPick={pickFile}
            onReset={resetLibrary}
            hasData={(dbData?.userShows?.length ?? 0) > 0 || (dbData?.watchedEpisodes?.length ?? 0) > 0}
            error={error}
          />
        )}
        {step === 'resetting' && (
          <ProgressStep
            title="Clearing your library…"
            subtitle={`${importProgress.done} / ${importProgress.total} records deleted`}
            progress={
              importProgress.total > 0
                ? importProgress.done / importProgress.total
                : 0
            }
          />
        )}
        {step === 'expanding' && (
          <ProgressStep
            title="Rebuilding watch history…"
            subtitle={`${importProgress.done} / ${importProgress.total} shows — marking every episode up to your last watched`}
            progress={
              importProgress.total > 0
                ? importProgress.done / importProgress.total
                : 0
            }
          />
        )}
        {step === 'matching' && (
          <ProgressStep
            title="Matching shows…"
            subtitle={`${matchProgress.done} / ${matchProgress.total} shows searched`}
            progress={
              matchProgress.total > 0
                ? matchProgress.done / matchProgress.total
                : 0
            }
          />
        )}
        {step === 'preview' && (
          <PreviewStep
            matched={matched}
            unmatched={unmatched}
            deselected={deselected}
            selectedCount={selectedCount}
            selectedEpCount={selectedEpCount}
            onToggle={toggleShow}
            onConfirm={runImport}
            onBack={() => setStep('pick')}
            error={error}
          />
        )}
        {step === 'importing' && (
          <ProgressStep
            title="Importing…"
            subtitle={`${importProgress.done} / ${importProgress.total} items written`}
            progress={
              importProgress.total > 0
                ? importProgress.done / importProgress.total
                : 0
            }
          />
        )}
        {step === 'classifying' && (
          <ProgressStep
            title="Sorting your shows…"
            subtitle={`${importProgress.done} / ${importProgress.total} placed in Watching, Up to Date, or Finished`}
            progress={
              importProgress.total > 0
                ? importProgress.done / importProgress.total
                : 0
            }
          />
        )}
        {step === 'done' && (
          <DoneStep
            showCount={selectedCount}
            epCount={selectedEpCount}
            onClose={() => router.back()}
          />
        )}
      </SafeAreaView>
    </>
  );
}

// ─── Sub-screens ─────────────────────────────────────────────────────────────

const GDPR_FILES = [
  {
    name: 'user_tv_show_data.csv',
    required: true,
    why: 'Your followed shows, titles, and how many episodes you watched.',
  },
  {
    name: 'tracking-prod-records-v2.csv',
    required: false,
    why: 'Last watched season and episode — so every episode up to that point is marked seen.',
  },
  {
    name: 'followed_tv_show.csv',
    required: false,
    why: 'Which shows you archived.',
  },
  {
    name: 'user_show_special_status.csv',
    required: false,
    why: 'Watch Later (for_later).',
  },
] as const;

function PickStep({
  onPick,
  onReset,
  hasData,
  error,
}: {
  onPick: () => void;
  onReset: () => void;
  hasData: boolean;
  error: string;
}) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.pickScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.pickTitle}>Import from your GDPR folder</Text>
      <Text style={styles.pickLead}>
        TV Time’s export contains dozens of CSVs. This app uses only four.
        Select those four together — skip comments, friends, tokens, ads, IPs,
        and the rest.
      </Text>

      {GDPR_FILES.map(file => (
        <View key={file.name} style={styles.fileCard}>
          <View style={styles.fileCardTop}>
            <Text style={styles.fileName}>{file.name}</Text>
            <Text style={file.required ? styles.badgeRequired : styles.badgeOptional}>
              {file.required ? 'Required' : 'Recommended'}
            </Text>
          </View>
          <Text style={styles.fileWhy}>{file.why}</Text>
        </View>
      ))}

      <Text style={styles.skipNote}>
        Ignore every other file in the dump. They are not used for your watch
        list.
      </Text>

      {hasData ? (
        <View style={styles.resetHint}>
          <Text style={styles.resetHintText}>
            You already have shows in this app. Reset the library first, then
            import — otherwise the old incomplete data stays mixed in.
          </Text>
          <TouchableOpacity style={[styles.resetBtn, { marginBottom: 0 }]} onPress={onReset}>
            <Text style={styles.resetBtnText}>Reset library first</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity style={[styles.primaryBtn, styles.pickPrimary]} onPress={onPick}>
        <Text style={styles.primaryBtnText}>Select the 4 CSV files</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any }]} />
      </View>
    </View>
  );
}

function PreviewStep({
  matched,
  unmatched,
  deselected,
  selectedCount,
  selectedEpCount,
  onToggle,
  onConfirm,
  onBack,
  error,
}: {
  matched: MatchedShow[];
  unmatched: UnmatchedShow[];
  deselected: Set<number>;
  selectedCount: number;
  selectedEpCount: number;
  onToggle: (id: number) => void;
  onConfirm: () => void;
  onBack: () => void;
  error: string;
}) {
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

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.previewHeader}>
        <Text style={styles.title}>Review import</Text>
        <Text style={styles.subtitle}>
          {selectedCount} shows · {selectedEpCount} episodes
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={styles.previewList}>
        <Text style={styles.sectionLabel}>
          MATCHED ({matched.length})
        </Text>
        {matched.map(m => {
          const sel = !deselected.has(m.tmdbShow.id);
          return (
            <TouchableOpacity
              key={m.tmdbShow.id}
              style={[styles.previewRow, !sel && styles.previewRowDim]}
              onPress={() => onToggle(m.tmdbShow.id)}
            >
              <View
                style={[
                  styles.checkbox,
                  sel && styles.checkboxChecked,
                ]}
              >
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

        {unmatched.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
              NOT MATCHED ({unmatched.length}) — will be skipped
            </Text>
            {unmatched.map(u => (
              <View key={u.seriesRecord.tvTimeSeriesId} style={styles.unmatchedRow}>
                <Text style={styles.unmatchedName}>{u.seriesRecord.seriesName}</Text>
                {u.episodeCount > 0 && (
                  <Text style={styles.unmatchedMeta}>{u.episodeCount} ep</Text>
                )}
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
          style={[styles.primaryBtn, { flex: 1, marginLeft: 10 }]}
          onPress={onConfirm}
          disabled={selectedCount === 0}
        >
          <Text style={styles.primaryBtnText}>
            Import {selectedCount} shows
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DoneStep({
  showCount,
  epCount,
  onClose,
}: {
  showCount: number;
  epCount: number;
  onClose: () => void;
}) {
  return (
    <View style={styles.centered}>
      <Text style={styles.doneIcon}>✅</Text>
      <Text style={styles.title}>Import complete</Text>
      <Text style={styles.subtitle}>
        {showCount} shows and {epCount} episodes have been added to your watch history.
      </Text>
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
  icon: {
    fontSize: 64,
    marginBottom: 20,
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
  fileCard: {
    backgroundColor: theme.elevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  fileCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
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
  },
  skipNote: {
    color: theme.faint,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 20,
  },
  resetHint: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  resetHintText: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  pickPrimary: {
    alignSelf: 'stretch',
  },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    color: theme.muted,
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
  resetBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: theme.accent,
    marginBottom: 12,
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
