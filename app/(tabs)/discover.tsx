import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { tmdb, posterUrl, TmdbShow, TmdbMovie, SearchHit, showToSearchHit, movieToSearchHit } from '@/lib/tmdb';
import db from '@/lib/db';
import { theme } from '@/constants/theme';
import { hasAired, findProgressFromTmdb, progressUpdates } from '@/lib/progress';
import { averageEpisodeRuntime } from '@/lib/stats';
import { createUserShowTx, uniqueByTmdbShowId } from '@/lib/userShows';
import { createUserMovieTx, uniqueByTmdbMovieId } from '@/lib/userMovies';
import FilterToolbar from '@/components/ListFilter';
import TabScreen from '@/components/TabScreen';
import { CollapsibleScrollView } from '@/components/TabBarCollapse';
import EpisodeCheck from '@/components/EpisodeCheck';
import { Ionicons } from '@expo/vector-icons';

type ListEntry = { id: string; status: string; tmdbReleaseDate?: string };
type ActionState = 'add' | 'adding' | 'listed' | 'watched' | 'upcoming';

function actionState(
  kind: 'tv' | 'movie',
  entry: ListEntry | undefined,
  airDate: string | undefined,
  adding: boolean
): ActionState {
  if (adding) return 'adding';
  if (!entry) return 'add';
  if (entry.status === 'finished') return 'watched';
  if (kind === 'movie' && !hasAired(airDate ?? entry.tmdbReleaseDate)) return 'upcoming';
  return 'listed';
}

export default function DiscoverScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [showHits, setShowHits] = useState<SearchHit[]>([]);
  const [movieHits, setMovieHits] = useState<SearchHit[]>([]);
  const [trending, setTrending] = useState<TmdbShow[]>([]);
  const [popular, setPopular] = useState<TmdbShow[]>([]);
  const [trendingMovies, setTrendingMovies] = useState<TmdbMovie[]>([]);
  const [popularMovies, setPopularMovies] = useState<TmdbMovie[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'tv' | 'movie'>('all');

  const { user } = db.useAuth();
  const { data } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          userMovies: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );
  const showsByTmdb = new Map<number, ListEntry>();
  for (const show of uniqueByTmdbShowId(data?.userShows ?? [])) {
    showsByTmdb.set(show.tmdbShowId as number, {
      id: show.id,
      status: (show.status as string) ?? 'watching',
    });
  }
  const moviesByTmdb = new Map<number, ListEntry>();
  for (const movie of uniqueByTmdbMovieId(data?.userMovies ?? [])) {
    moviesByTmdb.set(movie.tmdbMovieId as number, {
      id: movie.id,
      status: (movie.status as string) ?? 'watching',
      tmdbReleaseDate: movie.tmdbReleaseDate as string | undefined,
    });
  }
  const pendingAdds = useRef(new Set<string>());

  useEffect(() => {
    for (const key of [...pendingAdds.current]) {
      const [kind, rawId] = key.split(':');
      const n = Number(rawId);
      if (kind === 'tv' && showsByTmdb.has(n)) {
        pendingAdds.current.delete(key);
        setPendingKeys(keys => keys.filter(k => k !== key));
      }
      if (kind === 'movie' && moviesByTmdb.has(n)) {
        pendingAdds.current.delete(key);
        setPendingKeys(keys => keys.filter(k => k !== key));
      }
    }
  }, [data?.userShows, data?.userMovies]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        setLoadingData(true);
        try {
          const [trendRes, popRes, trendMovies, popMovies] = await Promise.all([
            tmdb.getTrending(),
            tmdb.getPopular(),
            tmdb.getTrendingMovies(),
            tmdb.getPopularMovies(),
          ]);
          if (!active) return;
          setTrending(trendRes.results.slice(0, 20));
          setPopular(popRes.results.slice(0, 20));
          setTrendingMovies(trendMovies.results.slice(0, 20));
          setPopularMovies(popMovies.results.slice(0, 20));
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
      setShowHits([]);
      setMovieHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const q = query.trim();
        const wantShows = mediaFilter !== 'movie';
        const wantMovies = mediaFilter !== 'tv';
        const [shows, movies] = await Promise.all([
          wantShows ? tmdb.searchShows(q) : Promise.resolve({ results: [] as TmdbShow[] }),
          wantMovies ? tmdb.searchMovies(q) : Promise.resolve({ results: [] as TmdbMovie[] }),
        ]);
        if (cancelled) return;
        setShowHits(shows.results.map(showToSearchHit));
        setMovieHits(movies.results.map(movieToSearchHit));
      } catch (e) {
        if (!cancelled) console.warn('Search failed', e);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mediaFilter]);

  async function addShow(show: TmdbShow) {
    if (!user) return;
    const key = `tv:${show.id}`;
    if (showsByTmdb.has(show.id) || pendingAdds.current.has(key)) {
      return;
    }
    pendingAdds.current.add(key);
    setPendingKeys(keys => (keys.includes(key) ? keys : [...keys, key]));

    const now = new Date().toISOString();
    const provisionalAir = show.first_air_date || '';
    // Write immediately so To watch / Coming up update without waiting on TMDB.
    const { entityId, tx } = createUserShowTx(user.id, {
      tmdbShowId: show.id,
      tmdbShowName: show.name,
      tmdbPosterPath: show.poster_path ?? '',
      status: hasAired(provisionalAir) ? 'watching' : 'upToDate',
      addedAt: now,
      lastTouchedAt: now,
      nextSeasonNum: 1,
      nextEpisodeNum: 1,
      nextEpisodeName: '',
      nextEpisodeAirDate: provisionalAir,
      nextEpisodeStillPath: '',
    });

    try {
      await db.transact([tx]);
    } catch (e) {
      pendingAdds.current.delete(key);
      setPendingKeys(keys => keys.filter(k => k !== key));
      console.warn('Failed to add show', e);
      return;
    }

    try {
      const details = await tmdb.getShow(show.id);
      const lang = details.original_language || undefined;
      const progress = await findProgressFromTmdb(show.id, new Set(), 1);
      const episodeRuntime = averageEpisodeRuntime(details.episode_run_time);
      await db.transact([
        db.tx.userShows[entityId].update({
          ...progressUpdates(progress),
          tmdbShowName: details.name || show.name,
          tmdbPosterPath: details.poster_path ?? show.poster_path ?? '',
          tmdbOriginalLanguage: lang ?? '',
          totalEpisodes: progress.totalEpisodes ?? details.number_of_episodes ?? 0,
          ...(episodeRuntime != null ? { episodeRuntime } : {}),
        }),
      ]);
    } catch (e) {
      console.warn('Failed to enrich added show', e);
    }
  }

  async function addMovie(movie: TmdbMovie) {
    if (!user) return;
    const key = `movie:${movie.id}`;
    if (moviesByTmdb.has(movie.id) || pendingAdds.current.has(key)) {
      return;
    }
    pendingAdds.current.add(key);
    setPendingKeys(keys => (keys.includes(key) ? keys : [...keys, key]));

    const now = new Date().toISOString();
    const provisionalRelease = movie.release_date || '';
    const { entityId, tx } = createUserMovieTx(user.id, {
      tmdbMovieId: movie.id,
      tmdbMovieName: movie.title,
      tmdbPosterPath: movie.poster_path ?? '',
      status: 'watching',
      addedAt: now,
      lastTouchedAt: now,
      tmdbReleaseDate: provisionalRelease,
    });

    try {
      await db.transact([tx]);
    } catch (e) {
      pendingAdds.current.delete(key);
      setPendingKeys(keys => keys.filter(k => k !== key));
      console.warn('Failed to add movie', e);
      return;
    }

    try {
      const details = await tmdb.getMovie(movie.id);
      await db.transact([
        db.tx.userMovies[entityId].update({
          tmdbMovieName: details.title || movie.title,
          tmdbPosterPath: details.poster_path ?? movie.poster_path ?? '',
          tmdbReleaseDate: details.release_date || provisionalRelease,
          runtime: details.runtime ?? undefined,
        }),
      ]);
    } catch (e) {
      console.warn('Failed to enrich added movie', e);
    }
  }

  async function toggleMovieWatched(tmdbId: number) {
    const movie = moviesByTmdb.get(tmdbId);
    if (!movie) return;
    const now = new Date().toISOString();
    if (movie.status === 'finished') {
      await db.transact([
        db.tx.userMovies[movie.id].update({ status: 'watching', lastTouchedAt: now }),
      ]);
      return;
    }
    if (!hasAired(movie.tmdbReleaseDate)) return;
    await db.transact([
      db.tx.userMovies[movie.id].update({
        status: 'finished',
        watchedAt: now,
        lastTouchedAt: now,
      }),
    ]);
  }

  async function toggleShowFinished(tmdbId: number) {
    const show = showsByTmdb.get(tmdbId);
    if (!show) return;
    const now = new Date().toISOString();
    if (show.status === 'finished') {
      await db.transact([
        db.tx.userShows[show.id].update({
          status: 'watching',
          lastTouchedAt: now,
          remainingAiredCount: null,
          unwatchedAiredCount: null,
        }),
      ]);
      return;
    }
    await db.transact([
      db.tx.userShows[show.id].update({ status: 'finished', lastTouchedAt: now }),
    ]);
  }

  const isSearching = query.trim().length > 0;
  const noHits = showHits.length === 0 && movieHits.length === 0;

  const popularShowHits = popular.map(showToSearchHit);
  const trendingShowHits = trending.map(showToSearchHit);
  const popularMovieHits = popularMovies.map(movieToSearchHit);
  const trendingMovieHits = trendingMovies.map(movieToSearchHit);
  const showBrowseShows = mediaFilter !== 'movie';
  const showBrowseMovies = mediaFilter !== 'tv';
  const browseEmpty =
    (!showBrowseShows || (popularShowHits.length === 0 && trendingShowHits.length === 0)) &&
    (!showBrowseMovies || (popularMovieHits.length === 0 && trendingMovieHits.length === 0));

  return (
    <TabScreen>
      <FilterToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search series and movies"
        searchPlacement="primary"
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
        ]}
      />

      {isSearching ? (
        searching ? (
          <ActivityIndicator color={theme.accent} style={styles.loader} />
        ) : noHits ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>{`No results for "${query}"`}</Text>
          </View>
        ) : (
          <CollapsibleScrollView contentContainerStyle={styles.listContent}>
            {showHits.length > 0 ? (
              <View>
                <View style={styles.searchGroupHeader}>
                  <Text style={styles.searchGroupTitle}>Series</Text>
                  <Text style={styles.searchGroupCount}>{showHits.length}</Text>
                </View>
                {showHits.map(item => (
                  <SearchResultRow
                    key={`tv-${item.id}`}
                    item={item}
                    entry={showsByTmdb.get(item.id)}
                    adding={pendingKeys.includes(`tv:${item.id}`)}
                    onPress={() => router.push(`/show/${item.id}`)}
                    onAdd={() => addShow({ id: item.id, name: item.name, poster_path: item.poster_path, overview: item.overview, first_air_date: item.airDate ?? '', vote_average: 0 })}
                    onToggleWatched={() => toggleShowFinished(item.id)}
                  />
                ))}
              </View>
            ) : null}
            {movieHits.length > 0 ? (
              <View>
                <View style={styles.searchGroupHeader}>
                  <Text style={[styles.searchGroupTitle, styles.searchGroupMovies]}>Movies</Text>
                  <Text style={styles.searchGroupCount}>{movieHits.length}</Text>
                </View>
                {movieHits.map(item => (
                  <SearchResultRow
                    key={`movie-${item.id}`}
                    item={item}
                    entry={moviesByTmdb.get(item.id)}
                    adding={pendingKeys.includes(`movie:${item.id}`)}
                    onPress={() => router.push({ pathname: '/movie/[id]', params: { id: String(item.id) } })}
                    onAdd={() => addMovie({ id: item.id, title: item.name, poster_path: item.poster_path, overview: item.overview, release_date: item.airDate ?? '', vote_average: 0 })}
                    onToggleWatched={() => toggleMovieWatched(item.id)}
                  />
                ))}
              </View>
            ) : null}
          </CollapsibleScrollView>
        )
      ) : loadingData ? (
        <ActivityIndicator color={theme.accent} style={styles.loader} />
      ) : (
        browseEmpty ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>Nothing matches these filters</Text>
          </View>
        ) : (
        <CollapsibleScrollView contentContainerStyle={styles.scrollContent}>
          {showBrowseShows ? (
            <HorizontalSection
              title="Series for you"
              kind="tv"
              data={popularShowHits}
              entries={showsByTmdb}
              pendingKeys={pendingKeys}
              onPress={id => router.push(`/show/${id}`)}
              onAdd={hit => addShow({ id: hit.id, name: hit.name, poster_path: hit.poster_path, overview: hit.overview, first_air_date: hit.airDate ?? '', vote_average: 0 })}
              onToggleWatched={toggleShowFinished}
            />
          ) : null}
          {showBrowseShows ? (
            <HorizontalSection
              title="Trending series"
              kind="tv"
              data={trendingShowHits}
              entries={showsByTmdb}
              pendingKeys={pendingKeys}
              onPress={id => router.push(`/show/${id}`)}
              onAdd={hit => addShow({ id: hit.id, name: hit.name, poster_path: hit.poster_path, overview: hit.overview, first_air_date: hit.airDate ?? '', vote_average: 0 })}
              onToggleWatched={toggleShowFinished}
            />
          ) : null}
          {showBrowseMovies ? (
            <HorizontalSection
              title="Movies for you"
              kind="movie"
              data={popularMovieHits}
              entries={moviesByTmdb}
              pendingKeys={pendingKeys}
              onPress={id => router.push({ pathname: '/movie/[id]', params: { id: String(id) } })}
              onAdd={hit => addMovie({ id: hit.id, title: hit.name, poster_path: hit.poster_path, overview: hit.overview, release_date: hit.airDate ?? '', vote_average: 0 })}
              onToggleWatched={toggleMovieWatched}
            />
          ) : null}
          {showBrowseMovies ? (
            <HorizontalSection
              title="Trending movies"
              kind="movie"
              data={trendingMovieHits}
              entries={moviesByTmdb}
              pendingKeys={pendingKeys}
              onPress={id => router.push({ pathname: '/movie/[id]', params: { id: String(id) } })}
              onAdd={hit => addMovie({ id: hit.id, title: hit.name, poster_path: hit.poster_path, overview: hit.overview, release_date: hit.airDate ?? '', vote_average: 0 })}
              onToggleWatched={toggleMovieWatched}
            />
          ) : null}
        </CollapsibleScrollView>
        )
      )}
    </TabScreen>
  );
}

function DiscoverAction({
  state,
  kind,
  overlay,
  name,
  onAdd,
  onToggleWatched,
}: {
  state: ActionState;
  kind: 'tv' | 'movie';
  overlay?: boolean;
  name: string;
  onAdd: () => void;
  onToggleWatched?: () => void;
}) {
  const wrap = overlay ? styles.addOverlay : styles.addBtn;
  const muted = overlay ? styles.addOverlayDone : styles.addBtnDone;
  const watchedWrap = overlay ? styles.addOverlayWatched : styles.addBtnWatched;
  const checkSize = overlay ? 22 : 26;

  if (state === 'adding') {
    return (
      <View style={[wrap, muted]}>
        <ActivityIndicator color="#fff" size="small" />
      </View>
    );
  }
  if (state === 'add') {
    return (
      <TouchableOpacity
        style={wrap}
        onPress={onAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Add ${name}`}
      >
        <Text style={overlay ? styles.addOverlayText : styles.addBtnText}>+</Text>
      </TouchableOpacity>
    );
  }
  if (state === 'upcoming') {
    return (
      <View style={[wrap, muted]} accessibilityLabel={`${name} isn't out yet`}>
        <Ionicons name="time-outline" size={18} color={theme.faint} />
      </View>
    );
  }
  if (state === 'watched' || state === 'listed') {
    const watched = state === 'watched';
    const label = kind === 'movie' ? 'watched' : 'finished';
    const inner = <EpisodeCheck watched={watched} size={checkSize} />;
    if (onToggleWatched) {
      return (
        <TouchableOpacity
          style={[wrap, watched ? watchedWrap : muted]}
          onPress={onToggleWatched}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={watched ? `Unmark ${name} as ${label}` : `Mark ${name} as ${label}`}
        >
          {inner}
        </TouchableOpacity>
      );
    }
    return (
      <View style={[wrap, watched ? watchedWrap : muted]} accessibilityLabel={`${name} ${label}`}>
        {inner}
      </View>
    );
  }
  return null;
}

function HorizontalSection({
  title,
  kind,
  data,
  entries,
  pendingKeys,
  onPress,
  onAdd,
  onToggleWatched,
}: {
  title: string;
  kind: 'tv' | 'movie';
  data: SearchHit[];
  entries: Map<number, ListEntry>;
  pendingKeys: string[];
  onPress: (id: number) => void;
  onAdd: (item: SearchHit) => void;
  onToggleWatched?: (tmdbId: number) => void;
}) {
  if (data.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={[styles.kindChip, kind === 'movie' ? styles.kindChipMovie : styles.kindChipSeries]}>
          {kind === 'movie' ? 'Movies' : 'Series'}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
        {data.map(item => {
          const poster = posterUrl(item.poster_path, 'w342');
          const adding = pendingKeys.includes(`${kind}:${item.id}`);
          const state = actionState(kind, entries.get(item.id), item.airDate, adding);
          return (
            <View key={`${kind}-${item.id}`} style={styles.posterCard}>
              <TouchableOpacity onPress={() => onPress(item.id)} activeOpacity={0.8}>
                {poster ? (
                  <Image source={{ uri: poster }} style={styles.hPoster} />
                ) : (
                  <View style={[styles.hPoster, styles.hPosterPlaceholder]}>
                    <Text style={styles.hPosterEmoji}>{kind === 'movie' ? '🎬' : '📺'}</Text>
                  </View>
                )}
                <Text style={[styles.posterKind, kind === 'movie' ? styles.kindChipMovie : styles.kindChipSeries]}>
                  {kind === 'movie' ? 'Movie' : 'Series'}
                </Text>
              </TouchableOpacity>
              <DiscoverAction
                overlay
                state={state}
                kind={kind}
                name={item.name}
                onAdd={() => onAdd(item)}
                onToggleWatched={onToggleWatched ? () => onToggleWatched(item.id) : undefined}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SearchResultRow({
  item,
  entry,
  adding,
  onPress,
  onAdd,
  onToggleWatched,
}: {
  item: SearchHit;
  entry?: ListEntry;
  adding: boolean;
  onPress: () => void;
  onAdd: () => void;
  onToggleWatched?: () => void;
}) {
  const poster = posterUrl(item.poster_path, 'w185');
  const isMovie = item.kind === 'movie';
  const state = actionState(isMovie ? 'movie' : 'tv', entry, item.airDate, adding);
  const hint =
    state === 'watched'
      ? isMovie
        ? 'Watched'
        : 'Finished'
      : state === 'upcoming'
        ? 'Not out yet'
        : null;
  return (
    <View style={styles.resultRow}>
      <TouchableOpacity
        style={styles.resultMain}
        onPress={onPress}
        activeOpacity={0.8}
      >
        {poster ? (
          <Image source={{ uri: poster }} style={styles.resultPoster} />
        ) : (
          <View style={[styles.resultPoster, styles.hPosterPlaceholder]}>
            <Text style={styles.hPosterEmoji}>{isMovie ? '🎬' : '📺'}</Text>
          </View>
        )}
        <View style={styles.resultInfo}>
          <View style={styles.resultMetaRow}>
            <Text style={[styles.resultKind, isMovie ? styles.kindChipMovie : styles.kindChipSeries]}>
              {isMovie ? 'Movie' : 'Series'}
            </Text>
            {item.year ? <Text style={styles.resultYear}>{item.year}</Text> : null}
            {hint ? <Text style={styles.resultHint}>{hint}</Text> : null}
          </View>
          <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.resultOverview} numberOfLines={2}>{item.overview}</Text>
        </View>
      </TouchableOpacity>
      <DiscoverAction
        state={state}
        kind={isMovie ? 'movie' : 'tv'}
        name={item.name}
        onAdd={onAdd}
        onToggleWatched={onToggleWatched}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loader: {
    marginTop: 48,
  },
  scrollContent: {
    paddingBottom: theme.tabBarClearance,
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
    color: theme.text,
    fontSize: 17,
    fontWeight: '700',
  },
  kindChip: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  kindChipSeries: {
    color: theme.sky,
  },
  kindChipMovie: {
    color: theme.gold,
  },
  posterKind: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  searchGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  searchGroupTitle: {
    color: theme.sky,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  searchGroupMovies: {
    color: theme.gold,
  },
  searchGroupCount: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
  },
  resultMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  resultKind: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
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
    backgroundColor: theme.elevated,
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
    top: 6,
    right: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addOverlayDone: {
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  addOverlayWatched: {
    backgroundColor: 'rgba(18, 17, 16, 0.78)',
  },
  addOverlayText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  browseAll: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  browseAllText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  listContent: {
    paddingBottom: theme.tabBarClearance,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  resultMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  resultPoster: {
    width: 52,
    height: 78,
    borderRadius: 6,
    marginRight: 14,
    backgroundColor: theme.elevated,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  resultYear: {
    color: theme.accent,
    fontSize: 12,
  },
  resultHint: {
    color: theme.check,
    fontSize: 11,
    fontWeight: '700',
  },
  resultOverview: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  addBtnDone: {
    backgroundColor: theme.elevated,
  },
  addBtnWatched: {
    backgroundColor: theme.elevated,
  },
  addBtnText: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  center: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.muted,
    fontSize: 14,
  },
});
