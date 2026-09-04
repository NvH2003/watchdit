import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  tmdb,
  posterUrl,
  formatRuntime,
  TmdbMovie,
  TmdbWatchProvider,
  providerLogoUrl,
} from '@/lib/tmdb';
import db from '@/lib/db';
import { hasAired } from '@/lib/progress';
import { theme } from '@/constants/theme';
import {
  uniqueByTmdbMovieId,
  createUserMovieTx,
  collectionAttrsFromTmdb,
} from '@/lib/userMovies';
import EpisodeCheck from '@/components/EpisodeCheck';

type MovieStatus = 'watching' | 'watchLater' | 'finished';

const STATUS_OPTIONS: { key: MovieStatus; label: string }[] = [
  { key: 'watching', label: 'To watch' },
  { key: 'watchLater', label: 'Watch Later' },
  { key: 'finished', label: 'Watched' },
];

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const movieId = Number(id);
  const insets = useSafeAreaInsets();
  const [movie, setMovie] = useState<TmdbMovie | null>(null);
  const [providers, setProviders] = useState<TmdbWatchProvider[]>([]);
  const [loading, setLoading] = useState(true);

  const { user } = db.useAuth();
  const { data } = db.useQuery(
    user
      ? { userMovies: { $: { where: { tmdbMovieId: movieId, '$user.id': user.id } } } }
      : null
  );
  const userMovie = uniqueByTmdbMovieId(data?.userMovies ?? [])[0] ?? null;

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const details = await tmdb.getMovie(movieId);
        if (!active) return;
        setMovie(details);
        const providerData = await tmdb.getMovieWatchProviders(movieId).catch(() => null);
        if (!active) return;
        const nl = providerData?.results?.NL?.flatrate ?? [];
        const be = providerData?.results?.BE?.flatrate ?? [];
        const byId = new Map<number, TmdbWatchProvider>();
        for (const p of [...nl, ...be]) {
          if (!byId.has(p.provider_id)) byId.set(p.provider_id, p);
        }
        setProviders(
          [...byId.values()].sort((a, b) => a.display_priority - b.display_priority)
        );
      } catch (e) {
        console.warn('Failed to load movie', e);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [movieId]);

  async function setStatus(status: MovieStatus) {
    if (!user || !movie) return;
    const now = new Date().toISOString();
    if (userMovie) {
      const updates: Record<string, unknown> = { status, lastTouchedAt: now };
      if (status === 'finished') updates.watchedAt = now;
      await db.transact([db.tx.userMovies[userMovie.id].update(updates)]);
      return;
    }
    const { tx } = createUserMovieTx(user.id, {
      tmdbMovieId: movie.id,
      tmdbMovieName: movie.title,
      tmdbPosterPath: movie.poster_path ?? '',
      status,
      addedAt: now,
      lastTouchedAt: now,
      tmdbReleaseDate: movie.release_date ?? '',
      runtime: movie.runtime ?? undefined,
      ...collectionAttrsFromTmdb(movie),
      ...(status === 'finished' ? { watchedAt: now } : {}),
    });
    await db.transact([tx]);
  }

  async function toggleWatched() {
    if (!movie) return;
    if (!hasAired(movie.release_date) && userMovie?.status !== 'finished') return;
    if (userMovie?.status === 'finished') {
      await setStatus('watching');
      return;
    }
    await setStatus('finished');
  }

  async function removeFromList() {
    if (!userMovie) return;
    await db.transact([db.tx.userMovies[userMovie.id].delete()]);
  }

  const poster = posterUrl(movie?.poster_path, 'w342');
  const watched = userMovie?.status === 'finished';
  const released = hasAired(movie?.release_date);

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: '', headerStyle: { backgroundColor: theme.bg }, headerTintColor: theme.text }} />
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </>
    );
  }

  if (!movie) {
    return (
      <>
        <Stack.Screen options={{ title: 'Error', headerStyle: { backgroundColor: theme.bg }, headerTintColor: theme.text }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>Movie not found</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: movie.title,
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          {poster ? (
            <Image source={{ uri: poster }} style={styles.poster} />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Text style={styles.posterEmoji}>🎬</Text>
            </View>
          )}
          <View style={styles.heroInfo}>
            <Text style={styles.kindPill}>Movie</Text>
            <Text style={styles.title} numberOfLines={3}>
              {movie.title}
            </Text>
            <View style={styles.metaRow}>
              {movie.release_date ? (
                <Text style={styles.metaText}>{movie.release_date.slice(0, 4)}</Text>
              ) : null}
              {formatRuntime(movie.runtime) ? (
                <Text style={styles.metaText}>{formatRuntime(movie.runtime)}</Text>
              ) : null}
            </View>
            {movie.vote_average ? (
              <Text style={styles.rating}>★ {movie.vote_average.toFixed(1)}</Text>
            ) : null}
          </View>
        </View>

        {movie.overview ? <Text style={styles.overview}>{movie.overview}</Text> : null}

        {providers.length > 0 ? (
          <View style={styles.providersSection}>
            <Text style={styles.sectionLabel}>Where to watch</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.providersRow}>
              {providers.map(p => {
                const logo = providerLogoUrl(p.logo_path);
                return (
                  <View key={p.provider_id} style={styles.providerItem}>
                    {logo ? (
                      <Image source={{ uri: logo }} style={styles.providerLogo} />
                    ) : (
                      <View style={[styles.providerLogo, styles.providerLogoFallback]}>
                        <Text style={styles.providerFallbackText}>
                          {p.provider_name.slice(0, 1)}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.providerName} numberOfLines={1}>
                      {p.provider_name}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.statusSection}>
          <Text style={styles.sectionLabel}>Your Status</Text>
          <View style={styles.statusButtons}>
            {STATUS_OPTIONS.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[styles.statusBtn, userMovie?.status === key && (key === 'finished' ? styles.statusBtnDone : styles.statusBtnActive)]}
                onPress={() => setStatus(key)}
              >
                <Text
                  style={[
                    styles.statusBtnText,
                    userMovie?.status === key && styles.statusBtnTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.watchBtn, watched && styles.watchBtnDone]}
            onPress={toggleWatched}
            disabled={!released && !watched}
          >
            <EpisodeCheck watched={watched} size={28} />
            <Text style={styles.watchBtnText}>
              {!released && !watched
                ? 'Not out yet'
                : watched
                  ? 'Marked as watched'
                  : 'Mark as watched'}
            </Text>
          </TouchableOpacity>
          {userMovie ? (
            <TouchableOpacity style={styles.removeBtn} onPress={removeFromList}>
              <Text style={styles.removeBtnText}>Remove from list</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 48 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.bg,
  },
  errorText: { color: theme.muted, fontSize: 16 },
  hero: { flexDirection: 'row', padding: 16, gap: 16 },
  poster: {
    width: 110,
    height: 165,
    borderRadius: 10,
    backgroundColor: theme.elevated,
  },
  posterPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  posterEmoji: { fontSize: 36 },
  heroInfo: { flex: 1, gap: 6 },
  kindPill: {
    alignSelf: 'flex-start',
    color: theme.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: { color: theme.text, fontSize: 20, fontWeight: '700', lineHeight: 26 },
  metaRow: { flexDirection: 'row', gap: 10 },
  metaText: { color: theme.muted, fontSize: 13 },
  rating: { color: theme.gold, fontSize: 14, fontWeight: '600' },
  overview: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  providersSection: { paddingHorizontal: 16, marginBottom: 24 },
  providersRow: { gap: 12, paddingRight: 8 },
  providerItem: { width: 72, alignItems: 'center', gap: 6 },
  providerLogo: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: theme.elevated,
  },
  providerLogoFallback: { justifyContent: 'center', alignItems: 'center' },
  providerFallbackText: { color: theme.text, fontSize: 18, fontWeight: '700' },
  providerName: { color: theme.muted, fontSize: 11, textAlign: 'center', width: '100%' },
  statusSection: { paddingHorizontal: 16, marginBottom: 24 },
  sectionLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  statusButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  statusBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.elevated,
  },
  statusBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  statusBtnDone: { backgroundColor: theme.check, borderColor: theme.check },
  statusBtnText: { color: theme.muted, fontSize: 13, fontWeight: '500' },
  statusBtnTextActive: { color: '#fff' },
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    backgroundColor: theme.elevated,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  watchBtnDone: {
    borderColor: theme.check,
  },
  watchBtnText: { color: theme.text, fontSize: 15, fontWeight: '600' },
  removeBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  removeBtnText: { color: theme.muted, fontSize: 13 },
});
