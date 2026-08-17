import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  ScrollView,
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
  const [popular, setPopular] = useState<TmdbShow[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [addingId, setAddingId] = useState<number | null>(null);

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
        setLoadingData(true);
        try {
          const [trendRes, popRes] = await Promise.all([
            tmdb.getTrending(),
            tmdb.getPopular(),
          ]);
          if (!active) return;
          setTrending(trendRes.results.slice(0, 20));
          setPopular(popRes.results.slice(0, 20));
        } catch (e) {
          console.warn('Failed to load discover data', e);
        } finally {
          if (active) setLoadingData(false);
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
    if (!user || addedShowIds.has(show.id) || addingId === show.id) return;
    setAddingId(show.id);
    try {
      const details = await tmdb.getShow(show.id);
      const firstSeason = details.number_of_seasons && details.number_of_seasons > 0
        ? await tmdb.getSeason(show.id, 1)
        : null;
      const firstEp = firstSeason?.episodes?.[0] ?? null;

      await db.transact([
        db.tx.userShows[instantId()].update({
          tmdbShowId: show.id,
          tmdbShowName: show.name,
          tmdbPosterPath: show.poster_path ?? '',
          status: 'watching',
          addedAt: new Date().toISOString(),
          totalEpisodes: details.number_of_episodes ?? 0,
          nextSeasonNum: firstEp ? firstEp.season_number : 1,
          nextEpisodeNum: firstEp ? firstEp.episode_number : 1,
          nextEpisodeName: firstEp?.name ?? '',
        }).link({ $user: user.id }),
      ]);
    } catch (e) {
      console.warn('Failed to add show', e);
    } finally {
      setAddingId(null);
    }
  }

  const isSearching = query.trim().length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Discover</Text>
      </View>

      <View style={styles.searchWrapper}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search shows and movies"
          placeholderTextColor="#555"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {isSearching ? (
        searching ? (
          <ActivityIndicator color="#e94560" style={styles.loader} />
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={item => String(item.id)}
            renderItem={({ item }) => (
              <SearchResultRow
                item={item}
                added={addedShowIds.has(item.id)}
                adding={addingId === item.id}
                onPress={() => router.push(`/show/${item.id}`)}
                onAdd={() => addShow(item)}
              />
            )}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyText}>No results for "{query}"</Text>
              </View>
            }
          />
        )
      ) : loadingData ? (
        <ActivityIndicator color="#e94560" style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <HorizontalSection
            title="Shows for you"
            data={popular}
            addedIds={addedShowIds}
            addingId={addingId}
            onPress={id => router.push(`/show/${id}`)}
            onAdd={show => addShow(show)}
          />
          <HorizontalSection
            title="Trending shows"
            data={trending}
            addedIds={addedShowIds}
            addingId={addingId}
            onPress={id => router.push(`/show/${id}`)}
            onAdd={show => addShow(show)}
          />
          <TouchableOpacity style={styles.browseAll} onPress={() => setQuery(' ')}>
            <Text style={styles.browseAllText}>BROWSE ALL SHOWS</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function HorizontalSection({
  title,
  data,
  addedIds,
  addingId,
  onPress,
  onAdd,
}: {
  title: string;
  data: TmdbShow[];
  addedIds: Set<number>;
  addingId: number | null;
  onPress: (id: number) => void;
  onAdd: (show: TmdbShow) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionMore}>See all ›</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
        {data.map(show => {
          const poster = posterUrl(show.poster_path, 'w342');
          const added = addedIds.has(show.id);
          const adding = addingId === show.id;
          return (
            <TouchableOpacity
              key={show.id}
              style={styles.posterCard}
              onPress={() => onPress(show.id)}
              activeOpacity={0.8}
            >
              {poster ? (
                <Image source={{ uri: poster }} style={styles.hPoster} />
              ) : (
                <View style={[styles.hPoster, styles.hPosterPlaceholder]}>
                  <Text style={styles.hPosterEmoji}>📺</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.addOverlay, added && styles.addOverlayDone]}
                onPress={() => onAdd(show)}
                disabled={added || adding}
              >
                {adding ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.addOverlayText}>{added ? '✓' : '+'}</Text>
                )}
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SearchResultRow({
  item,
  added,
  adding,
  onPress,
  onAdd,
}: {
  item: TmdbShow;
  added: boolean;
  adding: boolean;
  onPress: () => void;
  onAdd: () => void;
}) {
  const poster = posterUrl(item.poster_path, 'w185');
  return (
    <TouchableOpacity style={styles.resultRow} onPress={onPress} activeOpacity={0.8}>
      {poster ? (
        <Image source={{ uri: poster }} style={styles.resultPoster} />
      ) : (
        <View style={[styles.resultPoster, styles.hPosterPlaceholder]}>
          <Text style={styles.hPosterEmoji}>📺</Text>
        </View>
      )}
      <View style={styles.resultInfo}>
        <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
        {item.first_air_date ? (
          <Text style={styles.resultYear}>{item.first_air_date.slice(0, 4)}</Text>
        ) : null}
        <Text style={styles.resultOverview} numberOfLines={2}>{item.overview}</Text>
      </View>
      <TouchableOpacity
        style={[styles.addBtn, added && styles.addBtnDone]}
        onPress={onAdd}
        disabled={added || adding}
      >
        {adding ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.addBtnText}>{added ? '✓' : '+'}</Text>
        )}
      </TouchableOpacity>
    </TouchableOpacity>
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
    borderBottomColor: '#1e2030',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 14,
    backgroundColor: '#1e2030',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#252840',
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
  },
  clearText: {
    color: '#8892a4',
    fontSize: 16,
    paddingLeft: 8,
  },
  loader: {
    marginTop: 48,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  sectionMore: {
    color: '#8892a4',
    fontSize: 13,
  },
  hScroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  posterCard: {
    width: 110,
    position: 'relative',
  },
  hPoster: {
    width: 110,
    height: 160,
    borderRadius: 8,
    backgroundColor: '#252840',
  },
  hPosterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  hPosterEmoji: {
    fontSize: 28,
  },
  addOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e94560',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addOverlayDone: {
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  addOverlayText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  browseAll: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  browseAllText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
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
    borderBottomColor: '#1e2030',
  },
  resultPoster: {
    width: 52,
    height: 78,
    borderRadius: 6,
    marginRight: 14,
    backgroundColor: '#252840',
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  resultYear: {
    color: '#e94560',
    fontSize: 12,
    marginBottom: 4,
  },
  resultOverview: {
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
  addBtnDone: {
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
