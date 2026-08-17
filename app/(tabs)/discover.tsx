import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  SafeAreaView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { id as instantId } from '@instantdb/react-native';
import { tmdb, posterUrl, TmdbShow } from '@/lib/tmdb';
import db from '@/lib/db';

export default function DiscoverScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TmdbShow[]>([]);
  const [trending, setTrending] = useState<TmdbShow[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingTrending, setLoadingTrending] = useState(true);

  const { user } = db.useAuth();
  const { data } = db.useQuery(
    user
      ? { userShows: { $: { where: { '$user.id': user.id } } } }
      : null
  );
  const addedShowIds = new Set(
    (data?.userShows ?? []).map(s => s.tmdbShowId as number)
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        setLoadingTrending(true);
        try {
          const res = await tmdb.getTrending();
          if (active) setTrending(res.results.slice(0, 24));
        } catch (e) {
          console.warn('Failed to load trending', e);
        } finally {
          if (active) setLoadingTrending(false);
        }
      }
      load();
      return () => { active = false; };
    }, [])
  );

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await tmdb.searchShows(query.trim());
        setSearchResults(res.results);
      } catch (e) {
        console.warn('Search failed', e);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  async function addShow(show: TmdbShow) {
    if (!user || addedShowIds.has(show.id)) return;
    await db.transact([
      db.tx.userShows[instantId()].update({
        tmdbShowId: show.id,
        tmdbShowName: show.name,
        tmdbPosterPath: show.poster_path ?? '',
        status: 'watching',
        addedAt: new Date().toISOString(),
      }).link({ $user: user.id }),
    ]);
  }

  const displayList = query.trim() ? searchResults : trending;
  const isLoading = query.trim() ? searching : loadingTrending;

  function renderItem({ item }: { item: TmdbShow }) {
    const poster = posterUrl(item.poster_path, 'w185');
    const added = addedShowIds.has(item.id);

    return (
      <TouchableOpacity
        style={styles.resultRow}
        onPress={() => router.push(`/show/${item.id}`)}
        activeOpacity={0.8}
      >
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Text style={styles.posterEmoji}>📺</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.showName} numberOfLines={1}>
            {item.name}
          </Text>
          {item.first_air_date ? (
            <Text style={styles.year}>{item.first_air_date.slice(0, 4)}</Text>
          ) : null}
          <Text style={styles.overview} numberOfLines={2}>
            {item.overview}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.addBtn, added && styles.addedBtn]}
          onPress={() => addShow(item)}
          disabled={added}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.addBtnText}>{added ? '✓' : '+'}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Discover</Text>
      </View>

      <View style={styles.searchWrapper}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search shows..."
          placeholderTextColor="#555"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {query ? (
          <TouchableOpacity
            onPress={() => setQuery('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {!query.trim() && (
        <Text style={styles.sectionLabel}>Trending This Week</Text>
      )}

      {isLoading ? (
        <ActivityIndicator color="#e94560" style={styles.loader} />
      ) : (
        <FlatList
          data={displayList}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            query.trim() ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>No results for "{query}"</Text>
              </View>
            ) : null
          }
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
  headerRow: {
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
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    marginBottom: 8,
    backgroundColor: '#1c1f2e',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#252840',
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  clearText: {
    color: '#8892a4',
    fontSize: 16,
    paddingLeft: 8,
  },
  sectionLabel: {
    color: '#8892a4',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  loader: {
    marginTop: 48,
  },
  listContent: {
    paddingBottom: 32,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1f2e',
  },
  poster: {
    width: 52,
    height: 78,
    borderRadius: 6,
    marginRight: 14,
    backgroundColor: '#252840',
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterEmoji: {
    fontSize: 22,
  },
  info: {
    flex: 1,
  },
  showName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  year: {
    color: '#e94560',
    fontSize: 12,
    marginBottom: 4,
  },
  overview: {
    color: '#8892a4',
    fontSize: 12,
    lineHeight: 16,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e94560',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  addedBtn: {
    backgroundColor: '#252840',
  },
  addBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  center: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#8892a4',
    fontSize: 14,
  },
});
