import { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import db from '@/lib/db';
import MovieRow from '@/components/MovieRow';
import ShowGridCard from '@/components/ShowGridCard';
import { hasAired } from '@/lib/progress';
import { theme } from '@/constants/theme';
import {
  uniqueByTmdbMovieId,
  ALL_COLLECTIONS,
  buildCollectionFilterOptions,
  collectionFilterKey,
} from '@/lib/userMovies';
import { upcomingBucket, UpcomingBucket, sortByAirDate, sortTime } from '@/lib/watchlist';
import { matchesQuery } from '@/components/SearchField';
import FilterToolbar, { FilterToggle } from '@/components/ListFilter';
import SegmentTabs from '@/components/SegmentTabs';
import TabScreen from '@/components/TabScreen';
import { CollapsibleScrollView } from '@/components/TabBarCollapse';

type TabKey = 'watchlist' | 'upcoming' | 'watched';

function releaseTime(movie: { tmdbReleaseDate?: unknown }): number {
  const raw = movie.tmdbReleaseDate as string | undefined;
  if (!raw) return Number.POSITIVE_INFINITY;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

const UPCOMING_SECTION_META: { key: UpcomingBucket; title: string }[] = [
  { key: 'today', title: 'Today' },
  { key: 'thisWeek', title: 'This week' },
  { key: 'nextWeek', title: 'Next week' },
  { key: 'laterThisMonth', title: 'Later this month' },
  { key: 'nextMonth', title: 'Next month' },
  { key: 'later', title: 'Later' },
];

export default function MoviesScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('watchlist');
  const [isGrid, setIsGrid] = useState(false);
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState(ALL_COLLECTIONS);

  const { user } = db.useAuth();
  const { isLoading, data } = db.useQuery(
    user ? { userMovies: { $: { where: { '$user.id': user.id } } } } : null
  );

  const movies = uniqueByTmdbMovieId(data?.userMovies ?? []);
  const queryReady = !user || (!isLoading && data != null);
  const canFilterCollection = activeTab === 'watchlist' || activeTab === 'watched';

  const toWatch = movies.filter(
    m => m.status === 'watching' && hasAired(m.tmdbReleaseDate as string | undefined)
  );
  const upcoming = movies.filter(
    m => m.status === 'watching' && !hasAired(m.tmdbReleaseDate as string | undefined)
  );
  const watched = movies
    .filter(m => m.status === 'finished')
    .sort(
      (a, b) =>
        sortTime(b, new Date((b.watchedAt as string | undefined) ?? 0).getTime() || null) -
        sortTime(a, new Date((a.watchedAt as string | undefined) ?? 0).getTime() || null)
    );

  const collectionSource = useMemo(
    () => (activeTab === 'watched' ? watched : toWatch),
    [activeTab, watched, toWatch]
  );
  const collectionOptions = useMemo(
    () => buildCollectionFilterOptions(canFilterCollection ? collectionSource : []),
    [canFilterCollection, collectionSource]
  );
  const showCollectionFilter = canFilterCollection && collectionOptions.length > 1;

  useEffect(() => {
    if (!showCollectionFilter) {
      if (collectionFilter !== ALL_COLLECTIONS) setCollectionFilter(ALL_COLLECTIONS);
      return;
    }
    if (!collectionOptions.some(o => o.key === collectionFilter)) {
      setCollectionFilter(ALL_COLLECTIONS);
    }
  }, [showCollectionFilter, collectionOptions, collectionFilter]);

  const upcomingSections = useMemo(() => {
    const airOf = (movie: (typeof movies)[0]) =>
      (movie.tmdbReleaseDate as string | undefined) ?? null;
    const buckets: Record<UpcomingBucket, typeof movies> = {
      today: [],
      thisWeek: [],
      nextWeek: [],
      laterThisMonth: [],
      nextMonth: [],
      later: [],
    };
    for (const movie of upcoming) {
      buckets[upcomingBucket(airOf(movie))].push(movie);
    }
    return UPCOMING_SECTION_META.map(({ key, title }) => ({
      key,
      title,
      data: sortByAirDate(buckets[key], airOf),
    })).filter(s => s.data.length > 0);
  }, [upcoming, movies]);

  async function toggleWatched(movie: (typeof movies)[0]) {
    const now = new Date().toISOString();
    if (movie.status === 'finished') {
      await db.transact([
        db.tx.userMovies[movie.id].update({
          status: 'watching',
          lastTouchedAt: now,
        }),
      ]);
      return;
    }
    if (!hasAired(movie.tmdbReleaseDate as string | undefined)) return;
    await db.transact([
      db.tx.userMovies[movie.id].update({
        status: 'finished',
        watchedAt: now,
        lastTouchedAt: now,
      }),
    ]);
  }

  async function handleWatchLater(id: string) {
    await db.transact([db.tx.userMovies[id].update({ status: 'watchLater' })]);
  }

  async function handleRemove(id: string) {
    await db.transact([db.tx.userMovies[id].delete()]);
  }

  function renderMovie(item: (typeof movies)[0]) {
    if (isGrid) {
      return (
        <ShowGridCard
          key={item.id}
          name={item.tmdbMovieName as string}
          posterPath={item.tmdbPosterPath as string | null}
          onPress={() => router.push({ pathname: '/movie/[id]', params: { id: String(item.tmdbMovieId) } })}
        />
      );
    }
    return (
      <MovieRow
        key={item.id}
        id={item.id}
        name={item.tmdbMovieName as string}
        posterPath={item.tmdbPosterPath as string | null}
        releaseDate={item.tmdbReleaseDate as string | undefined}
        runtime={item.runtime as number | undefined}
        canMark={
          item.status === 'finished' ||
          hasAired(item.tmdbReleaseDate as string | undefined)
        }
        checked={item.status === 'finished'}
        onPress={() => router.push({ pathname: '/movie/[id]', params: { id: String(item.tmdbMovieId) } })}
        onCheckPress={() => toggleWatched(item)}
        onWatchLater={handleWatchLater}
        onRemove={handleRemove}
      />
    );
  }

  const emptyCopy =
    activeTab === 'watchlist'
      ? {
          title: movies.length === 0 ? 'No movies yet' : 'Nothing to watch',
          subtitle:
            movies.length === 0
              ? 'Search in Discover and add movies with +.'
              : 'Released movies you still need to watch show up here.',
        }
      : activeTab === 'upcoming'
        ? {
            title: 'Nothing coming up',
            subtitle: 'Unreleased movies with a date show up here.',
          }
        : {
            title: 'No watched movies',
            subtitle: 'Mark a movie as watched to keep it here.',
          };

  const list =
    activeTab === 'watchlist' ? toWatch : activeTab === 'watched' ? watched : [];
  const filteredList = useMemo(() => {
    let rows = list.filter(movie => matchesQuery(movie.tmdbMovieName as string, query));
    if (canFilterCollection && collectionFilter !== ALL_COLLECTIONS) {
      rows = rows.filter(movie => collectionFilterKey(movie) === collectionFilter);
    }
    if (canFilterCollection && collectionFilter !== ALL_COLLECTIONS) {
      rows = [...rows].sort((a, b) => releaseTime(a) - releaseTime(b));
    }
    return rows;
  }, [list, query, canFilterCollection, collectionFilter]);
  const filteredUpcomingSections = useMemo(
    () =>
      upcomingSections
        .map(section => ({
          ...section,
          data: section.data.filter(movie =>
            matchesQuery(movie.tmdbMovieName as string, query)
          ),
        }))
        .filter(section => section.data.length > 0),
    [upcomingSections, query]
  );
  const sourceEmpty =
    activeTab === 'upcoming' ? upcomingSections.length === 0 : list.length === 0;
  const listEmpty = sourceEmpty;
  const noMatches =
    !sourceEmpty &&
    (activeTab === 'upcoming' ? filteredUpcomingSections.length === 0 : filteredList.length === 0);

  return (
    <TabScreen>
      <View style={styles.topBar}>
        <SegmentTabs
          options={[
            { key: 'watchlist', label: 'To watch' },
            { key: 'upcoming', label: 'Coming up' },
            { key: 'watched', label: 'Watched' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
        {queryReady && movies.length > 0 && (canFilterCollection || activeTab === 'upcoming') ? (
          <FilterToggle
            open={filtersOpen}
            active={
              query.trim().length > 0 ||
              (showCollectionFilter && collectionFilter !== ALL_COLLECTIONS)
            }
            onPress={() => setFiltersOpen(open => !open)}
          />
        ) : null}
        <TouchableOpacity
          onPress={() => setIsGrid(g => !g)}
          style={styles.gridToggle}
          accessibilityLabel={isGrid ? 'List view' : 'Grid view'}
        >
          <Text style={styles.gridToggleText}>{isGrid ? '≡' : '⊞'}</Text>
        </TouchableOpacity>
      </View>

      {queryReady && movies.length > 0 && filtersOpen && canFilterCollection ? (
        <FilterToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search by name"
          menus={
            showCollectionFilter
              ? [
                  {
                    value: collectionFilter,
                    onChange: setCollectionFilter,
                    options: collectionOptions,
                    placeholder: 'All collections',
                    searchPlaceholder: 'Search collections',
                  },
                ]
              : []
          }
        />
      ) : queryReady && movies.length > 0 && filtersOpen ? (
        <FilterToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search by name"
        />
      ) : null}

      {!queryReady ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : listEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎬</Text>
          <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
          <Text style={styles.emptySubtitle}>{emptyCopy.subtitle}</Text>
          {movies.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => router.push('/discover')}
              accessibilityRole="button"
              accessibilityLabel="Go to Discover"
            >
              <Text style={styles.emptyBtnText}>Discover movies</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : noMatches ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptySubtitle}>Try a different name.</Text>
        </View>
      ) : activeTab === 'upcoming' ? (
        <CollapsibleScrollView contentContainerStyle={styles.listContent}>
          {filteredUpcomingSections.map(section => (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
                <Text style={styles.sectionCount}>{section.data.length}</Text>
              </View>
              {isGrid ? (
                <View style={styles.gridWrap}>
                  {section.data.map(item => renderMovie(item))}
                </View>
              ) : (
                section.data.map(item => renderMovie(item))
              )}
            </View>
          ))}
        </CollapsibleScrollView>
      ) : (
        <CollapsibleScrollView contentContainerStyle={styles.listContent}>
          {isGrid ? (
            <View style={styles.gridWrap}>{filteredList.map(item => renderMovie(item))}</View>
          ) : (
            filteredList.map(item => renderMovie(item))
          )}
        </CollapsibleScrollView>
      )}
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
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    gap: 10,
  },
});
