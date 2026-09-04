import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { id as instantId } from '@instantdb/react-native';
import { tmdb, posterUrl, stillUrl, formatEuropeanDate, formatRuntime, TmdbShow, TmdbSeasonSummary, TmdbEpisode, TmdbWatchProvider, providerLogoUrl } from '@/lib/tmdb';
import db from '@/lib/db';
import { progressUpdates, hasAired, isFutureAirDate, findProgressFromTmdb } from '@/lib/progress';
import { averageEpisodeRuntime, episodeRuntimeMinutes } from '@/lib/stats';
import { theme } from '@/constants/theme';
import EpisodeCheck from '@/components/EpisodeCheck';
import { uniqueByTmdbShowId, createUserShowTx, activateShowWatching } from '@/lib/userShows';

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
  const insets = useSafeAreaInsets();

  const [show, setShow] = useState<TmdbShow | null>(null);
  const [seasonMeta, setSeasonMeta] = useState<TmdbSeasonSummary[]>([]);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<number, TmdbEpisode[]>>({});
  const [loadingSeason, setLoadingSeason] = useState<number | null>(null);
  const [providers, setProviders] = useState<TmdbWatchProvider[]>([]);
  const [loadingShow, setLoadingShow] = useState(true);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const autoOpenedForShow = useRef<number | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    yesLabel: string;
    noLabel: string;
    resolve: (result: boolean | 'cancel') => void;
  } | null>(null);

  const { user } = db.useAuth();
  const { isLoading: dbLoading, data: dbData } = db.useQuery(
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

  const userShow = uniqueByTmdbShowId(dbData?.userShows ?? [])[0] ?? null;
  const watchedEps = dbData?.watchedEpisodes ?? [];
  const watchedSet = new Set(
    watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
  );

  function askConfirm(
    title: string,
    message: string,
    yesLabel = 'Yes',
    noLabel = 'No'
  ): Promise<boolean | 'cancel'> {
    return new Promise(resolve => {
      setConfirm({ title, message, yesLabel, noLabel, resolve });
    });
  }

  function closeConfirm(result: boolean | 'cancel') {
    const resolve = confirm?.resolve;
    setConfirm(null);
    queueMicrotask(() => resolve?.(result));
  }

  function seasonLooksAvailable(s: TmdbSeasonSummary): boolean {
    if (s.season_number <= 0) return false;
    const eps = episodesBySeason[s.season_number];
    if (eps) return eps.some(ep => hasAired(ep.air_date));
    if (hasAired(s.air_date)) return true;
    if (s.episode_count > 0 && s.air_date && !isFutureAirDate(s.air_date)) return true;
    return false;
  }

  function lastSeasonNumber(): number | null {
    const seasons = seasonMeta.filter(
      s =>
        s.season_number > 0 &&
        (seasonLooksAvailable(s) || (s.episode_count ?? 0) > 0)
    );
    if (seasons.length === 0) return null;
    return Math.max(...seasons.map(s => s.season_number));
  }

  function previousSeasonsIncomplete(lastSeason: number): boolean {
    return seasonMeta.some(s => {
      if (s.season_number <= 0 || s.season_number >= lastSeason) return false;
      if (!seasonLooksAvailable(s) && (s.episode_count ?? 0) === 0) return false;
      const eps = episodesBySeason[s.season_number];
      const expected = eps
        ? eps.filter(ep => hasAired(ep.air_date)).length
        : s.episode_count ?? 0;
      if (expected === 0) return false;
      const watched = watchedEps.filter(e => e.seasonNumber === s.season_number).length;
      return watched < expected;
    });
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingShow(true);
      setShow(null);
      setSeasonMeta([]);
      setEpisodesBySeason({});
      try {
        const showData = await tmdb.getShow(showId);
        if (!active) return;
        setShow(showData);
        const metas = (showData.seasons ?? [])
          .filter(s => s.season_number > 0)
          .sort((a, b) => a.season_number - b.season_number);
        setSeasonMeta(
          metas.length > 0
            ? metas
            : Array.from({ length: showData.number_of_seasons ?? 0 }, (_, i) => ({
                id: i + 1,
                season_number: i + 1,
                episode_count: 0,
                name: `Season ${i + 1}`,
              }))
        );
        setEpisodesBySeason({});
        const providerData = await tmdb.getWatchProviders(showId).catch(() => null);
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
        console.warn('Failed to load show', e);
      } finally {
        if (active) setLoadingShow(false);
      }
    }
    load();
    return () => { active = false; };
  }, [showId]);

  // Persist average episode length for Profile time stats.
  useEffect(() => {
    if (!userShow || !show) return;
    const existing = Number(userShow.episodeRuntime);
    if (Number.isFinite(existing) && existing > 0) return;
    const runtime = averageEpisodeRuntime(show.episode_run_time);
    if (runtime == null) return;
    db.transact([db.tx.userShows[userShow.id].update({ episodeRuntime: runtime })]).catch(
      () => {}
    );
  }, [userShow?.id, userShow?.episodeRuntime, show?.id, show?.episode_run_time]);

  async function ensureSeason(seasonNum: number): Promise<TmdbEpisode[]> {
    if (episodesBySeason[seasonNum]) return episodesBySeason[seasonNum];
    setLoadingSeason(seasonNum);
    try {
      const data = await tmdb.getSeason(showId, seasonNum, show?.original_language);
      const eps = (data.episodes ?? []).filter(e => e.season_number > 0);
      setEpisodesBySeason(prev => ({ ...prev, [seasonNum]: eps }));
      return eps;
    } catch (e) {
      console.warn('Failed to load season', seasonNum, e);
      return [];
    } finally {
      setLoadingSeason(null);
    }
  }

  function onToggleSeason(seasonNum: number) {
    if (expandedSeason === seasonNum) {
      setExpandedSeason(null);
      return;
    }
    setExpandedSeason(seasonNum);
    ensureSeason(seasonNum);
  }

  useEffect(() => {
    autoOpenedForShow.current = null;
  }, [showId]);

  useEffect(() => {
    if (!show || show.id !== showId || seasonMeta.length === 0 || dbLoading) return;
    if (autoOpenedForShow.current === showId) return;
    const preferred = (userShow?.nextSeasonNum as number | undefined) ?? seasonMeta[0].season_number;
    const n = seasonMeta.some(s => s.season_number === preferred)
      ? preferred
      : seasonMeta[0].season_number;
    autoOpenedForShow.current = showId;
    setExpandedSeason(n);
    ensureSeason(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, showId, seasonMeta, dbLoading, userShow?.nextSeasonNum]);

  async function toggleEpisode(seasonNum: number, episodeNum: number, airDate?: string) {
    if (!user) return;
    const existing = watchedEps.find(
      e => e.seasonNumber === seasonNum && e.episodeNumber === episodeNum
    );
    const isMarking = !existing;
    if (isMarking && !hasAired(airDate)) return;

    if (existing) {
      await db.transact([db.tx.watchedEpisodes[existing.id].delete()]);
    } else {
      const ep = episodesBySeason[seasonNum]?.find(e => e.episode_number === episodeNum);
      const runtime = episodeRuntimeMinutes(ep?.runtime);
      await db.transact([
        db.tx.watchedEpisodes[instantId()].update({
          tmdbShowId: showId,
          seasonNumber: seasonNum,
          episodeNumber: episodeNum,
          watchedAt: new Date().toISOString(),
          ...(runtime != null ? { runtime } : {}),
        }).link({ $user: user.id }),
      ]);
    }

    if (userShow) {
      syncNextEpisode(userShow.id, {
        add: isMarking ? [{ season: seasonNum, ep: episodeNum }] : undefined,
        remove: isMarking ? undefined : [{ season: seasonNum, ep: episodeNum }],
        startSeason: seasonNum,
        bumpTouch: isMarking,
      });
    }
  }

  function syncNextEpisode(
    userShowId: string,
    patch?: {
      add?: { season: number; ep: number }[];
      remove?: { season: number; ep: number }[];
      startSeason?: number;
      bumpTouch?: boolean;
    }
  ) {
    const watched = new Set(watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`));
    for (const item of patch?.add ?? []) watched.add(`${item.season}x${item.ep}`);
    for (const item of patch?.remove ?? []) watched.delete(`${item.season}x${item.ep}`);

    const startSeason = Math.max(
      1,
      patch?.startSeason ?? (userShow?.nextSeasonNum as number | undefined) ?? 1
    );

    findProgressFromTmdb(showId, watched, startSeason)
      .then(progress => {
        if (!patch && userShow?.status === 'watchLater') return;
        const updates: Record<string, unknown> = progressUpdates(progress);
        if (patch?.bumpTouch) {
          updates.lastTouchedAt = new Date().toISOString();
        }
        return db.transact([db.tx.userShows[userShowId].update(updates)]);
      })
      .catch(e => console.warn('Failed to sync next episode', e));
  }

  async function writeWatched(
    episodes: { season: number; ep: number; runtime?: number | null }[]
  ) {
    if (!user || episodes.length === 0) return;
    const now = new Date().toISOString();
    const CHUNK = 40;
    for (let i = 0; i < episodes.length; i += CHUNK) {
      const chunk = episodes.slice(i, i + CHUNK);
      await db.transact(
        chunk.map(item =>
          db.tx.watchedEpisodes[instantId()].update({
            tmdbShowId: showId,
            seasonNumber: item.season,
            episodeNumber: item.ep,
            watchedAt: now,
            ...(item.runtime != null && item.runtime > 0 ? { runtime: item.runtime } : {}),
          }).link({ $user: user.id })
        )
      );
    }
  }

  async function collectAiredUnwatched(
    seasonNumber: number
  ): Promise<{ season: number; ep: number; runtime?: number | null }[]> {
    const eps = await ensureSeason(seasonNumber);
    return eps
      .filter(
        ep =>
          hasAired(ep.air_date) &&
          !watchedSet.has(`${seasonNumber}x${ep.episode_number}`)
      )
      .map(ep => ({
        season: seasonNumber,
        ep: ep.episode_number,
        runtime: episodeRuntimeMinutes(ep.runtime),
      }));
  }

  async function unmarkSeason(seasonNumber: number) {
    if (!user) return;
    const toUnmark = watchedEps.filter(e => e.seasonNumber === seasonNumber);
    if (toUnmark.length === 0) return;
    await db.transact(toUnmark.map(e => db.tx.watchedEpisodes[e.id].delete()));
    if (userShow) {
      syncNextEpisode(userShow.id, {
        remove: toUnmark.map(e => ({
          season: e.seasonNumber as number,
          ep: e.episodeNumber as number,
        })),
        startSeason: 1,
      });
    }
  }

  async function markSeasonWatched(seasonNumber: number) {
    if (!user) return;
    const lastSeason = lastSeasonNumber();
    const isLast = lastSeason != null && seasonNumber === lastSeason;
    const skipEarlier = isLast && previousSeasonsIncomplete(seasonNumber);

    let forceFinished = false;
    let includeEarlier = false;

    if (skipEarlier) {
      const markEarlier = await askConfirm(
        'Mark earlier seasons?',
        'You marked the last season, but earlier seasons are not fully watched. Mark those as watched too?',
        'Yes',
        'No'
      );
      if (markEarlier === 'cancel') return;
      if (markEarlier) {
        includeEarlier = true;
      } else {
        const markFinished = await askConfirm(
          'Mark as finished?',
          'Leave earlier seasons unwatched, but set this show as Finished?',
          'Yes',
          'No'
        );
        if (markFinished === 'cancel') return;
        forceFinished = markFinished === true;
      }
    }

    const toAdd: { season: number; ep: number; runtime?: number | null }[] = [];
    if (includeEarlier) {
      for (const s of seasonMeta) {
        if (s.season_number <= 0 || s.season_number > seasonNumber) continue;
        toAdd.push(...(await collectAiredUnwatched(s.season_number)));
      }
    } else {
      toAdd.push(...(await collectAiredUnwatched(seasonNumber)));
    }

    if (toAdd.length === 0 && !forceFinished) return;
    await writeWatched(toAdd);

    if (forceFinished) {
      if (userShow) {
        await db.transact([
          db.tx.userShows[userShow.id].update({
            status: 'finished',
            lastTouchedAt: new Date().toISOString(),
          }),
        ]);
      } else {
        await setStatus('finished');
      }
      return;
    }

    if (userShow) {
      syncNextEpisode(userShow.id, {
        add: toAdd,
        startSeason: 1,
        bumpTouch: true,
      });
    }
  }

  async function setStatus(status: ShowStatus) {
    if (!user) return;
    if (userShow) {
      const fromWatchLater = userShow.status === 'watchLater';
      if (status === 'watching') {
        const watched = new Set(
          watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
        );
        try {
          await activateShowWatching({
            userShowId: userShow.id,
            tmdbShowId: showId,
            watchedKeys: watched,
            fromWatchLater,
            startSeason: 1,
            originalLanguage: show?.original_language ?? undefined,
          });
        } catch (e) {
          console.warn('Failed to activate watching', e);
          await db.transact([db.tx.userShows[userShow.id].update({ status })]);
        }
        return;
      }
      await db.transact([db.tx.userShows[userShow.id].update({ status })]);
    } else if (show) {
      const now = new Date().toISOString();
      const provisionalAir = show.first_air_date || '';
      const episodeRuntime = averageEpisodeRuntime(show.episode_run_time);
      const { entityId, tx } = createUserShowTx(user.id, {
        tmdbShowId: show.id,
        tmdbShowName: show.name,
        tmdbPosterPath: show.poster_path ?? '',
        status,
        addedAt: now,
        lastTouchedAt: now,
        tmdbOriginalLanguage: show.original_language ?? '',
        nextSeasonNum: 1,
        nextEpisodeNum: 1,
        nextEpisodeName: '',
        nextEpisodeAirDate: provisionalAir,
        nextEpisodeStillPath: '',
        totalEpisodes: show.number_of_episodes ?? 0,
        ...(episodeRuntime != null ? { episodeRuntime } : {}),
      });
      await db.transact([tx]);
      findProgressFromTmdb(show.id, new Set(), 1)
        .then(progress => {
          const updates = progressUpdates(progress);
          // Keep an explicit Watch Later / Finished choice from the picker.
          if (status === 'watchLater' || status === 'finished') {
            updates.status = status;
          }
          return db.transact([
            db.tx.userShows[entityId].update({
              ...updates,
              tmdbOriginalLanguage: show.original_language ?? '',
              ...(episodeRuntime != null ? { episodeRuntime } : {}),
            }),
          ]);
        })
        .catch(e => console.warn('Failed to enrich added show', e));
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
        <Stack.Screen options={{ title: '', headerStyle: { backgroundColor: theme.bg }, headerTintColor: theme.text }} />
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </>
    );
  }

  if (!show) {
    return (
      <>
        <Stack.Screen options={{ title: 'Error', headerStyle: { backgroundColor: theme.bg }, headerTintColor: theme.text }} />
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
              <Text style={styles.posterEmoji}>📺</Text>
            </View>
          )}
          <View style={styles.heroInfo}>
            <Text style={styles.kindPill}>Series</Text>
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

        {providers.length > 0 && (
          <View style={styles.providersSection}>
            <Text style={styles.sectionLabel}>Where to watch</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.providersRow}
            >
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
        )}

        <View style={styles.statusSection}>
          <Text style={styles.sectionLabel}>Your Status</Text>
          <View style={styles.statusButtons}>
            {STATUS_OPTIONS.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.statusBtn,
                  userShow?.status === key &&
                    (key === 'finished' ? styles.statusBtnDone : styles.statusBtnActive),
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

        {seasonMeta.length > 0 && (
          <View style={styles.seasonsSection}>
            <Text style={styles.sectionLabel}>Episodes</Text>
            {seasonMeta.map(season => {
              const eps = episodesBySeason[season.season_number];
              const total = eps?.length || season.episode_count || 0;
              const watchedCount = watchedEps.filter(
                e => e.seasonNumber === season.season_number
              ).length;
              const airedEps = (eps ?? []).filter(ep => hasAired(ep.air_date));
              const watchedAiredCount = airedEps.filter(ep =>
                watchedSet.has(`${season.season_number}x${ep.episode_number}`)
              ).length;
              const isExpanded = expandedSeason === season.season_number;
              const isLoadingEps = isExpanded && loadingSeason === season.season_number && !eps;
              const allAiredWatched =
                airedEps.length > 0 && watchedAiredCount === airedEps.length;

              const likelyAllWatched = total > 0 && watchedCount >= total;
              const canMark = eps ? !allAiredWatched : !likelyAllWatched;
              const canUnmark = watchedCount > 0;

              return (
                <View key={season.season_number} style={styles.seasonBlock}>
                  <View style={styles.seasonHeader}>
                    <TouchableOpacity
                      style={styles.seasonHeaderLeft}
                      onPress={() => onToggleSeason(season.season_number)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.seasonTitle}>{season.name}</Text>
                      <Text
                        style={[
                          styles.seasonProgress,
                          total > 0 && watchedCount >= total && styles.seasonProgressDone,
                        ]}
                      >
                        {watchedCount}/{total || '—'}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.seasonHeaderRight}>
                      {canUnmark ? (
                        <TouchableOpacity
                          style={[styles.markAllBtn, styles.unmarkAllBtn]}
                          onPress={() => unmarkSeason(season.season_number)}
                        >
                          <Text style={styles.markAllText}>Unmark all</Text>
                        </TouchableOpacity>
                      ) : null}
                      {canMark && total > 0 ? (
                        <TouchableOpacity
                          style={styles.markAllBtn}
                          onPress={() => markSeasonWatched(season.season_number)}
                        >
                          <Text style={styles.markAllText}>Mark all</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        onPress={() => onToggleSeason(season.season_number)}
                        hitSlop={8}
                      >
                        <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {isExpanded && isLoadingEps ? (
                    <View style={styles.seasonLoader}>
                      <ActivityIndicator color={theme.accent} />
                    </View>
                  ) : null}

                  {isExpanded &&
                    (eps ?? []).map(ep => {
                      const watched = watchedSet.has(
                        `${season.season_number}x${ep.episode_number}`
                      );
                      const aired = hasAired(ep.air_date);
                      const airDateLabel = formatEuropeanDate(ep.air_date);
                      const runtimeLabel = formatRuntime(ep.runtime);
                      const still = stillUrl(ep.still_path, 'w185');
                      const dateLine = !aired
                        ? airDateLabel
                          ? `Out ${airDateLabel}`
                          : 'Not out yet'
                        : airDateLabel ?? '';
                      const row = (
                        <>
                          <View style={styles.epStillWrap}>
                            {still ? (
                              <Image
                                source={{ uri: still }}
                                style={[styles.epStill, watched && styles.epStillWatched]}
                              />
                            ) : (
                              <View style={[styles.epStill, styles.epStillPlaceholder]} />
                            )}
                            <View style={styles.epStillCheck}>
                              {aired || watched ? (
                                <EpisodeCheck watched={watched} size={22} />
                              ) : (
                                <View style={styles.upcomingDot} />
                              )}
                            </View>
                          </View>
                          <View style={styles.epInfo}>
                            <Text
                              style={[
                                styles.epTitle,
                                watched && styles.epTitleWatched,
                                !aired && !watched && styles.epTitleUpcoming,
                              ]}
                              numberOfLines={1}
                            >
                              {ep.episode_number}. {ep.name}
                              {runtimeLabel ? ` · ${runtimeLabel}` : ''}
                            </Text>
                            {dateLine ? <Text style={styles.epDate}>{dateLine}</Text> : null}
                          </View>
                        </>
                      );
                      if (!aired && !watched) {
                        return (
                          <View
                            key={ep.id}
                            style={[styles.episodeRow, styles.episodeRowUpcoming]}
                            accessibilityLabel="This episode isn't out yet"
                          >
                            {row}
                          </View>
                        );
                      }
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
                              ep.episode_number,
                              ep.air_date
                            )
                          }
                          activeOpacity={0.7}
                        >
                          {row}
                        </TouchableOpacity>
                      );
                    })}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <Modal
        visible={confirm != null}
        transparent
        animationType="fade"
        onRequestClose={() => closeConfirm('cancel')}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => closeConfirm('cancel')}
          />
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>{confirm?.title}</Text>
            <Text style={styles.confirmMessage}>{confirm?.message}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmNo}
                onPress={() => closeConfirm(false)}
              >
                <Text style={styles.confirmNoText}>{confirm?.noLabel ?? 'No'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmYes}
                onPress={() => closeConfirm(true)}
              >
                <Text style={styles.confirmYesText}>{confirm?.yesLabel ?? 'Yes'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.bg,
  },
  errorText: {
    color: theme.muted,
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
    backgroundColor: theme.elevated,
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
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
  },
  kindPill: {
    alignSelf: 'flex-start',
    color: theme.sky,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metaText: {
    color: theme.muted,
    fontSize: 13,
  },
  rating: {
    color: theme.gold,
    fontSize: 14,
    fontWeight: '600',
  },
  showStatusPill: {
    alignSelf: 'flex-start',
    backgroundColor: theme.sky,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 2,
  },
  showStatusEnded: {
    backgroundColor: theme.faint,
  },
  showStatusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  overview: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  providersSection: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  providersRow: {
    gap: 12,
    paddingRight: 8,
  },
  providerItem: {
    width: 72,
    alignItems: 'center',
    gap: 6,
  },
  providerLogo: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: theme.elevated,
  },
  providerLogoFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  providerFallbackText: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
  },
  providerName: {
    color: theme.muted,
    fontSize: 11,
    textAlign: 'center',
    width: '100%',
  },
  statusSection: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionLabel: {
    color: theme.muted,
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
    borderColor: theme.border,
    backgroundColor: theme.elevated,
  },
  statusBtnActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  statusBtnDone: {
    backgroundColor: theme.check,
    borderColor: theme.check,
  },
  statusBtnText: {
    color: theme.muted,
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
    borderColor: theme.border,
  },
  removeBtnText: {
    color: theme.muted,
    fontSize: 13,
  },
  seasonsSection: {
    paddingHorizontal: 16,
  },
  seasonBlock: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 8,
  },
  seasonLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  seasonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.surface,
  },
  seasonHeaderLeft: {
    flex: 1,
    gap: 2,
  },
  seasonTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  seasonProgress: {
    color: theme.muted,
    fontSize: 12,
  },
  seasonProgressDone: {
    color: theme.check,
    fontWeight: '700',
  },
  seasonHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    maxWidth: '62%',
  },
  markAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.elevated,
  },
  unmarkAllBtn: {
    backgroundColor: theme.bg,
  },
  markAllText: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    position: 'relative',
  },
  confirmBox: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: theme.elevated,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 10,
    zIndex: 1,
  },
  confirmTitle: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '700',
  },
  confirmMessage: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  confirmNo: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  confirmNoText: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmYes: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: theme.accent,
  },
  confirmYesText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  chevron: {
    color: theme.muted,
    fontSize: 12,
  },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    gap: 12,
    backgroundColor: theme.elevated,
  },
  epStillWrap: {
    position: 'relative',
    width: 88,
    height: 50,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: theme.elevated,
  },
  epStill: {
    width: '100%',
    height: '100%',
  },
  epStillWatched: {
    opacity: 0.55,
  },
  epStillPlaceholder: {
    backgroundColor: theme.border,
  },
  epStillCheck: {
    position: 'absolute',
    right: 4,
    bottom: 4,
  },
  episodeRowWatched: {
    backgroundColor: theme.bg,
  },
  episodeRowUpcoming: {
    opacity: 0.55,
  },
  upcomingDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.border,
    flexShrink: 0,
  },
  epTitleUpcoming: {
    color: theme.faint,
  },
  epInfo: {
    flex: 1,
  },
  epTitle: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 19,
  },
  epTitleWatched: {
    color: theme.faint,
    textDecorationLine: 'line-through',
  },
  epDate: {
    color: theme.muted,
    fontSize: 11,
    marginTop: 2,
  },
});
