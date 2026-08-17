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
import db from '@/lib/db';
import ShowRowSwipeable, { ShowStatus } from '@/components/ShowRowSwipeable';
import ShowGridCard from '@/components/ShowGridCard';

export default function EpisodesScreen() {
  const router = useRouter();
  const [isGrid, setIsGrid] = useState(false);

  const { user } = db.useAuth();
  const { isLoading, data } = db.useQuery(
    user
      ? {
          userShows: {
            $: { where: { '$user.id': user.id } },
          },
        }
      : null
  );

  const shows = data?.userShows ?? [];

  async function handleStatusChange(showId: string, status: ShowStatus) {
    await db.transact([db.tx.userShows[showId].update({ status })]);
  }

  async function handleRemove(showId: string) {
    await db.transact([db.tx.userShows[showId].delete()]);
  }

  function navigateToShow(tmdbShowId: number) {
    router.push(`/show/${tmdbShowId}`);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Episodes</Text>
        <TouchableOpacity
          onPress={() => setIsGrid(g => !g)}
          style={styles.toggleBtn}
          accessibilityLabel={isGrid ? 'Switch to list view' : 'Switch to grid view'}
        >
          <Text style={styles.toggleText}>{isGrid ? '≡' : '⊞'}</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#e94560" size="large" />
        </View>
      ) : shows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📺</Text>
          <Text style={styles.emptyTitle}>No shows yet</Text>
          <Text style={styles.emptySubtitle}>
            Go to Discover to find and add shows to your list.
          </Text>
        </View>
      ) : isGrid ? (
        <FlatList
          data={shows}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => (
            <ShowGridCard
              name={item.tmdbShowName as string}
              posterPath={item.tmdbPosterPath as string | null}
              onPress={() => navigateToShow(item.tmdbShowId as number)}
            />
          )}
        />
      ) : (
        <FlatList
          data={shows}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ShowRowSwipeable
              id={item.id}
              name={item.tmdbShowName as string}
              posterPath={item.tmdbPosterPath as string | null}
              status={(item.status as ShowStatus) ?? 'watching'}
              onPress={() => navigateToShow(item.tmdbShowId as number)}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1f2e',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  toggleBtn: {
    padding: 8,
  },
  toggleText: {
    color: '#e94560',
    fontSize: 24,
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
