import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import db from '@/lib/db';
import { theme } from '@/constants/theme';
import { uniqueByTmdbShowId, activateShowWatching } from '@/lib/userShows';
import { uniqueByTmdbMovieId } from '@/lib/userMovies';
import { posterUrl } from '@/lib/tmdb';
import {
  buildCombinedWatchHistory,
  buildMovieWatchHistory,
  buildWatchHistory,
  collapseHistorySessions,
  countValidWatches,
  formatSessionEpisodes,
  formatWatchTime,
} from '@/lib/history';
import { computeWatchStats, formatDurationMinutes } from '@/lib/stats';
import { readyForWatchlist } from '@/lib/progress';
import {
  bucketForShow,
  lastWatchedAt,
  sortNotStarted,
  sortStale,
  sortWatchNext,
  watchedCount,
  type WatchlistBucket,
} from '@/lib/watchlist';
import { matchesQuery } from '@/components/SearchField';
import SearchField from '@/components/SearchField';
import ShowGridCard from '@/components/ShowGridCard';
import SegmentTabs from '@/components/SegmentTabs';
import FilterChips from '@/components/FilterChips';
import TabScreen from '@/components/TabScreen';
import InstallApp from '@/components/InstallApp';
import { CollapsibleScrollView } from '@/components/TabBarCollapse';

type ProfileTab = 'toWatch' | 'later' | 'watched' | 'history';
type MediaFilter = 'all' | 'tv' | 'movie';

const HISTORY_PAGE = 24;

const TO_WATCH_SECTIONS: { key: WatchlistBucket; title: string }[] = [
  { key: 'watchNext', title: 'Continue watching' },
  { key: 'stale', title: "Haven't watched in a while" },
  { key: 'notStarted', title: 'Not started' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = db.useAuth();
  const [tab, setTab] = useState<ProfileTab>('history');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [query, setQuery] = useState('');
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [movingLater, setMovingLater] = useState<'series' | 'movies' | null>(null);

  const { data } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
          userMovies: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );

  const shows = uniqueByTmdbShowId(data?.userShows ?? []);
  const movies = uniqueByTmdbMovieId(data?.userMovies ?? []);
  const watchedEpisodes = data?.watchedEpisodes ?? [];
  const historyTotal = countValidWatches(watchedEpisodes);

  const stats = useMemo(
    () => computeWatchStats(watchedEpisodes, shows, movies),
    [watchedEpisodes, shows, movies]
  );

  const watchedByShow = useMemo(() => {
    const map = new Map<number, number>();
    for (const ep of watchedEpisodes) {
      const id = Number(ep.tmdbShowId);
      if (!Number.isFinite(id)) continue;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [watchedEpisodes]);

  const toWatchShows = useMemo(() => {
    return shows.filter(s => {
      if (!matchesQuery(s.tmdbShowName as string, query)) return false;
      if (s.status === 'watchLater') return false;
      const tmdbId = s.tmdbShowId as number;
      const watchedKeys = new Set(
        watchedEpisodes
          .filter(e => e.tmdbShowId === tmdbId)
          .map(e => `${e.seasonNumber}x${e.episodeNumber}`)
      );
      return readyForWatchlist(
        s.status as string | undefined,
        s.nextEpisodeAirDate as string | undefined,
        {
          nextSeasonNum: s.nextSeasonNum as number | undefined,
          nextEpisodeNum: s.nextEpisodeNum as number | undefined,
          watchedKeys,
        }
      );
    });
  }, [shows, watchedEpisodes, query]);

  const toWatchSections = useMemo(() => {
    const lastOf = (show: (typeof shows)[0]) =>
      lastWatchedAt(watchedEpisodes, show.tmdbShowId as number);

    const buckets: Record<WatchlistBucket, typeof shows> = {
      watchNext: [],
      stale: [],
      notStarted: [],
    };

    for (const show of toWatchShows) {
      const tmdbId = show.tmdbShowId as number;
      const bucket = bucketForShow(
        show,
        watchedCount(watchedEpisodes, tmdbId),
        lastOf(show)
      );
      buckets[bucket].push(show);
    }

    return TO_WATCH_SECTIONS.map(({ key, title }) => ({
      key,
      title,
      data:
        key === 'watchNext'
          ? sortWatchNext(buckets[key], lastOf)
          : key === 'stale'
            ? sortStale(buckets[key], lastOf)
            : sortNotStarted(buckets[key], lastOf),
    })).filter(s => s.data.length > 0);
  }, [toWatchShows, watchedEpisodes, shows]);

  const laterShows = useMemo(
    () =>
      shows.filter(
        s =>
          s.status === 'watchLater' &&
          matchesQuery(s.tmdbShowName as string, query)
      ),
    [shows, query]
  );

  const watchedShows = useMemo(
    () =>
      shows.filter(
        s =>
          (s.status === 'finished' || s.status === 'upToDate') &&
          matchesQuery(s.tmdbShowName as string, query)
      ),
    [shows, query]
  );
  const toWatchMovies = useMemo(
    () =>
      movies.filter(
        m =>
          m.status === 'watching' &&
          matchesQuery(m.tmdbMovieName as string, query)
      ),
    [movies, query]
  );
  const laterMovies = useMemo(
    () =>
      movies.filter(
        m =>
          m.status === 'watchLater' &&
          matchesQuery(m.tmdbMovieName as string, query)
      ),
    [movies, query]
  );
  const watchedMovies = useMemo(
    () =>
      movies.filter(
        m =>
          m.status === 'finished' &&
          matchesQuery(m.tmdbMovieName as string, query)
      ),
    [movies, query]
  );

  const showSeries = mediaFilter !== 'movie';
  const showMovies = mediaFilter !== 'tv';

  const toWatchCount =
    (showSeries ? toWatchShows.length : 0) + (showMovies ? toWatchMovies.length : 0);
  const laterCount =
    (showSeries ? laterShows.length : 0) + (showMovies ? laterMovies.length : 0);
  const watchedCountTotal =
    (showSeries ? watchedShows.length : 0) + (showMovies ? watchedMovies.length : 0);

  const { days: historyDays, matchedTotal: historyMatchCount } = useMemo(() => {
    if (mediaFilter === 'tv') {
      return buildWatchHistory(watchedEpisodes, shows, historyLimit, query);
    }
    if (mediaFilter === 'movie') {
      return buildMovieWatchHistory(movies, historyLimit, query);
    }
    return buildCombinedWatchHistory(
      watchedEpisodes,
      shows,
      movies,
      historyLimit,
      query
    );
  }, [watchedEpisodes, shows, movies, historyLimit, query, mediaFilter]);

  const historySessionsByDay = useMemo(
    () =>
      historyDays.map(day => ({
        ...day,
        sessions: collapseHistorySessions(day.entries),
      })),
    [historyDays]
  );

  const laterShowsAll = useMemo(
    () => shows.filter(s => s.status === 'watchLater'),
    [shows]
  );
  const laterMoviesAll = useMemo(
    () => movies.filter(m => m.status === 'watchLater'),
    [movies]
  );

  async function confirmBulk(title: string, message: string): Promise<boolean> {
    if (Platform.OS === 'web') {
      return window.confirm(`${title}\n\n${message}`);
    }
    return new Promise(resolve => {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Move all', onPress: () => resolve(true) },
      ]);
    });
  }

  async function moveLaterSeriesToWatching() {
    if (!user || movingLater) return;
    const targets = laterShowsAll;
    if (targets.length === 0) return;
    const ok = await confirmBulk(
      'Move series to To watch',
      `Move ${targets.length} series from Watch Later to Watching?`
    );
    if (!ok) return;

    setMovingLater('series');
    try {
      for (const show of targets) {
        const tmdbId = Number(show.tmdbShowId);
        if (!Number.isFinite(tmdbId)) continue;
        const watchedKeys = new Set(
          watchedEpisodes
            .filter(e => e.tmdbShowId === tmdbId)
            .map(e => `${e.seasonNumber}x${e.episodeNumber}`)
        );
        await activateShowWatching({
          userShowId: show.id,
          tmdbShowId: tmdbId,
          watchedKeys,
          fromWatchLater: true,
          originalLanguage: show.tmdbOriginalLanguage as string | undefined,
        });
      }
    } catch (e) {
      console.warn('Failed to move later series', e);
    } finally {
      setMovingLater(null);
    }
  }

  async function moveLaterMoviesToWatching() {
    if (!user || movingLater) return;
    const targets = laterMoviesAll;
    if (targets.length === 0) return;
    const ok = await confirmBulk(
      'Move movies to To watch',
      `Move ${targets.length} movies from Watch Later to Watching?`
    );
    if (!ok) return;

    setMovingLater('movies');
    try {
      const now = new Date().toISOString();
      const chunkSize = 50;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        await db.transact(
          chunk.map(movie =>
            db.tx.userMovies[movie.id].update({
              status: 'watching',
              lastTouchedAt: now,
            })
          )
        );
      }
    } catch (e) {
      console.warn('Failed to move later movies', e);
    } finally {
      setMovingLater(null);
    }
  }

  const emptyCopy =
    tab === 'toWatch'
      ? 'Nothing left on your list — add shows from Discover or import TV Time.'
      : tab === 'later'
        ? 'Save shows for later and they’ll show up here.'
        : tab === 'watched'
          ? 'Finished and caught-up titles will show up here.'
          : 'Episodes you check off will appear here.';

  const hasItems =
    tab === 'toWatch'
      ? toWatchCount > 0
      : tab === 'later'
        ? laterCount > 0
        : tab === 'watched'
          ? watchedCountTotal > 0
          : historyMatchCount > 0;

  return (
    <TabScreen>
      <CollapsibleScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user?.email?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
            <View style={styles.identityText}>
              <Text style={styles.email} numberOfLines={1}>
                {user?.email}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={() => db.auth.signOut()}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsBlock}>
          <Text style={styles.statsKicker}>Watch time</Text>
          <Text style={styles.statsHero}>
            {formatDurationMinutes(stats.totalMinutes)}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {formatDurationMinutes(stats.thisWeekMinutes)}
              </Text>
              <Text style={styles.statLabel}>This week</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {stats.episodeCount.toLocaleString()}
              </Text>
              <Text style={styles.statLabel}>Episodes</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {stats.showCount.toLocaleString()}
              </Text>
              <Text style={styles.statLabel}>Shows</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {stats.movieWatchedCount.toLocaleString()}
              </Text>
              <Text style={styles.statLabel}>Movies</Text>
            </View>
          </View>
          <Text style={styles.statsBreakdown}>
            {formatDurationMinutes(stats.episodeMinutes)} series
            {' · '}
            {formatDurationMinutes(stats.movieMinutes)} movies
          </Text>
        </View>

        <TouchableOpacity
          style={styles.importBtn}
          onPress={() => router.push('/import' as never)}
          accessibilityRole="button"
          accessibilityLabel="Import from TV Time"
        >
          <View style={styles.importIconWrap}>
            <Ionicons name="download-outline" size={20} color={theme.accent} />
          </View>
          <View style={styles.importBtnText}>
            <Text style={styles.importBtnTitle}>Import from TV Time</Text>
            <Text style={styles.importBtnSub}>Bring in your GDPR export</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.muted} />
        </TouchableOpacity>

        <InstallApp />

        <View style={styles.tabsRow}>
          <SegmentTabs
            value={tab}
            onChange={key => {
              setTab(key);
              if (key !== 'history') setHistoryLimit(HISTORY_PAGE);
            }}
            options={[
              {
                key: 'history',
                label: `History${
                  historyMatchCount > 0 || historyTotal > 0
                    ? ` (${historyMatchCount.toLocaleString()})`
                    : ''
                }`,
              },
              { key: 'toWatch', label: `To watch (${toWatchCount})` },
              { key: 'later', label: `Later (${laterCount})` },
              { key: 'watched', label: `Watched (${watchedCountTotal})` },
            ]}
          />
        </View>

        <FilterChips
          value={mediaFilter}
          onChange={setMediaFilter}
          options={[
            { key: 'all', label: 'All' },
            { key: 'tv', label: 'Series' },
            { key: 'movie', label: 'Movies' },
          ]}
        />

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={tab === 'history' ? 'Search history' : 'Search your list'}
        />

        {!hasItems ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {query.trim() ? 'No matches' : 'Nothing here yet'}
            </Text>
            <Text style={styles.emptySub}>
              {query.trim() ? 'Try a different name.' : emptyCopy}
            </Text>
          </View>
        ) : null}

        {tab === 'toWatch' && hasItems ? (
          <>
            {showSeries
              ? toWatchSections.map(section => (
                  <View key={section.key} style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
                      <Text style={styles.sectionCount}>{section.data.length}</Text>
                    </View>
                    <View style={styles.grid}>
                      {section.data.map(show => {
                        const tmdbId = show.tmdbShowId as number;
                        const watched = watchedByShow.get(tmdbId) ?? 0;
                        const total = Number(show.totalEpisodes);
                        const remaining =
                          show.status === 'watching'
                            ? Math.max(0, Number(show.remainingAiredCount) || 0) + 1
                            : undefined;
                        return (
                          <ShowGridCard
                            key={show.id}
                            name={show.tmdbShowName as string}
                            posterPath={show.tmdbPosterPath as string | undefined}
                            unwatchedCount={remaining}
                            watchedCount={watched}
                            totalEpisodes={
                              Number.isFinite(total) && total > 0 ? total : undefined
                            }
                            onPress={() => router.push(`/show/${tmdbId}`)}
                          />
                        );
                      })}
                    </View>
                  </View>
                ))
              : null}
            {showMovies && toWatchMovies.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>MOVIES</Text>
                  <Text style={styles.sectionCount}>{toWatchMovies.length}</Text>
                </View>
                <View style={styles.grid}>
                  {toWatchMovies.map(movie => (
                    <ShowGridCard
                      key={movie.id}
                      name={movie.tmdbMovieName as string}
                      posterPath={movie.tmdbPosterPath as string | undefined}
                      onPress={() =>
                        router.push({
                          pathname: '/movie/[id]',
                          params: { id: String(movie.tmdbMovieId) },
                        })
                      }
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        {tab === 'later' && hasItems ? (
          <>
            {showSeries && laterShowsAll.length > 0 ? (
              <TouchableOpacity
                style={[styles.bulkBtn, movingLater != null && styles.bulkBtnDisabled]}
                onPress={moveLaterSeriesToWatching}
                disabled={movingLater != null}
                accessibilityRole="button"
                accessibilityLabel="Move all series to To watch"
              >
                {movingLater === 'series' ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="play-forward-outline" size={18} color="#fff" />
                )}
                <Text style={styles.bulkBtnText}>
                  {movingLater === 'series'
                    ? 'Moving series…'
                    : `Start watching all series (${laterShowsAll.length})`}
                </Text>
              </TouchableOpacity>
            ) : null}
            {showMovies && laterMoviesAll.length > 0 ? (
              <TouchableOpacity
                style={[styles.bulkBtn, movingLater != null && styles.bulkBtnDisabled]}
                onPress={moveLaterMoviesToWatching}
                disabled={movingLater != null}
                accessibilityRole="button"
                accessibilityLabel="Move all movies to To watch"
              >
                {movingLater === 'movies' ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="play-forward-outline" size={18} color="#fff" />
                )}
                <Text style={styles.bulkBtnText}>
                  {movingLater === 'movies'
                    ? 'Moving movies…'
                    : `Start watching all movies (${laterMoviesAll.length})`}
                </Text>
              </TouchableOpacity>
            ) : null}
            <View style={[styles.grid, styles.watchedGrid]}>
              {showSeries
                ? laterShows.map(show => {
                    const tmdbId = show.tmdbShowId as number;
                    const watched = watchedByShow.get(tmdbId) ?? 0;
                    const total = Number(show.totalEpisodes);
                    return (
                      <ShowGridCard
                        key={show.id}
                        name={show.tmdbShowName as string}
                        posterPath={show.tmdbPosterPath as string | undefined}
                        watchedCount={watched}
                        totalEpisodes={Number.isFinite(total) && total > 0 ? total : undefined}
                        onPress={() => router.push(`/show/${tmdbId}`)}
                      />
                    );
                  })
                : null}
              {showMovies
                ? laterMovies.map(movie => (
                    <ShowGridCard
                      key={movie.id}
                      name={movie.tmdbMovieName as string}
                      posterPath={movie.tmdbPosterPath as string | undefined}
                      onPress={() =>
                        router.push({
                          pathname: '/movie/[id]',
                          params: { id: String(movie.tmdbMovieId) },
                        })
                      }
                    />
                  ))
                : null}
            </View>
          </>
        ) : null}

        {tab === 'watched' && hasItems ? (
          <View style={[styles.grid, styles.watchedGrid]}>
            {showSeries
              ? watchedShows.map(show => {
                  const tmdbId = show.tmdbShowId as number;
                  const watched = watchedByShow.get(tmdbId) ?? 0;
                  const total = Number(show.totalEpisodes);
                  return (
                    <ShowGridCard
                      key={show.id}
                      name={show.tmdbShowName as string}
                      posterPath={show.tmdbPosterPath as string | undefined}
                      watchedCount={watched}
                      totalEpisodes={Number.isFinite(total) && total > 0 ? total : undefined}
                      onPress={() => router.push(`/show/${tmdbId}`)}
                    />
                  );
                })
              : null}
            {showMovies
              ? watchedMovies.map(movie => (
                  <ShowGridCard
                    key={movie.id}
                    name={movie.tmdbMovieName as string}
                    posterPath={movie.tmdbPosterPath as string | undefined}
                    watchedCount={1}
                    totalEpisodes={1}
                    onPress={() =>
                      router.push({
                        pathname: '/movie/[id]',
                        params: { id: String(movie.tmdbMovieId) },
                      })
                    }
                  />
                ))
              : null}
          </View>
        ) : null}

        {tab === 'history' && hasItems ? (
          <View style={styles.historyList}>
            {historySessionsByDay.map(day => (
              <View key={day.key} style={styles.historyDay}>
                <View style={styles.historyDayHeader}>
                  <Text style={styles.historyDayLabel}>{day.label}</Text>
                  <Text style={styles.historyDayCount}>
                    {(() => {
                      const n = day.entries.length;
                      const allMovies = day.entries.every(e => e.kind === 'movie');
                      const allTv = day.entries.every(e => e.kind === 'tv');
                      if (n === 1) return allMovies ? '1 film' : '1 ep';
                      if (allMovies) return `${n} films`;
                      if (allTv) return `${n} eps`;
                      return `${n} items`;
                    })()}
                  </Text>
                </View>
                {day.sessions.map(session => {
                  const poster = posterUrl(session.posterPath, 'w185');
                  const epLabel = formatSessionEpisodes(session.episodes, session.kind);
                  return (
                    <TouchableOpacity
                      key={session.id}
                      style={styles.historyRow}
                      onPress={() =>
                        session.kind === 'movie'
                          ? router.push({
                              pathname: '/movie/[id]',
                              params: { id: String(session.tmdbId) },
                            })
                          : router.push(`/show/${session.tmdbId}`)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${session.title}, ${epLabel}`}
                    >
                      {poster ? (
                        <Image source={{ uri: poster }} style={styles.historyPoster} />
                      ) : (
                        <View style={[styles.historyPoster, styles.historyPosterFallback]}>
                          <Text style={styles.historyPosterFallbackText}>
                            {session.kind === 'movie' ? 'FILM' : 'TV'}
                          </Text>
                        </View>
                      )}
                      <View style={styles.historyInfo}>
                        <Text style={styles.historyShow} numberOfLines={1}>
                          {session.title}
                        </Text>
                        <Text style={styles.historyEp} numberOfLines={1}>
                          {epLabel}
                        </Text>
                      </View>
                      <Text style={styles.historyTime}>
                        {formatWatchTime(session.watchedAt)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            {historyMatchCount > historyLimit ? (
              <TouchableOpacity
                style={styles.historyMore}
                onPress={() => setHistoryLimit(n => n + HISTORY_PAGE)}
                accessibilityRole="button"
                accessibilityLabel="Show more history"
              >
                <Text style={styles.historyMoreText}>
                  Show more · {historyMatchCount - historyLimit} left
                </Text>
              </TouchableOpacity>
            ) : historyMatchCount > HISTORY_PAGE ? (
              <Text style={styles.historyEnd}>
                All {historyMatchCount.toLocaleString()} checks loaded
              </Text>
            ) : null}
          </View>
        ) : null}
      </CollapsibleScrollView>
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: theme.tabBarClearance + 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  email: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  signOutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  signOutText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '500',
  },
  statsBlock: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    backgroundColor: theme.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  statsKicker: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 4,
  },
  statsHero: {
    color: theme.accent,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
    textAlign: 'center',
    marginBottom: 14,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 4,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    minWidth: 0,
  },
  statValue: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  statLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '500',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginVertical: 4,
  },
  statsBreakdown: {
    color: theme.faint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: theme.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  importIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(232, 93, 76, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importBtnText: {
    flex: 1,
  },
  importBtnTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  importBtnSub: {
    color: theme.muted,
    fontSize: 12,
    marginTop: 1,
  },
  tabsRow: {
    paddingHorizontal: 8,
    marginTop: 4,
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: theme.accent,
  },
  bulkBtnDisabled: {
    opacity: 0.7,
  },
  bulkBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  empty: {
    paddingHorizontal: 28,
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySub: {
    color: theme.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
  },
  watchedGrid: {
    paddingTop: 12,
  },
  section: {
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionTitle: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  sectionCount: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
  },
  historyList: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  historyDay: {
    marginBottom: 18,
  },
  historyDayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  historyDayLabel: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  historyDayCount: {
    color: theme.faint,
    fontSize: 12,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  historyPoster: {
    width: 40,
    height: 60,
    borderRadius: 6,
    backgroundColor: theme.elevated,
  },
  historyPosterFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyPosterFallbackText: {
    color: theme.faint,
    fontSize: 9,
    fontWeight: '700',
  },
  historyInfo: {
    flex: 1,
    gap: 2,
  },
  historyShow: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  historyEp: {
    color: theme.muted,
    fontSize: 12,
  },
  historyTime: {
    color: theme.faint,
    fontSize: 12,
  },
  historyMore: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  historyMoreText: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  historyEnd: {
    color: theme.faint,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
});
