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
import * as WebBrowser from 'expo-web-browser';
import { tmdb, posterUrl, stillUrl, formatEuropeanDate, formatRuntime, TmdbShow, TmdbSeasonSummary, TmdbEpisode, TmdbWatchProvider, providerLogoUrl } from '@/lib/tmdb';
import db from '@/lib/db';
import { progressUpdates, hasAired, episodeIsAvailable, findProgressFromTmdb, clampEarlyAccessDays, trackFromOf, deriveTrackFrom, TrackFrom, isBeforeTrackFrom } from '@/lib/progress';
import { averageEpisodeRuntime, episodeRuntimeMinutes } from '@/lib/stats';
import { loadCatalogExtras, mergeSeasonMeta, mergeTmdbEpisodes, dedupeEpisodesByTitle, expandWatchedKeys, watchedHintsFromRows, watchedTitleFields, episodeTitleKey, episodeOverviewKey } from '@/lib/catalog';
import { TvmazeEpisode } from '@/lib/tvmaze';
import { theme } from '@/constants/theme';
import EpisodeCheck from '@/components/EpisodeCheck';
import EpisodeDetailModal from '@/components/EpisodeDetailModal';
import { uniqueByTmdbShowId, createUserShowTx, activateShowWatching } from '@/lib/userShows';
import { fetchLongerEpisodeOverview } from '@/lib/episodeOverview';
import SearchableDropdown from '@/components/SearchableDropdown';

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
  const [imdbId, setImdbId] = useState<string | null>(null);
  const [mazeUrl, setMazeUrl] = useState<string | null>(null);
  const mazeEpsRef = useRef<TvmazeEpisode[]>([]);
  const [loadingSeason, setLoadingSeason] = useState<number | null>(null);
  const [providers, setProviders] = useState<TmdbWatchProvider[]>([]);
  const [loadingShow, setLoadingShow] = useState(true);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const autoOpenedForShow = useRef<number | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [episodeModal, setEpisodeModal] = useState<TmdbEpisode | null>(null);
  const [episodeModalLoading, setEpisodeModalLoading] = useState(false);
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
  const daysEarly = clampEarlyAccessDays(userShow?.earlyAccessDays);
  const watchedEps = dbData?.watchedEpisodes ?? [];
  const watchedSet = expandWatchedKeys(
    new Set(watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)),
    Object.values(episodesBySeason).flat(),
    watchedHintsFromRows(watchedEps)
  );

  function epAvailable(ep: Pick<TmdbEpisode, 'air_date' | 'still_path' | 'runtime' | 'overview'>) {
    return episodeIsAvailable(
      {
        airDate: ep.air_date,
        stillPath: ep.still_path,
        runtime: ep.runtime,
        overview: ep.overview,
      },
      daysEarly
    );
  }

  useEffect(() => {
    if (!user || watchedEps.length === 0) return;
    const seen = new Set<string>();
    const extras: string[] = [];
    for (const e of watchedEps) {
      const key = `${e.seasonNumber}x${e.episodeNumber}`;
      if (seen.has(key)) extras.push(e.id);
      else seen.add(key);
    }
    if (extras.length === 0) return;
    db.transact(extras.map(eid => db.tx.watchedEpisodes[eid].delete())).catch(() => {});
  }, [user, watchedEps]);

  useEffect(() => {
    if (!user) return;
    const txs = [];
    for (const w of watchedEps) {
      const ep = episodesBySeason[w.seasonNumber]?.find(
        e => e.episode_number === w.episodeNumber
      );
      const fields = watchedTitleFields(ep?.name, ep?.overview);
      if (!fields.titleKey && !fields.overviewKey) continue;
      if (w.titleKey && (!fields.overviewKey || w.overviewKey)) continue;
      txs.push(db.tx.watchedEpisodes[w.id].update(fields));
    }
    if (txs.length === 0) return;
    db.transact(txs).catch(() => {});
  }, [user, watchedEps, episodesBySeason]);

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
        const extras = await loadCatalogExtras(showId, {
          name: showData.name,
          original_name: showData.original_name,
        }).catch(() => ({ mazeShow: null, mazeEpisodes: [] as TvmazeEpisode[], imdbId: null }));
        if (!active) return;
        mazeEpsRef.current = extras.mazeEpisodes;
        setImdbId(extras.imdbId);
        setMazeUrl(extras.mazeShow?.url ?? null);
        const tmdbMetas = (showData.seasons ?? [])
          .filter(s => s.season_number > 0)
          .sort((a, b) => a.season_number - b.season_number);
        const fallbackMetas =
          tmdbMetas.length > 0
            ? tmdbMetas
            : Array.from({ length: showData.number_of_seasons ?? 0 }, (_, i) => ({
                id: i + 1,
                season_number: i + 1,
                episode_count: 0,
                name: `Season ${i + 1}`,
              }));
        setSeasonMeta(mergeSeasonMeta(fallbackMetas, extras.mazeEpisodes));
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
    const cached = episodesBySeason[seasonNum];
    if (cached) return dedupeEpisodesByTitle(cached, watchedSet);
    setLoadingSeason(seasonNum);
    try {
      let tmdbEps: TmdbEpisode[] = [];
      try {
        const data = await tmdb.getSeason(showId, seasonNum);
        tmdbEps = (data.episodes ?? []).filter(e => e.season_number > 0);
      } catch {
        tmdbEps = [];
      }
      const mazeForSeason = mazeEpsRef.current.filter(e => e.season === seasonNum);
      const eps = dedupeEpisodesByTitle(
        mergeTmdbEpisodes(tmdbEps, mazeForSeason),
        watchedSet
      );
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

  async function enrichEpisodeOverview(seasonNum: number, ep: TmdbEpisode) {
    const current = ep.overview?.trim() ?? '';
    setEpisodeModalLoading(true);
    try {
      const extras = await fetchLongerEpisodeOverview({
        showId,
        season: seasonNum,
        episode: ep.episode_number,
        current,
        originalLanguage: show?.original_language,
      });
      const best = extras.overview;
      setEpisodeModal(prev =>
        prev && prev.season_number === seasonNum && prev.episode_number === ep.episode_number
          ? {
              ...prev,
              overview: best || prev.overview,
              still_path: extras.stillPath || prev.still_path,
              name: extras.name || prev.name,
              runtime: extras.runtime ?? prev.runtime,
              air_date: extras.airDate || prev.air_date,
              vote_average: extras.voteAverage ?? prev.vote_average,
            }
          : prev
      );
      if (best.length <= current.length && !extras.stillPath) return;
      setEpisodesBySeason(prev => {
        const list = prev[seasonNum];
        if (!list) return prev;
        return {
          ...prev,
          [seasonNum]: list.map(e =>
            e.episode_number === ep.episode_number
              ? {
                  ...e,
                  overview: best || e.overview,
                  still_path: extras.stillPath || e.still_path,
                  vote_average: extras.voteAverage ?? e.vote_average,
                }
              : e
          ),
        };
      });
    } catch (e) {
      console.warn('Failed to load episode overview', e);
    } finally {
      setEpisodeModalLoading(false);
    }
  }

  function openEpisodeModal(seasonNum: number, ep: TmdbEpisode) {
    setEpisodeModal(ep);
    enrichEpisodeOverview(seasonNum, ep);
  }

  useEffect(() => {
    autoOpenedForShow.current = null;
    setEpisodeModal(null);
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

  function episodeCode(season: number, ep: number): string {
    return `S${String(season).padStart(2, '0')} | E${String(ep).padStart(2, '0')}`;
  }

  async function collectUnwatchedBefore(
    seasonNum: number,
    episodeNum: number
  ): Promise<{
    season: number;
    ep: number;
    runtime?: number | null;
    name?: string | null;
    overview?: string | null;
  }[]> {
    const floor = trackFromOf(userShow);
    const out: {
      season: number;
      ep: number;
      runtime?: number | null;
      name?: string | null;
      overview?: string | null;
    }[] = [];
    for (const s of seasonMeta) {
      if (s.season_number <= 0 || s.season_number > seasonNum) continue;
      const eps = await ensureSeason(s.season_number);
      for (const ep of eps) {
        if (isBeforeTrackFrom(ep.season_number, ep.episode_number, floor)) continue;
        if (
          ep.season_number > seasonNum ||
          (ep.season_number === seasonNum && ep.episode_number >= episodeNum)
        ) {
          continue;
        }
        if (!epAvailable(ep)) continue;
        if (watchedSet.has(`${ep.season_number}x${ep.episode_number}`)) continue;
        out.push({
          season: ep.season_number,
          ep: ep.episode_number,
          runtime: episodeRuntimeMinutes(ep.runtime),
          name: ep.name,
          overview: ep.overview,
        });
      }
    }
    return out;
  }

  async function askAboutSkippedEarlier(
    seasonNum: number,
    episodeNum: number
  ): Promise<'none' | 'mark' | 'skip' | 'cancel'> {
    const earlier = await collectUnwatchedBefore(seasonNum, episodeNum);
    if (earlier.length === 0) return 'none';
    const choice = await askConfirm(
      'You skipped earlier episodes',
      `You're checking ${episodeCode(seasonNum, episodeNum)}, but earlier episodes aren’t fully watched. Skip those seasons and continue from here, or mark everything before this as watched?`,
      'Skip earlier',
      'Mark earlier'
    );
    if (choice === 'cancel') return 'cancel';
    return choice ? 'skip' : 'mark';
  }

  async function toggleEpisode(seasonNum: number, episodeNum: number, airDate?: string) {
    if (!user) return;
    const existing = watchedEps.filter(
      e => e.seasonNumber === seasonNum && e.episodeNumber === episodeNum
    );
    const isMarking = existing.length === 0;
    if (isMarking) {
      const listed = episodesBySeason[seasonNum]?.find(e => e.episode_number === episodeNum);
      const available = listed
        ? epAvailable(listed)
        : hasAired(airDate, daysEarly);
      if (!available) return;
    }

    let skipped: 'none' | 'mark' | 'skip' | 'cancel' = 'none';
    if (isMarking) {
      skipped = await askAboutSkippedEarlier(seasonNum, episodeNum);
      if (skipped === 'cancel') return;
    }

    const watched = new Set(
      watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
    );
    const extra = extraShowMeta();
    let floor = trackFromOf(userShow);

    if (skipped === 'mark') {
      const earlier = await collectUnwatchedBefore(seasonNum, episodeNum);
      await writeWatched(earlier);
      for (const item of earlier) watched.add(`${item.season}x${item.ep}`);
    }
    if (skipped === 'skip') {
      floor = { season: seasonNum, episode: episodeNum };
      extra.trackFromSeason = seasonNum;
      extra.trackFromEpisode = episodeNum;
    }

    if (existing.length > 0) {
      await db.transact(existing.map(e => db.tx.watchedEpisodes[e.id].delete()));
      watched.delete(`${seasonNum}x${episodeNum}`);
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
          ...watchedTitleFields(ep?.name, ep?.overview),
        }).link({ $user: user.id }),
      ]);
      watched.add(`${seasonNum}x${episodeNum}`);
    }

    const userShowId = userShow?.id ?? (await createShowOnList('watching'));
    if (!userShowId) return;
    await applyProgress(userShowId, watched, extra, floor);
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

    const stored = trackFromOf(userShow);
    const startSeason = Math.max(
      1,
      stored?.season ??
        patch?.startSeason ??
        (userShow?.nextSeasonNum as number | undefined) ??
        1
    );

    findProgressFromTmdb(
      showId,
      watched,
      startSeason,
      daysEarly,
      stored,
      progressHints(watched)
    )
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
    episodes: {
      season: number;
      ep: number;
      runtime?: number | null;
      name?: string | null;
      overview?: string | null;
    }[]
  ) {
    if (!user || episodes.length === 0) return;
    const seen = new Set(watchedSet);
    const unique = episodes.filter(item => {
      const key = `${item.season}x${item.ep}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length === 0) return;
    const now = new Date().toISOString();
    const CHUNK = 40;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      await db.transact(
        chunk.map(item =>
          db.tx.watchedEpisodes[instantId()].update({
            tmdbShowId: showId,
            seasonNumber: item.season,
            episodeNumber: item.ep,
            watchedAt: now,
            ...(item.runtime != null && item.runtime > 0 ? { runtime: item.runtime } : {}),
            ...watchedTitleFields(item.name, item.overview),
          }).link({ $user: user.id })
        )
      );
    }
  }

  async function collectAiredUnwatched(
    seasonNumber: number
  ): Promise<{
    season: number;
    ep: number;
    runtime?: number | null;
    name?: string | null;
    overview?: string | null;
  }[]> {
    const eps = await ensureSeason(seasonNumber);
    return eps
      .filter(
        ep =>
          epAvailable(ep) &&
          !watchedSet.has(`${seasonNumber}x${ep.episode_number}`)
      )
      .map(ep => ({
        season: seasonNumber,
        ep: ep.episode_number,
        runtime: episodeRuntimeMinutes(ep.runtime),
        name: ep.name,
        overview: ep.overview,
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
    const skipped = await askAboutSkippedEarlier(seasonNumber, 1);
    if (skipped === 'cancel') return;

    const extra = extraShowMeta();
    let floor = trackFromOf(userShow);
    const toAdd: { season: number; ep: number; runtime?: number | null }[] = [];

    if (skipped === 'mark') {
      toAdd.push(...(await collectUnwatchedBefore(seasonNumber, 1)));
    }
    if (skipped === 'skip') {
      floor = { season: seasonNumber, episode: 1 };
      extra.trackFromSeason = seasonNumber;
      extra.trackFromEpisode = 1;
    }
    toAdd.push(...(await collectAiredUnwatched(seasonNumber)));

    if (toAdd.length === 0 && skipped === 'none') return;
    await writeWatched(toAdd);

    const watched = new Set(
      watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
    );
    for (const item of toAdd) watched.add(`${item.season}x${item.ep}`);

    const userShowId = userShow?.id ?? (await createShowOnList('watching'));
    if (!userShowId) return;
    await applyProgress(userShowId, watched, extra, floor);
  }

  async function collectAllAiredUnwatched(): Promise<
    { season: number; ep: number; runtime?: number | null }[]
  > {
    const toAdd: { season: number; ep: number; runtime?: number | null }[] = [];
    for (const s of seasonMeta) {
      if (s.season_number <= 0) continue;
      toAdd.push(...(await collectAiredUnwatched(s.season_number)));
    }
    return toAdd;
  }

  async function createShowOnList(status: ShowStatus): Promise<string | null> {
    if (!user || !show) return null;
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
      earlyAccessDays: daysEarly,
      ...(episodeRuntime != null ? { episodeRuntime } : {}),
    });
    await db.transact([tx]);
    return entityId;
  }

  function progressHints(watchedKeys: Set<string>) {
    const hints = watchedHintsFromRows(watchedEps);
    for (const key of watchedKeys) {
      const [season, ep] = key.split('x').map(Number);
      const listed = episodesBySeason[season]?.find(e => e.episode_number === ep);
      const titleKey = episodeTitleKey(listed?.name);
      const overviewKey = episodeOverviewKey(listed?.overview);
      if (titleKey || overviewKey) {
        hints.push({
          season,
          ep,
          titleKey: titleKey || undefined,
          overviewKey: overviewKey || undefined,
        });
      }
    }
    return hints;
  }

  async function applyProgress(
    userShowId: string,
    watchedKeys: Set<string>,
    extra?: Record<string, unknown>,
    trackFrom?: TrackFrom | null
  ) {
    const floor = trackFrom === undefined ? trackFromOf(userShow) : trackFrom;
    const progress = await findProgressFromTmdb(
      showId,
      watchedKeys,
      floor?.season ?? 1,
      daysEarly,
      floor,
      progressHints(watchedKeys)
    );
    const updates: Record<string, unknown> = {
      ...progressUpdates(progress),
      lastTouchedAt: new Date().toISOString(),
      ...extra,
    };
    await db.transact([db.tx.userShows[userShowId].update(updates)]);
  }

  async function setStartSeason(seasonNum: number) {
    if (!user) return;
    const nextFloor =
      seasonNum <= 1 ? null : { season: seasonNum, episode: 1 };
    const current = trackFromOf(userShow);
    if ((current?.season ?? 1) === (nextFloor?.season ?? 1) && userShow) {
      if ((current?.episode ?? 1) === 1 || nextFloor == null) return;
    }

    const watched = new Set(
      watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
    );
    const extra = extraShowMeta();
    extra.trackFromSeason = nextFloor?.season ?? null;
    extra.trackFromEpisode = nextFloor?.episode ?? null;

    if (nextFloor) {
      const earlierChecked = watchedEps.filter(e =>
        isBeforeTrackFrom(
          Number(e.seasonNumber),
          Number(e.episodeNumber),
          nextFloor
        )
      );
      if (earlierChecked.length > 0) {
        const uncheck = await askConfirm(
          'Uncheck earlier episodes?',
          `You already checked ${earlierChecked.length} episode${
            earlierChecked.length === 1 ? '' : 's'
          } before this start point. Uncheck those so they no longer count as watched?`,
          'Uncheck them',
          'Keep checked'
        );
        if (uncheck === 'cancel') return;
        if (uncheck) {
          await db.transact(
            earlierChecked.map(e => db.tx.watchedEpisodes[e.id].delete())
          );
          for (const e of earlierChecked) {
            watched.delete(`${e.seasonNumber}x${e.episodeNumber}`);
          }
        }
      }
    }

    const userShowId = userShow?.id ?? (await createShowOnList('watching'));
    if (!userShowId) return;
    try {
      setStatusBusy(true);
      await applyProgress(userShowId, watched, extra, nextFloor);
    } catch (e) {
      console.warn('Failed to set start season', e);
    } finally {
      setStatusBusy(false);
    }
  }

  function extraShowMeta(): Record<string, unknown> {
    const extra: Record<string, unknown> = {};
    if (show?.original_language) extra.tmdbOriginalLanguage = show.original_language;
    const episodeRuntime = show ? averageEpisodeRuntime(show.episode_run_time) : null;
    if (episodeRuntime != null) extra.episodeRuntime = episodeRuntime;
    return extra;
  }

  async function markShowUpToDate(markOlder: boolean) {
    if (!user) return;
    const watched = new Set(
      watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
    );
    const extra = extraShowMeta();

    if (markOlder) {
      const toAdd = await collectAllAiredUnwatched();
      await writeWatched(toAdd);
      for (const item of toAdd) watched.add(`${item.season}x${item.ep}`);
      extra.trackFromSeason = null;
      extra.trackFromEpisode = null;
      const userShowId = userShow?.id ?? (await createShowOnList('upToDate'));
      if (!userShowId) return;
      await applyProgress(userShowId, watched, extra, null);
      return;
    }

    let floor = deriveTrackFrom(watched, userShow?.nextSeasonNum as number | undefined);
    if (!floor) {
      const aired = await collectAllAiredUnwatched();
      const last = aired[aired.length - 1];
      if (last) floor = { season: last.season, episode: last.ep + 1 };
    }
    if (floor) {
      extra.trackFromSeason = floor.season;
      extra.trackFromEpisode = floor.episode;
    }
    const userShowId = userShow?.id ?? (await createShowOnList('upToDate'));
    if (!userShowId) return;
    await applyProgress(userShowId, watched, extra, floor);
  }

  async function olderSeasonsHaveUnwatched(): Promise<boolean> {
    const run =
      trackFromOf(userShow) ??
      deriveTrackFrom(watchedSet, userShow?.nextSeasonNum as number | undefined);
    if (!run) {
      const aired = await collectAllAiredUnwatched();
      return aired.length > 0;
    }
    for (const s of seasonMeta) {
      if (s.season_number <= 0 || s.season_number > run.season) continue;
      const eps = await ensureSeason(s.season_number);
      const gap = eps.some(
        ep =>
          epAvailable(ep) &&
          !watchedSet.has(`${s.season_number}x${ep.episode_number}`) &&
          (s.season_number < run.season || ep.episode_number < run.episode)
      );
      if (gap) return true;
    }
    return false;
  }

  async function setEarlyAccessDays(next: number) {
    if (!user) return;
    const days = clampEarlyAccessDays(next);
    if (days === daysEarly && userShow) return;
    const userShowId = userShow?.id ?? (await createShowOnList('watching'));
    if (!userShowId) return;
    const watched = new Set(
      watchedEps.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
    );
    try {
      const progress = await findProgressFromTmdb(
        showId,
        watched,
        1,
        days,
        trackFromOf(userShow),
        progressHints(watched)
      );
      await db.transact([
        db.tx.userShows[userShowId].update({
          ...progressUpdates(progress),
          earlyAccessDays: days,
        }),
      ]);
    } catch (e) {
      console.warn('Failed to set early access days', e);
      await db.transact([db.tx.userShows[userShowId].update({ earlyAccessDays: days })]);
    }
  }

  async function setStatus(status: ShowStatus) {
    if (!user || statusBusy) return;
    if (status === 'upToDate') {
      setStatusBusy(true);
      try {
        const ask = await olderSeasonsHaveUnwatched();
        let markOlder = true;
        if (ask) {
          const markEarlier = await askConfirm(
            'Mark older seasons as watched?',
            'You are caught up, but earlier seasons are not fully checked. Mark those as watched too? Choose No to leave them open and keep this show off Continue watching until a new episode airs.',
            'Yes',
            'No'
          );
          if (markEarlier === 'cancel') return;
          markOlder = markEarlier === true;
        }
        await markShowUpToDate(markOlder);
      } catch (e) {
        console.warn('Failed to mark show up to date', e);
      } finally {
        setStatusBusy(false);
      }
      return;
    }
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
            startSeason: trackFromOf(userShow)?.season ?? 1,
            originalLanguage: show?.original_language ?? undefined,
            daysEarly,
            trackFrom: trackFromOf(userShow),
            watchedHints: watchedHintsFromRows(watchedEps),
          });
        } catch (e) {
          console.warn('Failed to activate watching', e);
          await db.transact([db.tx.userShows[userShow.id].update({ status })]);
        }
        return;
      }
      await db.transact([db.tx.userShows[userShow.id].update({ status })]);
    } else if (show) {
      const entityId = await createShowOnList(status);
      if (!entityId) return;
      const episodeRuntime = averageEpisodeRuntime(show.episode_run_time);
      findProgressFromTmdb(show.id, new Set(), 1, daysEarly)
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
              {seasonMeta.length ? (
                <Text style={styles.metaText}>
                  {seasonMeta.length}{' '}
                  {seasonMeta.length === 1 ? 'season' : 'seasons'}
                </Text>
              ) : show.number_of_seasons ? (
                <Text style={styles.metaText}>
                  {show.number_of_seasons}{' '}
                  {show.number_of_seasons === 1 ? 'season' : 'seasons'}
                </Text>
              ) : null}
            </View>
            {imdbId || mazeUrl ? (
              <View style={styles.metaRow}>
                {imdbId ? (
                  <TouchableOpacity
                    onPress={() =>
                      WebBrowser.openBrowserAsync(`https://www.imdb.com/title/${imdbId}/`)
                    }
                    accessibilityRole="link"
                    accessibilityLabel="Open IMDb"
                  >
                    <Text style={styles.sourceLink}>IMDb</Text>
                  </TouchableOpacity>
                ) : null}
                {mazeUrl ? (
                  <TouchableOpacity
                    onPress={() => WebBrowser.openBrowserAsync(mazeUrl)}
                    accessibilityRole="link"
                    accessibilityLabel="Open TVmaze"
                  >
                    <Text style={styles.sourceLink}>TVmaze</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
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
                disabled={statusBusy}
                style={[
                  styles.statusBtn,
                  userShow?.status === key &&
                    (key === 'finished' ? styles.statusBtnDone : styles.statusBtnActive),
                  statusBusy && styles.statusBtnBusy,
                ]}
                onPress={() => setStatus(key)}
              >
                {statusBusy && key === 'upToDate' ? (
                  <ActivityIndicator color={theme.accent} size="small" />
                ) : (
                  <Text
                    style={[
                      styles.statusBtnText,
                      userShow?.status === key && styles.statusBtnTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.earlyRow}>
            <Text style={styles.earlyLabel}>Start from</Text>
            <View style={styles.startFromPicker}>
              <SearchableDropdown
                value={String(trackFromOf(userShow)?.season ?? 1)}
                onChange={key => setStartSeason(Number(key))}
                options={seasonMeta
                  .filter(s => s.season_number > 0)
                  .map(s => ({
                    key: String(s.season_number),
                    label:
                      s.season_number === 1
                        ? `${s.name} · from the start`
                        : s.name,
                  }))}
                placeholder="Season"
                searchPlaceholder="Search seasons…"
                title="Start from season"
                emptyText="No seasons match."
                embedded
              />
            </View>
          </View>
          <View style={styles.earlyRow}>
            <Text style={styles.earlyLabel}>Watch early</Text>
            <View style={styles.earlyStepper}>
              <TouchableOpacity
                style={[styles.earlyBtn, daysEarly <= 0 && styles.earlyBtnDisabled]}
                onPress={() => setEarlyAccessDays(daysEarly - 1)}
                disabled={daysEarly <= 0}
              >
                <Text style={styles.earlyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.earlyValue}>
                {daysEarly === 1 ? '1 day' : `${daysEarly} days`}
              </Text>
              <TouchableOpacity
                style={[styles.earlyBtn, daysEarly >= 28 && styles.earlyBtnDisabled]}
                onPress={() => setEarlyAccessDays(daysEarly + 1)}
                disabled={daysEarly >= 28}
              >
                <Text style={styles.earlyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
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
              const rawEps = episodesBySeason[season.season_number];
              const eps = rawEps
                ? dedupeEpisodesByTitle(rawEps, watchedSet)
                : undefined;
              const total = eps?.length || season.episode_count || 0;
              const uniqueWatched = new Set(
                watchedEps
                  .filter(e => e.seasonNumber === season.season_number)
                  .map(e => Number(e.episodeNumber))
              );
              const watchedCount = eps
                ? eps.filter(ep => uniqueWatched.has(ep.episode_number)).length
                : uniqueWatched.size;
              const airedEps = (eps ?? []).filter(ep => epAvailable(ep));
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
                      {trackFromOf(userShow)?.season !== season.season_number ? (
                        <TouchableOpacity
                          style={styles.markAllBtn}
                          onPress={() => setStartSeason(season.season_number)}
                          accessibilityRole="button"
                          accessibilityLabel={`Start watching from ${season.name}`}
                        >
                          <Text style={styles.markAllText}>Start here</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.startHereActive}>Starting here</Text>
                      )}
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
                      const aired = epAvailable(ep);
                      const airDateLabel = formatEuropeanDate(ep.air_date);
                      const runtimeLabel = formatRuntime(ep.runtime);
                      const still = stillUrl(ep.still_path, 'w185');
                      const dateLine = !aired
                        ? airDateLabel
                          ? `Out ${airDateLabel}`
                          : 'Not out yet'
                        : airDateLabel ?? '';
                      const overview = ep.overview?.trim() ?? '';
                      const canToggleWatch = aired || watched;
                      return (
                        <View
                          key={ep.id}
                          style={[
                            styles.episodeRow,
                            watched && styles.episodeRowWatched,
                            !aired && !watched && styles.episodeRowUpcoming,
                          ]}
                        >
                          {canToggleWatch ? (
                            <TouchableOpacity
                              onPress={() =>
                                toggleEpisode(
                                  season.season_number,
                                  ep.episode_number,
                                  ep.air_date
                                )
                              }
                              activeOpacity={0.7}
                              accessibilityLabel={
                                watched ? 'Mark episode unwatched' : 'Mark episode watched'
                              }
                            >
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
                                  <EpisodeCheck watched={watched} size={22} />
                                </View>
                              </View>
                            </TouchableOpacity>
                          ) : (
                            <View
                              style={styles.epStillWrap}
                              accessibilityLabel="This episode isn't out yet"
                            >
                              {still ? (
                                <Image source={{ uri: still }} style={styles.epStill} />
                              ) : (
                                <View style={[styles.epStill, styles.epStillPlaceholder]} />
                              )}
                              <View style={styles.epStillCheck}>
                                <View style={styles.upcomingDot} />
                              </View>
                            </View>
                          )}
                          <TouchableOpacity
                            style={styles.epInfo}
                            onPress={() => openEpisodeModal(season.season_number, ep)}
                            activeOpacity={0.7}
                          >
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
                            {overview ? (
                              <Text style={styles.epOverview} numberOfLines={3}>
                                {overview}
                              </Text>
                            ) : null}
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                </View>
              );
            })}
          </View>
        )}
        {mazeUrl ? (
          <Text style={styles.attribution}>
            Extra episode dates from{' '}
            <Text
              style={styles.sourceLink}
              onPress={() => WebBrowser.openBrowserAsync(mazeUrl)}
            >
              TVmaze
            </Text>
            .
          </Text>
        ) : null}
      </ScrollView>
      <EpisodeDetailModal
        visible={episodeModal != null}
        onClose={() => setEpisodeModal(null)}
        onShowPress={() => setEpisodeModal(null)}
        showName={show?.name}
        seasonNumber={episodeModal?.season_number}
        episodeNumber={episodeModal?.episode_number}
        name={episodeModal?.name}
        airDate={episodeModal?.air_date}
        runtime={episodeModal?.runtime}
        voteAverage={episodeModal?.vote_average}
        stillPath={episodeModal?.still_path}
        overview={episodeModal?.overview}
        loading={episodeModalLoading}
      />
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
  sourceLink: {
    color: theme.sky,
    fontSize: 13,
    fontWeight: '600',
  },
  attribution: {
    color: theme.muted,
    fontSize: 12,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
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
  earlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  startFromPicker: {
    flex: 1,
    maxWidth: 220,
    alignItems: 'flex-end',
  },
  startHereActive: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  earlyLabel: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  earlyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  earlyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  earlyBtnDisabled: {
    opacity: 0.4,
  },
  earlyBtnText: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  earlyValue: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '600',
    minWidth: 64,
    textAlign: 'center',
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
  statusBtnBusy: {
    opacity: 0.6,
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
    alignItems: 'flex-start',
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
  epOverview: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
});
