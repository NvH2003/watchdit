import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import db from '@/lib/db';
import { theme } from '@/constants/theme';
import { uniqueByTmdbShowId } from '@/lib/userShows';
import { uniqueByTmdbMovieId } from '@/lib/userMovies';
import { posterUrl } from '@/lib/tmdb';
import {
  buildWatchHistory,
  countValidWatches,
  episodeCode,
  formatWatchTime,
} from '@/lib/history';
import { matchesQuery } from '@/components/SearchField';
import FilterToolbar from '@/components/ListFilter';
import InstallApp from '@/components/InstallApp';
import { CollapsibleScrollView } from '@/components/TabBarCollapse';

const HISTORY_PAGE = 40;

type ShowStatus = 'watching' | 'watchLater' | 'finished' | 'upToDate';

const STATUS_CONFIG: { key: ShowStatus; label: string; color: string }[] = [
  { key: 'watching', label: 'Watching', color: theme.accent },
  { key: 'upToDate', label: 'Up to Date', color: theme.sky },
  { key: 'watchLater', label: 'Watch Later', color: theme.gold },
  { key: 'finished', label: 'Finished', color: theme.check },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = db.useAuth();
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [query, setQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<'all' | 'tv' | 'movie'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ShowStatus>('all');

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
  const watchedMovies = movies.filter(m => m.status === 'finished').length;
  const watchedEpisodes = data?.watchedEpisodes ?? [];
  const historyTotal = countValidWatches(watchedEpisodes);
  const { days: historyDays, matchedTotal: historyMatchCount } = useMemo(
    () => buildWatchHistory(watchedEpisodes, shows, historyLimit, query),
    [watchedEpisodes, shows, historyLimit, query]
  );

  const grouped = Object.fromEntries(
    STATUS_CONFIG.map(s => [
      s.key,
      shows.filter(show => show.status === s.key),
    ])
  ) as Record<ShowStatus, typeof shows>;

  const showSeries = mediaFilter !== 'movie';
  const showMovies = mediaFilter !== 'tv';

  const filteredMovies = movies.filter(movie => {
    if (!matchesQuery(movie.tmdbMovieName as string, query)) return false;
    if (statusFilter === 'all') return true;
    if (statusFilter === 'upToDate') return false;
    return movie.status === statusFilter;
  });

  const filteredGrouped = Object.fromEntries(
    STATUS_CONFIG.map(s => [
      s.key,
      (grouped[s.key] ?? []).filter(show => {
        if (statusFilter !== 'all' && s.key !== statusFilter) return false;
        return matchesQuery(show.tmdbShowName as string, query);
      }),
    ])
  ) as Record<ShowStatus, typeof shows>;

  const hasLibraryMatches =
    (showMovies && filteredMovies.length > 0) ||
    (showSeries && STATUS_CONFIG.some(s => (filteredGrouped[s.key] ?? []).length > 0));
  const filtersActive = Boolean(query.trim()) || mediaFilter !== 'all' || statusFilter !== 'all';
  const historyCountsForEmpty = showSeries && statusFilter === 'all' && historyMatchCount > 0;
  const nothingMatches = filtersActive && !hasLibraryMatches && !historyCountsForEmpty;
  const showHistorySection = showSeries && statusFilter === 'all' && !nothingMatches;

  return (
    <TabScreen>
      <CollapsibleScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <Text style={styles.email} numberOfLines={1}>
            {user?.email}
          </Text>
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={() => db.auth.signOut()}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
          <InstallApp />
        </View>

        <View style={styles.statsRow}>
          <StatBox label="Shows" value={shows.length} />
          <StatBox label="Movies" value={movies.length} />
          <StatBox label="Episodes Watched" value={watchedEpisodes.length} />
        </View>

        <View style={styles.statusGrid}>
          {STATUS_CONFIG.map(({ key, label, color }) => {
            const count = grouped[key]?.length ?? 0;
            const active = statusFilter === key;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.statusCard,
                  { borderLeftColor: color },
                  active && styles.statusCardActive,
                ]}
                onPress={() => setStatusFilter(current => (current === key ? 'all' : key))}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter ${label}`}
              >
                <Text style={[styles.statusCount, { color }]}>{count}</Text>
                <Text style={styles.statusLabel}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <FilterToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search by name"
          menus={[
            {
              value: mediaFilter,
              onChange: key => setMediaFilter(key as 'all' | 'tv' | 'movie'),
              options: [
                { key: 'all', label: 'All' },
                { key: 'tv', label: 'Series' },
                { key: 'movie', label: 'Movies' },
              ],
            },
            {
              value: statusFilter,
              onChange: key => setStatusFilter(key as 'all' | ShowStatus),
              options: [
                { key: 'all', label: 'Any status' },
                { key: 'watching', label: 'Watching' },
                { key: 'upToDate', label: 'Up to date' },
                { key: 'watchLater', label: 'Later' },
                { key: 'finished', label: 'Finished' },
              ],
            },
          ]}
        />

        {nothingMatches ? (
          <View style={styles.filterEmpty}>
            <Text style={styles.filterEmptyTitle}>No matches</Text>
            <Text style={styles.filterEmptySub}>Try a different name or filter.</Text>
          </View>
        ) : null}

        {showHistorySection ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionDot, { backgroundColor: theme.accent }]} />
            <Text style={styles.sectionTitle}>Watch history</Text>
            {historyTotal > 0 ? (
              <Text style={styles.sectionCount}>
                {query.trim() ? `${historyMatchCount}` : historyTotal}
              </Text>
            ) : null}
          </View>
          {historyTotal === 0 ? (
            <Text style={styles.historyEmpty}>No episodes watched yet</Text>
          ) : historyMatchCount === 0 ? (
            <Text style={styles.historyEmpty}>No history matches this filter</Text>
          ) : (
            historyDays.map(day => (
              <View key={day.key} style={styles.historyDay}>
                <Text style={styles.historyDayLabel}>{day.label}</Text>
                {day.entries.map(entry => {
                  const poster = posterUrl(entry.posterPath, 'w185');
                  return (
                    <TouchableOpacity
                      key={entry.id}
                      style={styles.historyRow}
                      onPress={() => router.push(`/show/${entry.tmdbShowId}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Watched ${episodeCode(entry.seasonNumber, entry.episodeNumber)} of ${entry.showName}`}
                    >
                      {poster ? (
                        <Image source={{ uri: poster }} style={styles.historyPoster} />
                      ) : (
                        <View style={[styles.historyPoster, styles.historyPosterFallback]}>
                          <Text style={styles.historyPosterFallbackText}>TV</Text>
                        </View>
                      )}
                      <View style={styles.historyInfo}>
                        <Text style={styles.historyShow} numberOfLines={1}>
                          {entry.showName}
                        </Text>
                        <Text style={styles.historyEp}>
                          {episodeCode(entry.seasonNumber, entry.episodeNumber)}
                        </Text>
                      </View>
                      <Text style={styles.historyTime}>{formatWatchTime(entry.watchedAt)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))
          )}
          {historyMatchCount > historyLimit ? (
            <TouchableOpacity
              style={styles.historyMore}
              onPress={() => setHistoryLimit(n => n + HISTORY_PAGE)}
              accessibilityRole="button"
              accessibilityLabel="Show more watch history"
            >
              <Text style={styles.historyMoreText}>Show more</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        ) : null}

        <TouchableOpacity
          style={styles.importBtn}
          onPress={() => router.push('/import' as never)}
        >
          <Text style={styles.importBtnIcon}>📥</Text>
          <View style={styles.importBtnText}>
            <Text style={styles.importBtnTitle}>Import from TV Time</Text>
            <Text style={styles.importBtnSub}>
              Pick 4 files from your TV Time GDPR folder
            </Text>
          </View>
          <Text style={styles.importBtnArrow}>›</Text>
        </TouchableOpacity>

        {showMovies && filteredMovies.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionDot, { backgroundColor: theme.gold }]} />
              <Text style={styles.sectionTitle}>Movies</Text>
              <Text style={styles.sectionCount}>{filteredMovies.length}</Text>
            </View>
            {filteredMovies.map(movie => (
              <TouchableOpacity
                key={movie.id}
                style={styles.showItem}
                onPress={() => router.push({ pathname: '/movie/[id]', params: { id: String(movie.tmdbMovieId) } })}
              >
                <Text style={styles.showName} numberOfLines={1}>
                  {movie.tmdbMovieName as string}
                </Text>
                <Text style={styles.movieStatusHint}>
                  {movie.status === 'finished'
                    ? 'Watched'
                    : movie.status === 'watchLater'
                      ? 'Later'
                      : 'To watch'}
                </Text>
                <Text style={styles.showChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {showSeries
          ? STATUS_CONFIG.map(({ key, label, color }) => {
          const list = filteredGrouped[key] ?? [];
          if (list.length === 0) return null;
          return (
            <View key={key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: color }]} />
                <Text style={styles.sectionTitle}>
                  {label}
                </Text>
                <Text style={styles.sectionCount}>{list.length}</Text>
              </View>
              {list.map(show => (
                <TouchableOpacity
                  key={show.id}
                  style={styles.showItem}
                  onPress={() => router.push(`/show/${show.tmdbShowId}`)}
                >
                  <Text style={styles.showName} numberOfLines={1}>
                    {show.tmdbShowName as string}
                  </Text>
                  <Text style={styles.showChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })
          : null}
      </CollapsibleScrollView>
    </TabScreen>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: theme.tabBarClearance + 16,
  },
  header: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 28,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarText: {
    color: theme.text,
    fontSize: 34,
    fontWeight: '700',
  },
  email: {
    color: theme.text,
    fontSize: 16,
    marginBottom: 18,
    maxWidth: '80%',
  },
  signOutBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  signOutText: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    color: theme.text,
    fontSize: 30,
    fontWeight: '700',
  },
  statLabel: {
    color: theme.muted,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  statusCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: theme.elevated,
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
  },
  statusCount: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 2,
  },
  statusLabel: {
    color: theme.muted,
    fontSize: 12,
  },
  statusCardActive: {
    backgroundColor: '#2e1f1c',
  },
  filterEmpty: {
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
  filterEmptyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  filterEmptySub: {
    color: theme.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  sectionTitle: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    flex: 1,
  },
  sectionCount: {
    color: theme.muted,
    fontSize: 12,
  },
  historyEmpty: {
    color: theme.muted,
    fontSize: 14,
    paddingVertical: 8,
  },
  historyDay: {
    marginBottom: 16,
  },
  historyDayLabel: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
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
    fontSize: 10,
    fontWeight: '700',
  },
  historyInfo: {
    flex: 1,
    gap: 2,
  },
  historyShow: {
    color: theme.text,
    fontSize: 14,
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
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  historyMoreText: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  showItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  showName: {
    color: theme.text,
    fontSize: 15,
    flex: 1,
  },
  movieStatusHint: {
    color: theme.gold,
    fontSize: 12,
    marginRight: 8,
  },
  showChevron: {
    color: theme.muted,
    fontSize: 20,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 20,
    padding: 16,
    backgroundColor: theme.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  importBtnIcon: {
    fontSize: 24,
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
    marginTop: 2,
  },
  importBtnArrow: {
    color: theme.muted,
    fontSize: 20,
  },
});
