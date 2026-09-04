import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { id as instantId } from '@instantdb/react-native';
import db from '@/lib/db';
import ShowRowTV, { ShowStatus } from '@/components/ShowRowTV';
import ShowGridCard from '@/components/ShowGridCard';
import {
  hasAired,
  isFutureAirDate,
  findProgressFromTmdb,
  progressUpdates,
  remainingAfterCurrent,
  localDayKey,
  msUntilNextLocalMidnight,
  readyForWatchlist,
  readyForUpcoming,
} from '@/lib/progress';
import { theme } from '@/constants/theme';
import { uniqueByTmdbShowId } from '@/lib/userShows';
import {
  lastWatchedAt,
  watchedCount,
  sortTime,
  bucketForShow,
  sortWatchNext,
  sortStale,
  sortNotStarted,
  WatchlistBucket,
  UpcomingBucket,
  upcomingBucket,
  sortByAirDate,
} from '@/lib/watchlist';
import { Ionicons } from '@expo/vector-icons';
import FilterChips from '@/components/FilterChips';
import SegmentTabs from '@/components/SegmentTabs';
import TabScreen from '@/components/TabScreen';
import { CollapsibleScrollView } from '@/components/TabBarCollapse';

type TabKey = 'watchlist' | 'upcoming';

type UndoSnapshot = {
  showId: string;
  episodeId: string | null;
  showName: string;
  previous: {
    lastTouchedAt: string;
    nextSeasonNum: number;
    nextEpisodeNum: number;
    nextEpisodeName: string;
    nextEpisodeAirDate: string;
    nextEpisodeStillPath: string;
    status: string;
  };
};

const UNDO_MS = 8000;

const SECTION_META: { key: WatchlistBucket; title: string }[] = [
  { key: 'watchNext', title: 'Continue watching' },
  { key: 'stale', title: "Haven't watched in a while" },
  { key: 'notStarted', title: 'Not started' },
];

const UPCOMING_SECTION_META: { key: UpcomingBucket; title: string }[] = [
  { key: 'today', title: 'Today' },
  { key: 'thisWeek', title: 'This week' },
  { key: 'nextWeek', title: 'Next week' },
  { key: 'laterThisMonth', title: 'Later this month' },
  { key: 'nextMonth', title: 'Next month' },
  { key: 'later', title: 'Later' },
];

export default function EpisodesScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('watchlist');
  const [isGrid, setIsGrid] = useState(false);
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);
  const [bucketFilter, setBucketFilter] = useState<'all' | WatchlistBucket>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dayKey, setDayKey] = useState(() => localDayKey());

  const { user } = db.useAuth();
  const { isLoading, data } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );

  const allShows = uniqueByTmdbShowId(data?.userShows ?? []);
  const watchedEps = data?.watchedEpisodes ?? [];
  const queryReady = !user || (!isLoading && data != null);
  const checkingRef = useRef(false);
  const recategorizedRef = useRef(false);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  // Recompute air-date lists at local midnight (and after sleep/wake).
  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;
    const armMidnight = () => {
      midnightTimer = setTimeout(() => {
        setDayKey(localDayKey());
        armMidnight();
      }, msUntilNextLocalMidnight());
    };
    armMidnight();
    const poll = setInterval(() => {
      const key = localDayKey();
      setDayKey(prev => (prev === key ? prev : key));
    }, 60_000);
    return () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      clearInterval(poll);
    };
  }, []);

  // Recategorize imported/stale shows: watching vs up to date vs finished.
  useFocusEffect(
    useCallback(() => {
      if (!user || checkingRef.current) return;
      const toCheck = allShows.filter(s => {
        if (s.status === 'watchLater' || s.status === 'finished') return false;
        const air = s.nextEpisodeAirDate as string | undefined;
        // Next episode already out — refresh so To watch gets full +N / stills.
        if (s.status === 'upToDate' && hasAired(air)) return true;
        // No known future episode — TMDB may have published a new one.
        if (s.status === 'upToDate' && !isFutureAirDate(air)) return true;
        if (!recategorizedRef.current) return true;
        return s.status === 'watching' && s.remainingAiredCount == null;
      });
      if (toCheck.length === 0) return;

      checkingRef.current = true;
      let cancelled = false;

      (async () => {
        try {
          for (let i = 0; i < toCheck.length; i++) {
            if (cancelled) return;
            const show = toCheck[i];
            const tmdbId = show.tmdbShowId as number;
            const watched = new Set(
              watchedEps
                .filter(e => e.tmdbShowId === tmdbId)
                .map(e => `${e.seasonNumber}x${e.episodeNumber}`)
            );
            const startSeason = (show.nextSeasonNum as number | undefined) ?? 1;
            if (i > 0 && i % 5 === 0) {
              await new Promise(r => setTimeout(r, 400));
            }
            const progress = await findProgressFromTmdb(tmdbId, watched, startSeason);
            if (cancelled) return;
            await db.transact([
              db.tx.userShows[show.id].update(progressUpdates(progress)),
            ]);
          }
          recategorizedRef.current = true;
        } catch (e) {
          console.warn('Failed to recategorize shows', e);
        } finally {
          checkingRef.current = false;
        }
      })();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, allShows.length, watchedEps.length, dayKey])
  );

  const watchlistShows = allShows.filter(s =>
    readyForWatchlist(s.status as string | undefined, s.nextEpisodeAirDate as string | undefined)
  );
  const upcomingShows = allShows.filter(s =>
    readyForUpcoming(s.status as string | undefined, s.nextEpisodeAirDate as string | undefined)
  );

  const sections = useMemo(() => {
    const lastOf = (show: (typeof allShows)[0]) =>
      lastWatchedAt(watchedEps, show.tmdbShowId as number);

    const buckets: Record<WatchlistBucket, typeof allShows> = {
      watchNext: [],
      stale: [],
      notStarted: [],
    };

    for (const show of watchlistShows) {
      const tmdbId = show.tmdbShowId as number;
      const bucket = bucketForShow(show, watchedCount(watchedEps, tmdbId), lastOf(show));
      buckets[bucket].push(show);
    }

    return SECTION_META.map(({ key, title }) => ({
      key,
      title,
      data:
        key === 'watchNext'
          ? sortWatchNext(buckets[key], lastOf)
          : key === 'stale'
            ? sortStale(buckets[key], lastOf)
            : sortNotStarted(buckets[key], lastOf),
    })).filter(s => s.data.length > 0);
  }, [watchlistShows, watchedEps, allShows, dayKey]);

  const upcomingSections = useMemo(() => {
    const airOf = (show: (typeof allShows)[0]) =>
      (show.nextEpisodeAirDate as string | undefined) ?? null;

    const buckets: Record<UpcomingBucket, typeof allShows> = {
      today: [],
      thisWeek: [],
      nextWeek: [],
      laterThisMonth: [],
      nextMonth: [],
      later: [],
    };

    for (const show of upcomingShows) {
      buckets[upcomingBucket(airOf(show))].push(show);
    }

    return UPCOMING_SECTION_META.map(({ key, title }) => ({
      key,
      title,
      data: sortByAirDate(buckets[key], airOf),
    })).filter(s => s.data.length > 0);
  }, [upcomingShows, allShows, dayKey]);

  function getWatchedCount(showId: number) {
    return watchedCount(watchedEps, showId);
  }

  function getRemainingCount(show: (typeof allShows)[0]) {
    const plus = show.remainingAiredCount as number | undefined;
    if (plus != null) return Math.max(0, plus);
    const stored = show.unwatchedAiredCount as number | undefined;
    if (stored != null) return remainingAfterCurrent(stored);
    const total = (show.totalEpisodes as number | undefined) ?? 0;
    const watched = getWatchedCount(show.tmdbShowId as number);
    return remainingAfterCurrent(Math.max(0, total - watched));
  }

  async function handleStatusChange(showId: string, status: ShowStatus) {
    await db.transact([db.tx.userShows[showId].update({ status })]);
  }

  async function handleRemove(showId: string) {
    await db.transact([db.tx.userShows[showId].delete()]);
  }

  async function handleCheck(show: (typeof allShows)[0]) {
    if (!user) return;
    if (!hasAired(show.nextEpisodeAirDate as string | undefined)) return;
    const sId = show.id;
    const tmdbId = show.tmdbShowId as number;
    const curSeason = (show.nextSeasonNum as number | undefined) ?? 1;
    const curEpisode = (show.nextEpisodeNum as number | undefined) ?? 1;
    const previousSortIso = new Date(
      sortTime(show, lastWatchedAt(watchedEps, tmdbId))
    ).toISOString();
    const previous = {
      lastTouchedAt: previousSortIso,
      nextSeasonNum: curSeason,
      nextEpisodeNum: curEpisode,
      nextEpisodeName: (show.nextEpisodeName as string | undefined) ?? '',
      nextEpisodeAirDate: (show.nextEpisodeAirDate as string | undefined) ?? '',
      nextEpisodeStillPath: (show.nextEpisodeStillPath as string | undefined) ?? '',
      status: (show.status as string) ?? 'watching',
    };

    const alreadyWatched = watchedEps.find(
      e => e.tmdbShowId === tmdbId && e.seasonNumber === curSeason && e.episodeNumber === curEpisode
    );

    const episodeId = alreadyWatched ? null : instantId();
    const now = new Date().toISOString();
    const transactions: ReturnType<typeof db.tx.watchedEpisodes[string]['update']>[] = [];

    if (episodeId) {
      transactions.push(
        db.tx.watchedEpisodes[episodeId].update({
          tmdbShowId: tmdbId,
          seasonNumber: curSeason,
          episodeNumber: curEpisode,
          watchedAt: now,
        }).link({ $user: user.id })
      );
    }

    try {
      const watched = new Set(
        watchedEps
          .filter(e => e.tmdbShowId === tmdbId)
          .map(e => `${e.seasonNumber}x${e.episodeNumber}`)
      );
      watched.add(`${curSeason}x${curEpisode}`);

      const progress = await findProgressFromTmdb(tmdbId, watched, curSeason);
      await db.transact([
        ...transactions,
        db.tx.userShows[sId].update({
          ...progressUpdates(progress),
          lastTouchedAt: now,
        }),
      ]);
      setUndo({
        showId: sId,
        episodeId,
        showName: show.tmdbShowName as string,
        previous,
      });
    } catch (e) {
      console.warn('Failed to advance episode', e);
      if (transactions.length > 0) {
        await db.transact([
          ...transactions,
          db.tx.userShows[sId].update({ lastTouchedAt: now }),
        ]);
        setUndo({
          showId: sId,
          episodeId,
          showName: show.tmdbShowName as string,
          previous,
        });
      }
    }
  }

  async function undoLast() {
    if (!undo) return;
    const snapshot = undo;
    setUndo(null);
    const showOp = db.tx.userShows[snapshot.showId].update({
      lastTouchedAt: snapshot.previous.lastTouchedAt,
      nextSeasonNum: snapshot.previous.nextSeasonNum,
      nextEpisodeNum: snapshot.previous.nextEpisodeNum,
      nextEpisodeName: snapshot.previous.nextEpisodeName,
      nextEpisodeAirDate: snapshot.previous.nextEpisodeAirDate,
      nextEpisodeStillPath: snapshot.previous.nextEpisodeStillPath,
      status: snapshot.previous.status,
    });
    await db.transact(
      snapshot.episodeId
        ? [showOp, db.tx.watchedEpisodes[snapshot.episodeId].delete()]
        : [showOp]
    );
  }

  function renderShow(item: (typeof allShows)[0]) {
    if (isGrid) {
      return (
        <ShowGridCard
          key={item.id}
          name={item.tmdbShowName as string}
          posterPath={item.tmdbPosterPath as string | null}
          unwatchedCount={getRemainingCount(item)}
          watchedCount={getWatchedCount(item.tmdbShowId as number)}
          totalEpisodes={item.totalEpisodes as number | undefined}
          onPress={() => router.push(`/show/${item.tmdbShowId}`)}
        />
      );
    }
    return (
      <ShowRowTV
        key={item.id}
        id={item.id}
        name={item.tmdbShowName as string}
        posterPath={item.tmdbPosterPath as string | null}
        status={(item.status as ShowStatus) ?? 'watching'}
        nextSeasonNum={item.nextSeasonNum as number | null | undefined}
        nextEpisodeNum={item.nextEpisodeNum as number | null | undefined}
        nextEpisodeName={item.nextEpisodeName as string | null | undefined}
        nextEpisodeAirDate={item.nextEpisodeAirDate as string | null | undefined}
        nextEpisodeStillPath={item.nextEpisodeStillPath as string | null | undefined}
        remainingCount={getRemainingCount(item)}
        canMark={hasAired(item.nextEpisodeAirDate as string | undefined)}
        onShowPress={() => router.push(`/show/${item.tmdbShowId}`)}
        onCheckPress={() => handleCheck(item)}
        onStatusChange={handleStatusChange}
        onRemove={handleRemove}
      />
    );
  }

  const emptyCopy =
    activeTab === 'watchlist' && allShows.length === 0
      ? {
          title: 'No shows yet',
          subtitle: 'Go to Discover to add shows to your list.',
        }
      : activeTab === 'watchlist'
        ? {
            title: 'Nothing to watch',
            subtitle:
              'Caught-up shows stay on your Profile until a new episode airs.',
          }
        : {
            title: 'Nothing coming up',
            subtitle: 'New episodes with a scheduled date show up here.',
          };

  const watchlistEmpty = sections.length === 0;
  const upcomingEmpty = upcomingSections.length === 0;
  const activeSections = activeTab === 'watchlist' ? sections : upcomingSections;
  const sourceEmpty = activeTab === 'watchlist' ? watchlistEmpty : upcomingEmpty;
  const filteredSections = useMemo(
    () =>
      activeSections
        .filter(
          section =>
            activeTab !== 'watchlist' ||
            bucketFilter === 'all' ||
            section.key === bucketFilter
        )
        .filter(section => section.data.length > 0),
    [activeSections, activeTab, bucketFilter]
  );
  const listEmpty = sourceEmpty;
  const noMatches = !sourceEmpty && filteredSections.length === 0;

  return (
    <TabScreen>
      <View style={styles.topBar}>
        <SegmentTabs
          options={[
            { key: 'watchlist', label: 'To watch' },
            { key: 'upcoming', label: 'Coming up' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
        {queryReady && allShows.length > 0 && activeTab === 'watchlist' ? (
          <TouchableOpacity
            onPress={() => setFiltersOpen(open => !open)}
            style={[styles.filterBtn, (filtersOpen || bucketFilter !== 'all') && styles.filterBtnActive]}
            accessibilityRole="button"
            accessibilityLabel={filtersOpen ? 'Hide filters' : 'Show filters'}
            accessibilityState={{ expanded: filtersOpen, selected: bucketFilter !== 'all' }}
          >
            <Ionicons
              name={filtersOpen ? 'close' : 'funnel-outline'}
              size={18}
              color={filtersOpen || bucketFilter !== 'all' ? '#fff' : theme.muted}
            />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => setIsGrid(g => !g)}
          style={styles.gridToggle}
          accessibilityLabel={isGrid ? 'List view' : 'Grid view'}
        >
          <Text style={styles.gridToggleText}>{isGrid ? '≡' : '⊞'}</Text>
        </TouchableOpacity>
      </View>

      {queryReady && allShows.length > 0 && activeTab === 'watchlist' && filtersOpen ? (
        <FilterChips
          options={[
            { key: 'all', label: 'All' },
            { key: 'watchNext', label: 'Continue' },
            { key: 'stale', label: 'Stale' },
            { key: 'notStarted', label: 'Not started' },
          ]}
          value={bucketFilter}
          onChange={setBucketFilter}
        />
      ) : null}

      {!queryReady ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : listEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📺</Text>
          <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
          <Text style={styles.emptySubtitle}>{emptyCopy.subtitle}</Text>
          {allShows.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => router.push('/discover')}
              accessibilityRole="button"
              accessibilityLabel="Go to Discover"
            >
              <Text style={styles.emptyBtnText}>Discover shows</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : noMatches ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📺</Text>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptySubtitle}>Try a different filter.</Text>
        </View>
      ) : (
        <CollapsibleScrollView contentContainerStyle={styles.listContent}>
          {filteredSections.map(section => (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
                <Text style={styles.sectionCount}>{section.data.length}</Text>
              </View>
              {isGrid ? (
                <View style={styles.gridWrap}>
                  {section.data.map(item => renderShow(item))}
                </View>
              ) : (
                section.data.map(item => renderShow(item))
              )}
            </View>
          ))}
        </CollapsibleScrollView>
      )}

      {undo ? (
        <View style={styles.undoBar}>
          <Text style={styles.undoText} numberOfLines={1}>
            Marked {undo.showName}
          </Text>
          <TouchableOpacity onPress={undoLast} hitSlop={8}>
            <Text style={styles.undoBtn}>Undo</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    minWidth: 0,
  },
  gridToggle: {
    padding: 10,
    flexShrink: 0,
  },
  filterBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.elevated,
    borderWidth: 1,
    borderColor: theme.border,
    flexShrink: 0,
  },
  filterBtnActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  gridToggleText: {
    color: theme.muted,
    fontSize: 22,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: theme.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: theme.accent,
  },
  emptyBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: theme.tabBarClearance,
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
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: theme.tabBarClearance - 8,
    backgroundColor: theme.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  undoText: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
  },
  undoBtn: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
