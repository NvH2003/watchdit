import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { id as instantId } from '@instantdb/react-native';
import db from '@/lib/db';
import ShowRowTV, { ShowStatus } from '@/components/ShowRowTV';
import ShowGridCard from '@/components/ShowGridCard';
import { tmdb } from '@/lib/tmdb';

type TabKey = 'watchlist' | 'upcoming';

export default function EpisodesScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('watchlist');
  const [isGrid, setIsGrid] = useState(false);

  const { user } = db.useAuth();
  const { isLoading, data } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );

  const allShows = data?.userShows ?? [];
  const watchedEps = data?.watchedEpisodes ?? [];

  const watchlistShows = allShows.filter(s =>
    ['watching', 'watchLater'].includes(s.status as string)
  );
  const upcomingShows = allShows.filter(s =>
    s.status === 'watching'
  );

  const displayShows = activeTab === 'watchlist' ? watchlistShows : upcomingShows;

  function getWatchedCount(showId: number) {
    return watchedEps.filter(e => e.tmdbShowId === showId).length;
  }

  function getRemainingCount(show: (typeof allShows)[0]) {
    const total = (show.totalEpisodes as number | undefined) ?? 0;
    const watched = getWatchedCount(show.tmdbShowId as number);
    return Math.max(0, total - watched);
  }

  async function handleStatusChange(showId: string, status: ShowStatus) {
    await db.transact([db.tx.userShows[showId].update({ status })]);
  }

  async function handleRemove(showId: string) {
    await db.transact([db.tx.userShows[showId].delete()]);
  }

  async function handleCheck(show: (typeof allShows)[0]) {
    if (!user) return;
    const sId = show.id;
    const tmdbId = show.tmdbShowId as number;
    const curSeason = (show.nextSeasonNum as number | undefined) ?? 1;
    const curEpisode = (show.nextEpisodeNum as number | undefined) ?? 1;

    // Mark current episode as watched
    const alreadyWatched = watchedEps.find(
      e => e.tmdbShowId === tmdbId && e.seasonNumber === curSeason && e.episodeNumber === curEpisode
    );

    const transactions: ReturnType<typeof db.tx.watchedEpisodes[string]['update']>[] = [];

    if (!alreadyWatched) {
      transactions.push(
        db.tx.watchedEpisodes[instantId()].update({
          tmdbShowId: tmdbId,
          seasonNumber: curSeason,
          episodeNumber: curEpisode,
          watchedAt: new Date().toISOString(),
        }).link({ $user: user.id })
      );
    }

    // Advance to next episode
    try {
      const season = await tmdb.getSeason(tmdbId, curSeason);
      const eps = season.episodes ?? [];
      const currentIdx = eps.findIndex(e => e.episode_number === curEpisode);
      let nextSeason = curSeason;
      let nextEpisode = curEpisode;
      let nextName = show.nextEpisodeName as string | undefined ?? '';

      if (currentIdx >= 0 && currentIdx < eps.length - 1) {
        const next = eps[currentIdx + 1];
        nextSeason = next.season_number;
        nextEpisode = next.episode_number;
        nextName = next.name;
      } else {
        // Try next season
        const showDetails = await tmdb.getShow(tmdbId);
        const totalSeasons = showDetails.number_of_seasons ?? 0;
        if (curSeason < totalSeasons) {
          const nextSeasonData = await tmdb.getSeason(tmdbId, curSeason + 1);
          const firstEp = nextSeasonData.episodes?.[0];
          if (firstEp) {
            nextSeason = firstEp.season_number;
            nextEpisode = firstEp.episode_number;
            nextName = firstEp.name;
          }
        } else {
          // All done
          await db.transact([
            ...transactions,
            db.tx.userShows[sId].update({ status: 'upToDate' }),
          ]);
          return;
        }
      }

      await db.transact([
        ...transactions,
        db.tx.userShows[sId].update({
          nextSeasonNum: nextSeason,
          nextEpisodeNum: nextEpisode,
          nextEpisodeName: nextName,
        }),
      ]);
    } catch (e) {
      console.warn('Failed to advance episode', e);
      if (transactions.length > 0) {
        await db.transact(transactions);
      }
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'watchlist' && styles.tabActive]}
            onPress={() => setActiveTab('watchlist')}
          >
            <Text style={[styles.tabText, activeTab === 'watchlist' && styles.tabTextActive]}>
              WATCH LIST
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'upcoming' && styles.tabActive]}
            onPress={() => setActiveTab('upcoming')}
          >
            <Text style={[styles.tabText, activeTab === 'upcoming' && styles.tabTextActive]}>
              UPCOMING
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => setIsGrid(g => !g)}
          style={styles.gridToggle}
          accessibilityLabel={isGrid ? 'List view' : 'Grid view'}
        >
          <Text style={styles.gridToggleText}>{isGrid ? '≡' : '⊞'}</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#e94560" size="large" />
        </View>
      ) : displayShows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📺</Text>
          <Text style={styles.emptyTitle}>
            {activeTab === 'watchlist' ? 'No shows yet' : 'Nothing upcoming'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {activeTab === 'watchlist'
              ? 'Go to Discover to add shows to your list.'
              : 'Add shows you are watching to see them here.'}
          </Text>
        </View>
      ) : isGrid ? (
        <FlatList
          data={displayShows}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => (
            <ShowGridCard
              name={item.tmdbShowName as string}
              posterPath={item.tmdbPosterPath as string | null}
              unwatchedCount={getRemainingCount(item)}
              onPress={() => router.push(`/show/${item.tmdbShowId}`)}
            />
          )}
        />
      ) : (
        <FlatList
          data={displayShows}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ShowRowTV
              id={item.id}
              name={item.tmdbShowName as string}
              posterPath={item.tmdbPosterPath as string | null}
              status={(item.status as ShowStatus) ?? 'watching'}
              nextSeasonNum={item.nextSeasonNum as number | null | undefined}
              nextEpisodeNum={item.nextEpisodeNum as number | null | undefined}
              nextEpisodeName={item.nextEpisodeName as string | null | undefined}
              remainingCount={getRemainingCount(item)}
              onShowPress={() => router.push(`/show/${item.tmdbShowId}`)}
              onCheckPress={() => handleCheck(item)}
              onStatusChange={handleStatusChange}
              onRemove={handleRemove}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0f14',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1e2030',
    paddingRight: 8,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#e94560',
  },
  tabText: {
    color: '#8892a4',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  tabTextActive: {
    color: '#fff',
  },
  gridToggle: {
    padding: 10,
  },
  gridToggleText: {
    color: '#8892a4',
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
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#8892a4',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  gridRow: {
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 12,
  },
  gridContent: {
    paddingTop: 16,
    paddingBottom: 32,
  },
});
