import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { id as instantId } from '@instantdb/react-native';
import { tmdb, posterUrl, TmdbShow, TmdbSeason } from '@/lib/tmdb';
import db from '@/lib/db';

type ShowStatus = 'watching' | 'watchLater' | 'finished' | 'upToDate';

const STATUS_OPTIONS: { key: ShowStatus; label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'watchLater', label: 'Watch Later' },
  { key: 'upToDate', label: 'Up to Date' },
  { key: 'finished', label: 'Finished' },
];

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const showId = Number(id);
  const router = useRouter();

  const [show, setShow] = useState<TmdbShow | null>(null);
  const [seasons, setSeasons] = useState<TmdbSeason[]>([]);
  const [loadingShow, setLoadingShow] = useState(true);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(1);

  const { user } = db.useAuth();
  const { data: dbData } = db.useQuery(
    user
      ? {
          userShows: {
            $: { where: { tmdbShowId: showId, '$user.id': user.id } },
          },
          watchedEpisodes: {
            $: { where: { tmdbShowId: showId, '$user.id': user.id } },
          },
        }
      : null
  );

  const userShow = (dbData?.userShows ?? [])[0] ?? null;
  const watchedEps = dbData?.watchedEpisodes ?? [];
  const watchedSet = new Set(
    watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
  );

  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingShow(true);
      try {
        const showData = await tmdb.getShow(showId);
        if (!active) return;
        setShow(showData);
        const totalSeasons = showData.number_of_seasons ?? 0;
        if (totalSeasons > 0) {
          const seasonData = await tmdb.getSeasons(
            showId,
            Math.min(totalSeasons, 10)
          );
          if (active) {
            setSeasons(seasonData.filter(s => s.season_number > 0));
          }
        }
      } catch (e) {
        console.warn('Failed to load show', e);
      } finally {
        if (active) setLoadingShow(false);
      }
    }
    load();
    return () => { active = false; };
  }, [showId]);

  async function toggleEpisode(seasonNum: number, episodeNum: number) {
    if (!user) return;
    const key = `${seasonNum}x${episodeNum}`;
    const existing = watchedEps.find(
      e => e.seasonNumber === seasonNum && e.episodeNumber === episodeNum
    );
    if (existing) {
      await db.transact([db.tx.watchedEpisodes[existing.id].delete()]);
    } else {
      await db.transact([
        db.tx.watchedEpisodes[instantId()].update({
          tmdbShowId: showId,
          seasonNumber: seasonNum,
          episodeNumber: episodeNum,
          watchedAt: new Date().toISOString(),
        }).link({ $user: user.id }),
      ]);
    }
  }

  async function markSeasonWatched(season: TmdbSeason) {
    if (!user || !season.episodes) return;
    const toMark = season.episodes.filter(
      ep => !watchedSet.has(`${season.season_number}x${ep.episode_number}`)
    );
    if (toMark.length === 0) {
      const toUnmark = watchedEps.filter(
        e => e.seasonNumber === season.season_number
      );
      await db.transact(toUnmark.map(e => db.tx.watchedEpisodes[e.id].delete()));
    } else {
      await db.transact(
        toMark.map(ep =>
          db.tx.watchedEpisodes[instantId()].update({
            tmdbShowId: showId,
            seasonNumber: season.season_number,
            episodeNumber: ep.episode_number,
            watchedAt: new Date().toISOString(),
          }).link({ $user: user.id })
        )
      );
    }
  }

  async function setStatus(status: ShowStatus) {
    if (!user) return;
    if (userShow) {
      await db.transact([db.tx.userShows[userShow.id].update({ status })]);
    } else if (show) {
      await db.transact([
        db.tx.userShows[instantId()].update({
          tmdbShowId: show.id,
          tmdbShowName: show.name,
          tmdbPosterPath: show.poster_path ?? '',
          status,
          addedAt: new Date().toISOString(),
        }).link({ $user: user.id }),
      ]);
    }
  }

  async function removeFromList() {
    if (!userShow) return;
    await db.transact([db.tx.userShows[userShow.id].delete()]);
  }

  const poster = posterUrl(show?.poster_path, 'w342');

  if (loadingShow) {
    return (
      <>
        <Stack.Screen options={{ title: '', headerStyle: { backgroundColor: '#0d0f14' }, headerTintColor: '#fff' }} />
        <View style={styles.center}>
          <ActivityIndicator color="#e94560" size="large" />
        </View>
      </>
    );
  }

  if (!show) {
    return (
      <>
        <Stack.Screen options={{ title: 'Error', headerStyle: { backgroundColor: '#0d0f14' }, headerTintColor: '#fff' }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>Show not found</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: show.name,
          headerStyle: { backgroundColor: '#0d0f14' },
          headerTintColor: '#fff',
          headerShadowVisible: false,
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          {poster ? (
            <Image source={{ uri: poster }} style={styles.poster} />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Text style={styles.posterEmoji}>📺</Text>
            </View>
          )}
          <View style={styles.heroInfo}>
            <Text style={styles.showTitle} numberOfLines={3}>
              {show.name}
            </Text>
            <View style={styles.metaRow}>
              {show.first_air_date ? (
                <Text style={styles.metaText}>
                  {show.first_air_date.slice(0, 4)}
                </Text>
              ) : null}
              {show.number_of_seasons ? (
                <Text style={styles.metaText}>
                  {show.number_of_seasons}{' '}
                  {show.number_of_seasons === 1 ? 'season' : 'seasons'}
                </Text>
              ) : null}
            </View>
            {show.vote_average ? (
              <Text style={styles.rating}>★ {show.vote_average.toFixed(1)}</Text>
            ) : null}
            {show.status ? (
              <View
                style={[
                  styles.showStatusPill,
                  show.status === 'Ended' && styles.showStatusEnded,
                ]}
              >
                <Text style={styles.showStatusText}>{show.status}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {show.overview ? (
          <Text style={styles.overview}>{show.overview}</Text>
        ) : null}

        <View style={styles.statusSection}>
          <Text style={styles.sectionLabel}>Your Status</Text>
          <View style={styles.statusButtons}>
            {STATUS_OPTIONS.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.statusBtn,
                  userShow?.status === key && styles.statusBtnActive,
                ]}
                onPress={() => setStatus(key)}
              >
                <Text
                  style={[
                    styles.statusBtnText,
                    userShow?.status === key && styles.statusBtnTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {userShow ? (
            <TouchableOpacity style={styles.removeBtn} onPress={removeFromList}>
              <Text style={styles.removeBtnText}>Remove from list</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {seasons.length > 0 && (
          <View style={styles.seasonsSection}>
            <Text style={styles.sectionLabel}>Episodes</Text>
            {seasons.map(season => {
              const eps = season.episodes ?? [];
              const watchedCount = eps.filter(
                ep =>
                  watchedSet.has(`${season.season_number}x${ep.episode_number}`)
              ).length;
              const isExpanded = expandedSeason === season.season_number;
              const allWatched = eps.length > 0 && watchedCount === eps.length;

              return (
                <View key={season.season_number} style={styles.seasonBlock}>
                  <TouchableOpacity
                    style={styles.seasonHeader}
                    onPress={() =>
                      setExpandedSeason(isExpanded ? null : season.season_number)
                    }
                    activeOpacity={0.8}
                  >
                    <View style={styles.seasonHeaderLeft}>
                      <Text style={styles.seasonTitle}>{season.name}</Text>
                      <Text style={styles.seasonProgress}>
                        {watchedCount}/{eps.length}
                      </Text>
                    </View>
                    <View style={styles.seasonHeaderRight}>
                      <TouchableOpacity
                        style={[
                          styles.markAllBtn,
                          allWatched && styles.markAllBtnActive,
                        ]}
                        onPress={() => markSeasonWatched(season)}
                      >
                        <Text style={styles.markAllText}>
                          {allWatched ? 'Unmark all' : 'Mark all'}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
                    </View>
                  </TouchableOpacity>

                  {isExpanded &&
                    eps.map(ep => {
                      const watched = watchedSet.has(
                        `${season.season_number}x${ep.episode_number}`
                      );
                      return (
                        <TouchableOpacity
                          key={ep.id}
                          style={[
                            styles.episodeRow,
                            watched && styles.episodeRowWatched,
                          ]}
                          onPress={() =>
                            toggleEpisode(
                              season.season_number,
                              ep.episode_number
                            )
                          }
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.checkBox,
                              watched && styles.checkBoxDone,
                            ]}
                          >
                            {watched ? (
                              <Text style={styles.checkMark}>✓</Text>
                            ) : null}
                          </View>
                          <View style={styles.epInfo}>
                            <Text
                              style={[
                                styles.epTitle,
                                watched && styles.epTitleWatched,
                              ]}
                              numberOfLines={1}
                            >
                              {ep.episode_number}. {ep.name}
                            </Text>
                            {ep.air_date ? (
                              <Text style={styles.epDate}>{ep.air_date}</Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0f14',
  },
  content: {
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0d0f14',
  },
  errorText: {
    color: '#8892a4',
    fontSize: 16,
  },
  hero: {
    flexDirection: 'row',
    padding: 16,
    gap: 16,
  },
  poster: {
    width: 110,
    height: 165,
    borderRadius: 10,
    backgroundColor: '#252840',
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterEmoji: {
    fontSize: 36,
  },
  heroInfo: {
    flex: 1,
    gap: 6,
  },
  showTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metaText: {
    color: '#8892a4',
    fontSize: 13,
  },
  rating: {
    color: '#f5a623',
    fontSize: 14,
    fontWeight: '600',
  },
  showStatusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#4caf50',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 2,
  },
  showStatusEnded: {
    backgroundColor: '#555',
  },
  showStatusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  overview: {
    color: '#c0c8d8',
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  statusSection: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionLabel: {
    color: '#8892a4',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  statusButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  statusBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#252840',
    backgroundColor: '#1c1f2e',
  },
  statusBtnActive: {
    backgroundColor: '#e94560',
    borderColor: '#e94560',
  },
  statusBtnText: {
    color: '#8892a4',
    fontSize: 13,
    fontWeight: '500',
  },
  statusBtnTextActive: {
    color: '#fff',
  },
  removeBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  removeBtnText: {
    color: '#8892a4',
    fontSize: 13,
  },
  seasonsSection: {
    paddingHorizontal: 16,
  },
  seasonBlock: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1c1f2e',
    marginBottom: 8,
  },
  seasonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#131520',
  },
  seasonHeaderLeft: {
    flex: 1,
    gap: 2,
  },
  seasonTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  seasonProgress: {
    color: '#8892a4',
    fontSize: 12,
  },
  seasonHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  markAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#252840',
  },
  markAllBtnActive: {
    backgroundColor: '#1c1f2e',
  },
  markAllText: {
    color: '#8892a4',
    fontSize: 11,
    fontWeight: '600',
  },
  chevron: {
    color: '#8892a4',
    fontSize: 12,
  },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1c1f2e',
    gap: 12,
    backgroundColor: '#1c1f2e',
  },
  episodeRowWatched: {
    backgroundColor: '#161825',
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  checkBoxDone: {
    backgroundColor: '#e94560',
    borderColor: '#e94560',
  },
  checkMark: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  epInfo: {
    flex: 1,
  },
  epTitle: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 19,
  },
  epTitleWatched: {
    color: '#555',
  },
  epDate: {
    color: '#8892a4',
    fontSize: 11,
    marginTop: 2,
  },
});
