import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { id as instantId } from '@instantdb/react-native';
import db from '@/lib/db';
import ShowRowTV from '@/components/ShowRowTV';
import type { ShowStatus } from '@/lib/watchlist';
import ShowGridCard from '@/components/ShowGridCard';
import {
  hasAired,
  isFutureAirDate,
  findProgressFromTmdb,
  progressUpdates,
  remainingAfterCurrent,
  localDayKey,
  msUntilNextLocalMidnight,
  readyForWatchlist,
  readyForUpcoming,
  clampEarlyAccessDays,
  shiftAirDate,
  trackFromOf,
  upcomingAirsCaption,
  trackFromCovering,
  episodeIsAvailable,
} from '@/lib/progress';
import { episodeRuntimeMinutes } from '@/lib/stats';
import { episodeTitleKey, episodeOverviewKey, watchedHintsFromRows, watchedTitleFields } from '@/lib/catalog';
import { tmdb, formatAirsLabel } from '@/lib/tmdb';
import { theme } from '@/constants/theme';
import { uniqueByTmdbShowId, activateShowWatching } from '@/lib/userShows';
import {
  lastWatchedAt,
  watchedCount,
  sortTime,
  bucketForShow,
  inferredWatchlistBucket,
  sortWatchNext,
  sortStale,
  sortNotStarted,
  WatchlistBucket,
  UpcomingBucket,
  upcomingBucket,
  sortByAirDate,
} from '@/lib/watchlist';
import { Ionicons } from '@expo/vector-icons';
import FilterChips from '@/components/FilterChips';
import SegmentTabs from '@/components/SegmentTabs';
import TabScreen from '@/components/TabScreen';
import { CollapsibleScrollView } from '@/components/TabBarCollapse';

type TabKey = 'watchlist' | 'upcoming';

type HeldCheck = { key: string; token: number };

type UndoSnapshot = {
  showId: string;
  episodeId: string | null;
  showName: string;
  /** The check was the last episode of a series that has ended. */
  finished?: boolean;
  /** Every aired episode is watched and the series continues. */
  upToDate?: boolean;
  previous: {
    lastTouchedAt: string;
    nextSeasonNum: number;
    nextEpisodeNum: number;
    nextEpisodeName: string;
    nextEpisodeAirDate: string;
    nextEpisodeStillPath: string;
    nextEpisodeRuntime: number | null;
    unwatchedAiredCount: number | null;
    remainingAiredCount: number | null;
    upcomingDropKind: string | null;
    status: string;
    keepWatching: boolean;
    statusChosen: boolean;
    trackFromSeason: number | null;
    trackFromEpisode: number | null;
  };
};

const UNDO_MS = 8000;
/** How long a finished series keeps its purple check on the list before it moves off. */
const FINISHED_HOLD_MS = 2200;

const SECTION_META: { key: WatchlistBucket; title: string }[] = [
  { key: 'watchNext', title: 'Continue watching' },
  { key: 'stale', title: "Haven't watched in a while" },
  { key: 'notStarted', title: 'Not started' },
];

const UPCOMING_SECTION_META: { key: UpcomingBucket; title: string }[] = [
  { key: 'today', title: 'Today' },
  { key: 'thisWeek', title: 'This week' },
  { key: 'nextWeek', title: 'Next week' },
  { key: 'laterThisMonth', title: 'Later this month' },
  { key: 'nextMonth', title: 'Next month' },
  { key: 'later', title: 'Later' },
];

export default function EpisodesScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('watchlist');
  const [isGrid, setIsGrid] = useState(false);
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);
  /** Show id → episode that was just checked and is still saving its next episode. */
  const [heldChecks, setHeldChecks] = useState<Record<string, HeldCheck>>({});
  const heldChecksRef = useRef<Record<string, HeldCheck>>({});
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<'all' | WatchlistBucket>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dayKey, setDayKey] = useState(() => localDayKey());

  const { user } = db.useAuth();
  const { isLoading, data } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );

  const allShows = uniqueByTmdbShowId(data?.userShows ?? []);
  const watchedEps = data?.watchedEpisodes ?? [];
  const queryReady = !user || (!isLoading && data != null);
  const checkingRef = useRef(false);
  const recategorizedRef = useRef(false);
  const checkToken = useRef(0);
  /** Show id → token of the check still saving its next episode. */
  const checksInFlight = useRef(new Map<string, number>());
  /** Show id → undo generation; any check with a lower token must stop and re-restore. */
  const undoGeneration = useRef(new Map<string, number>());

  const watchedKeysByShow = useMemo(() => {
    const byShow = new Map<number, Set<string>>();
    for (const e of watchedEps) {
      const tmdbId = e.tmdbShowId as number;
      let keys = byShow.get(tmdbId);
      if (!keys) {
        keys = new Set();
        byShow.set(tmdbId, keys);
      }
      keys.add(`${e.seasonNumber}x${e.episodeNumber}`);
    }
    return byShow;
  }, [watchedEps]);
  const lastWatchByShow = useMemo(() => {
    const byShow = new Map<number, number>();
    for (const e of watchedEps) {
      const t = new Date(e.watchedAt as string | number).getTime();
      if (!(t > 0)) continue;
      const tmdbId = e.tmdbShowId as number;
      if (t > (byShow.get(tmdbId) ?? 0)) byShow.set(tmdbId, t);
    }
    return byShow;
  }, [watchedEps]);
  const noKeys = useMemo(() => new Set<string>(), []);

  function holdCheck(showId: string, hold: HeldCheck) {
    heldChecksRef.current = { ...heldChecksRef.current, [showId]: hold };
    setHeldChecks(heldChecksRef.current);
  }

  /** Without a token, drops whatever is held for the show (undo). */
  function releaseHold(showId: string, token?: number) {
    const current = heldChecksRef.current[showId];
    if (current == null || (token != null && current.token !== token)) return;
    const { [showId]: _, ...rest } = heldChecksRef.current;
    heldChecksRef.current = rest;
    setHeldChecks(rest);
  }

  function isOnWatchlist(s: (typeof allShows)[0]) {
    const watchedKeys = watchedKeysByShow.get(s.tmdbShowId as number) ?? noKeys;
    return readyForWatchlist(
      s.status as string | undefined,
      s.nextEpisodeAirDate as string | undefined,
      {
        nextSeasonNum: s.nextSeasonNum as number | undefined,
        nextEpisodeNum: s.nextEpisodeNum as number | undefined,
        watchedKeys,
        daysEarly: clampEarlyAccessDays(s.earlyAccessDays),
        lastTouchedAt: s.lastTouchedAt as string | number | null | undefined,
      }
    );
  }

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  // Recompute air-date lists at local midnight (and after sleep/wake).
  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;
    const armMidnight = () => {
      midnightTimer = setTimeout(() => {
        setDayKey(localDayKey());
        armMidnight();
      }, msUntilNextLocalMidnight());
    };
    armMidnight();
    const poll = setInterval(() => {
      const key = localDayKey();
      setDayKey(prev => (prev === key ? prev : key));
    }, 60_000);
    return () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      clearInterval(poll);
    };
  }, []);

  async function refreshedProgress(show: (typeof allShows)[0]) {
    const tmdbId = show.tmdbShowId as number;
    const rows = watchedEps.filter(e => e.tmdbShowId === tmdbId);
    const watched = new Set(rows.map(e => `${e.seasonNumber}x${e.episodeNumber}`));
    const progress = await findProgressFromTmdb(
      tmdbId,
      watched,
      (show.nextSeasonNum as number | undefined) ?? 1,
      clampEarlyAccessDays(show.earlyAccessDays),
      trackFromOf(show),
      watchedHintsFromRows(rows)
    );
    const updates = progressUpdates(progress);
    if (
      (updates.nextEpisodeNum == null || updates.nextSeasonNum == null) &&
      show.nextEpisodeNum != null &&
      !watched.has(`${show.nextSeasonNum}x${show.nextEpisodeNum}`)
    ) {
      updates.nextSeasonNum = show.nextSeasonNum;
      updates.nextEpisodeNum = show.nextEpisodeNum;
      updates.nextEpisodeName = show.nextEpisodeName ?? '';
      updates.nextEpisodeAirDate = show.nextEpisodeAirDate ?? '';
      updates.nextEpisodeStillPath = show.nextEpisodeStillPath ?? '';
      updates.nextEpisodeRuntime = show.nextEpisodeRuntime ?? null;
    }
    if (show.keepWatching === true && updates.status === 'upToDate') {
      updates.status = 'watching';
    } else if (
      show.status === 'watching' &&
      show.keepWatching !== true &&
      show.statusChosen !== true
    ) {
      const bucket = inferredWatchlistBucket(show, watched.size, lastWatchedAt(rows, tmdbId));
      if (bucket !== 'watchNext') updates.status = bucket;
    }
    return updates;
  }

  // Recategorize imported/stale shows: watching vs up to date vs finished.
  useFocusEffect(
    useCallback(() => {
      if (!user || checkingRef.current) return;
      const toCheck = allShows.filter(s => {
        if (
          s.status === 'watchLater' ||
          s.status === 'finished' ||
          s.status === 'notStarted' ||
          s.status === 'stale'
        ) {
          return false;
        }
        const air = s.nextEpisodeAirDate as string | undefined;
        const season = s.nextSeasonNum as number | undefined;
        const ep = s.nextEpisodeNum as number | undefined;
        const tmdbId = s.tmdbShowId as number;
        const nextWatched =
          season != null &&
          ep != null &&
          Boolean(watchedKeysByShow.get(tmdbId)?.has(`${season}x${ep}`));
        // Stale next pointer or newly aired upToDate — refresh from TMDB.
        if (nextWatched) return true;
        if (s.status === 'upToDate' && hasAired(air, clampEarlyAccessDays(s.earlyAccessDays))) return true;
        // No known future episode — TMDB may have published a new one.
        if (s.status === 'upToDate' && !isFutureAirDate(air, clampEarlyAccessDays(s.earlyAccessDays))) return true;
        // Need next-episode runtime on To watch without opening the show.
        const nextRt = Number(s.nextEpisodeRuntime);
        if (
          (s.status === 'watching' || s.status === 'upToDate') &&
          season != null &&
          ep != null &&
          !(Number.isFinite(nextRt) && nextRt > 0)
        ) {
          return true;
        }
        if (
          s.status === 'upToDate' &&
          isFutureAirDate(air, clampEarlyAccessDays(s.earlyAccessDays)) &&
          s.upcomingDropKind !== 'season' &&
          s.upcomingDropKind !== 'episode'
        ) {
          return true;
        }
        if (!recategorizedRef.current) return true;
        return s.status === 'watching' && s.remainingAiredCount == null;
      });
      if (toCheck.length === 0) return;

      checkingRef.current = true;
      let cancelled = false;

      (async () => {
        try {
          for (let i = 0; i < toCheck.length; i++) {
            if (cancelled) return;
            const show = toCheck[i];
            if (checksInFlight.current.has(show.id)) continue;
            if (i > 0 && i % 5 === 0) {
              await new Promise(r => setTimeout(r, 400));
            }
            try {
              const updates = await refreshedProgress(show);
              if (cancelled) return;
              // A check that started meanwhile writes its own, newer next episode.
              if (checksInFlight.current.has(show.id)) continue;
              await db.transact([db.tx.userShows[show.id].update(updates)]);
            } catch (e) {
              console.warn('Failed to refresh show progress', show.tmdbShowName, e);
            }
          }
          recategorizedRef.current = true;
        } catch (e) {
          console.warn('Failed to recategorize shows', e);
        } finally {
          checkingRef.current = false;
        }
      })();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, allShows.length, watchedEps.length, dayKey])
  );

  const watchlistShows = allShows.filter(s => isOnWatchlist(s));
  const upcomingShows = allShows.filter(s => {
    const watchedKeys = watchedKeysByShow.get(s.tmdbShowId as number) ?? noKeys;
    return readyForUpcoming(
      s.status as string | undefined,
      s.nextEpisodeAirDate as string | undefined,
      {
        nextSeasonNum: s.nextSeasonNum as number | undefined,
        nextEpisodeNum: s.nextEpisodeNum as number | undefined,
        watchedKeys,
        daysEarly: clampEarlyAccessDays(s.earlyAccessDays),
      }
    );
  });

  const sections = useMemo(() => {
    const lastOf = (show: (typeof allShows)[0]) =>
      lastWatchByShow.get(show.tmdbShowId as number) ?? null;

    const buckets: Record<WatchlistBucket, typeof allShows> = {
      watchNext: [],
      stale: [],
      notStarted: [],
    };

    for (const show of watchlistShows) {
      const tmdbId = show.tmdbShowId as number;
      const bucket = bucketForShow(show, watchedKeysByShow.get(tmdbId)?.size ?? 0, lastOf(show));
      buckets[bucket].push(show);
    }

    return SECTION_META.map(({ key, title }) => ({
      key,
      title,
      data:
        key === 'watchNext'
          ? sortWatchNext(buckets[key], lastOf)
          : key === 'stale'
            ? sortStale(buckets[key], lastOf)
            : sortNotStarted(buckets[key], lastOf),
    })).filter(s => s.data.length > 0);
  }, [watchlistShows, watchedKeysByShow, lastWatchByShow, allShows, dayKey]);

  const upcomingSections = useMemo(() => {
    const airOf = (show: (typeof allShows)[0]) =>
      shiftAirDate(
        show.nextEpisodeAirDate as string | undefined,
        clampEarlyAccessDays(show.earlyAccessDays)
      );

    const buckets: Record<UpcomingBucket, typeof allShows> = {
      today: [],
      thisWeek: [],
      nextWeek: [],
      laterThisMonth: [],
      nextMonth: [],
      later: [],
    };

    for (const show of upcomingShows) {
      buckets[upcomingBucket(airOf(show))].push(show);
    }

    return UPCOMING_SECTION_META.map(({ key, title }) => ({
      key,
      title,
      data: sortByAirDate(buckets[key], airOf),
    })).filter(s => s.data.length > 0);
  }, [upcomingShows, allShows, dayKey]);

  function getWatchedCount(showId: number) {
    return watchedKeysByShow.get(showId)?.size ?? 0;
  }

  function getRemainingCount(show: (typeof allShows)[0]) {
    const plus = show.remainingAiredCount as number | undefined;
    if (plus != null) return Math.max(0, plus);
    const stored = show.unwatchedAiredCount as number | undefined;
    if (stored != null) return remainingAfterCurrent(stored);
    const total = (show.totalEpisodes as number | undefined) ?? 0;
    const watched = getWatchedCount(show.tmdbShowId as number);
    return remainingAfterCurrent(Math.max(0, total - watched));
  }

  async function handleStatusChange(showId: string, status: ShowStatus) {
    const show = allShows.find(s => s.id === showId);
    if (status === 'watching' && show) {
      const tmdbId = show.tmdbShowId as number;
      const rows = watchedEps.filter(e => e.tmdbShowId === tmdbId);
      const watchedKeys = new Set(
        rows.map(e => `${e.seasonNumber}x${e.episodeNumber}`)
      );
      try {
        await activateShowWatching({
          userShowId: showId,
          tmdbShowId: tmdbId,
          watchedKeys,
          fromWatchLater: show.status === 'watchLater',
          startSeason: trackFromOf(show)?.season ?? 1,
          originalLanguage: (show.tmdbOriginalLanguage as string | undefined) || undefined,
          daysEarly: clampEarlyAccessDays(show.earlyAccessDays),
          trackFrom: trackFromOf(show),
          watchedHints: watchedHintsFromRows(rows),
        });
        return;
      } catch (e) {
        console.warn('Failed to activate watching', e);
      }
    }
    await db.transact([db.tx.userShows[showId].update({ status, keepWatching: false })]);
  }

  async function handleRemove(showId: string) {
    await db.transact([db.tx.userShows[showId].delete()]);
  }

  async function handleCheck(show: (typeof allShows)[0]) {
    if (!user) return;
    if (!isOnWatchlist(show)) return;
    const sId = show.id;
    const tmdbId = show.tmdbShowId as number;
    const curSeason = (show.nextSeasonNum as number | undefined) ?? 1;
    const curEpisode = (show.nextEpisodeNum as number | undefined) ?? 1;
    const previousSortIso = new Date(
      sortTime(show, lastWatchByShow.get(tmdbId) ?? null)
    ).toISOString();
    const previousFloor = trackFromCovering(trackFromOf(show), curSeason, curEpisode);
    const previous = {
      lastTouchedAt: previousSortIso,
      nextSeasonNum: curSeason,
      nextEpisodeNum: curEpisode,
      nextEpisodeName: (show.nextEpisodeName as string | undefined) ?? '',
      nextEpisodeAirDate: (show.nextEpisodeAirDate as string | undefined) ?? '',
      nextEpisodeStillPath: (show.nextEpisodeStillPath as string | undefined) ?? '',
      nextEpisodeRuntime: (show.nextEpisodeRuntime as number | undefined) ?? null,
      unwatchedAiredCount: (show.unwatchedAiredCount as number | undefined) ?? null,
      remainingAiredCount: (show.remainingAiredCount as number | undefined) ?? null,
      upcomingDropKind: (show.upcomingDropKind as string | undefined) ?? null,
      status: (show.status as string) ?? 'watching',
      keepWatching: show.keepWatching === true,
      statusChosen: show.statusChosen === true,
      trackFromSeason: previousFloor?.season ?? null,
      trackFromEpisode: previousFloor?.episode ?? null,
    };

    const now = new Date().toISOString();
    const epKey = `${curSeason}x${curEpisode}`;
    if (heldChecksRef.current[sId]?.key === epKey) return;
    const token = ++checkToken.current;
    checksInFlight.current.set(sId, token);
    const release = () => {
      if (checksInFlight.current.get(sId) === token) checksInFlight.current.delete(sId);
      releaseHold(sId, token);
    };
    holdCheck(sId, { key: epKey, token });
    const alreadyWatched = watchedEps.find(
      e => e.tmdbShowId === tmdbId && e.seasonNumber === curSeason && e.episodeNumber === curEpisode
    );
    const episodeId = alreadyWatched ? null : instantId();
    const episodeName = (show.nextEpisodeName as string | undefined) ?? '';

    try {
      await db.transact([
        ...(episodeId
          ? [
              db.tx.watchedEpisodes[episodeId].update({
                tmdbShowId: tmdbId,
                seasonNumber: curSeason,
                episodeNumber: curEpisode,
                watchedAt: now,
                ...watchedTitleFields(episodeName, ''),
              }).link({ $user: user.id }),
            ]
          : []),
        db.tx.userShows[sId].update({
          status: 'watching',
          keepWatching: true,
          statusChosen: true,
          lastTouchedAt: now,
          ...(previousFloor
            ? { trackFromSeason: previousFloor.season, trackFromEpisode: previousFloor.episode }
            : {}),
        }),
      ]);
    } catch (e) {
      release();
      throw e;
    }
    setUndo({
      showId: sId,
      episodeId,
      showName: show.tmdbShowName as string,
      previous,
    });

    try {
      const daysEarly = clampEarlyAccessDays(show.earlyAccessDays);
      let episodeRuntime: number | null = episodeRuntimeMinutes(
        show.nextEpisodeRuntime as number | undefined
      );
      let resolvedName = episodeName;
      let episodeOverview = '';
      let seasonEps: Awaited<ReturnType<typeof tmdb.getSeason>>['episodes'] = [];
      try {
        const season = await tmdb.getSeason(tmdbId, curSeason);
        seasonEps = season.episodes ?? [];
        const ep = seasonEps.find(e => e.episode_number === curEpisode);
        episodeRuntime = episodeRuntimeMinutes(ep?.runtime) ?? episodeRuntime;
        if (ep?.name) resolvedName = ep.name;
        if (ep?.overview) episodeOverview = ep.overview;
      } catch {
        episodeRuntime = episodeRuntime ?? episodeRuntimeMinutes(show.episodeRuntime as number | undefined);
      }
      const undone = () => {
        const gen = undoGeneration.current.get(sId);
        return gen != null && token < gen;
      };
      const superseded = () => checksInFlight.current.get(sId) !== token || undone();
      async function abortIfStale(): Promise<boolean> {
        if (!superseded()) return false;
        if (undone()) {
          const current = checksInFlight.current.get(sId);
          const gen = undoGeneration.current.get(sId);
          // Only re-restore when nothing newer owns the row.
          if (current == null || current === gen) {
            await db.transact([
              db.tx.userShows[sId].update({
                lastTouchedAt: previous.lastTouchedAt,
                nextSeasonNum: previous.nextSeasonNum,
                nextEpisodeNum: previous.nextEpisodeNum,
                nextEpisodeName: previous.nextEpisodeName,
                nextEpisodeAirDate: previous.nextEpisodeAirDate,
                nextEpisodeStillPath: previous.nextEpisodeStillPath,
                nextEpisodeRuntime: previous.nextEpisodeRuntime,
                unwatchedAiredCount: previous.unwatchedAiredCount,
                remainingAiredCount: previous.remainingAiredCount,
                upcomingDropKind: previous.upcomingDropKind,
                status: previous.status,
                keepWatching: previous.keepWatching,
                statusChosen: previous.statusChosen,
                trackFromSeason: previous.trackFromSeason,
                trackFromEpisode: previous.trackFromEpisode,
              }),
            ]);
          }
        }
        return true;
      }
      if (await abortIfStale()) return;

      const rows = watchedEps.filter(e => e.tmdbShowId === tmdbId);
      const watched = new Set(rows.map(e => `${e.seasonNumber}x${e.episodeNumber}`));
      watched.add(`${curSeason}x${curEpisode}`);
      const hints = [
        ...watchedHintsFromRows(rows).filter(
          hint => hint.season !== curSeason || hint.ep !== curEpisode
        ),
        {
          season: curSeason,
          ep: curEpisode,
          titleKey: episodeTitleKey(resolvedName) || undefined,
          overviewKey: episodeOverviewKey(episodeOverview) || undefined,
        },
      ];

      // Advance from this season first so the row moves before the full catalog scan.
      const airedLater = seasonEps
        .filter(
          e =>
            e.season_number > 0 &&
            e.episode_number > curEpisode &&
            !watched.has(`${curSeason}x${e.episode_number}`) &&
            episodeIsAvailable(
              {
                airDate: e.air_date,
                stillPath: e.still_path,
                runtime: e.runtime,
                overview: e.overview,
                name: e.name,
              },
              daysEarly
            )
        )
        .sort((a, b) => a.episode_number - b.episode_number);
      const quickNext = airedLater[0];
      if (quickNext) {
        if (await abortIfStale()) return;
        const nextRuntime = episodeRuntimeMinutes(quickNext.runtime);
        await db.transact([
          ...(episodeId
            ? [
                db.tx.watchedEpisodes[episodeId].update({
                  ...(episodeRuntime != null ? { runtime: episodeRuntime } : {}),
                  ...watchedTitleFields(resolvedName, episodeOverview),
                }),
              ]
            : []),
          db.tx.userShows[sId].update({
            status: 'watching',
            keepWatching: true,
            statusChosen: true,
            lastTouchedAt: now,
            nextSeasonNum: curSeason,
            nextEpisodeNum: quickNext.episode_number,
            nextEpisodeName: quickNext.name ?? '',
            nextEpisodeAirDate: quickNext.air_date ?? '',
            nextEpisodeStillPath: quickNext.still_path ?? '',
            nextEpisodeRuntime: nextRuntime,
            unwatchedAiredCount: airedLater.length,
            remainingAiredCount: Math.max(0, airedLater.length - 1),
            ...(previousFloor
              ? {
                  trackFromSeason: previousFloor.season,
                  trackFromEpisode: previousFloor.episode,
                }
              : {}),
          }),
        ]);
        if (await abortIfStale()) return;
      }

      const progress = await findProgressFromTmdb(
        tmdbId,
        watched,
        curSeason,
        daysEarly,
        previousFloor,
        hints
      );
      if (await abortIfStale()) return;
      const updates = progressUpdates(progress);
      if (updates.status === 'watching') {
        updates.keepWatching = true;
        updates.statusChosen = true;
      }
      if (updates.status === 'upToDate') {
        updates.keepWatching = false;
        updates.statusChosen = true;
        setUndo(current =>
          current && current.showId === sId ? { ...current, upToDate: true } : current
        );
      }
      if (updates.status === 'finished') {
        updates.keepWatching = false;
        setFinishedId(sId);
        setUndo(current =>
          current && current.showId === sId ? { ...current, finished: true } : current
        );
        await new Promise(resolve => setTimeout(resolve, FINISHED_HOLD_MS));
        if (await abortIfStale()) return;
      }
      if (previousFloor) {
        updates.trackFromSeason = previousFloor.season;
        updates.trackFromEpisode = previousFloor.episode;
      }
      await db.transact([
        ...(episodeId
          ? [
              db.tx.watchedEpisodes[episodeId].update({
                ...(episodeRuntime != null ? { runtime: episodeRuntime } : {}),
                ...watchedTitleFields(resolvedName, episodeOverview),
              }),
            ]
          : []),
        db.tx.userShows[sId].update({
          ...updates,
          lastTouchedAt: now,
        }),
      ]);
      if (await abortIfStale()) return;
      setFinishedId(current => (current === sId ? null : current));
    } catch (e) {
      console.warn('Failed to advance episode', e);
    } finally {
      release();
    }
  }

  async function undoLast() {
    if (!undo) return;
    const snapshot = undo;
    const undoToken = ++checkToken.current;
    checksInFlight.current.set(snapshot.showId, undoToken);
    undoGeneration.current.set(snapshot.showId, undoToken);
    releaseHold(snapshot.showId);
    setFinishedId(current => (current === snapshot.showId ? null : current));
    setUndo(null);
    const previousFields = {
      lastTouchedAt: snapshot.previous.lastTouchedAt,
      nextSeasonNum: snapshot.previous.nextSeasonNum,
      nextEpisodeNum: snapshot.previous.nextEpisodeNum,
      nextEpisodeName: snapshot.previous.nextEpisodeName,
      nextEpisodeAirDate: snapshot.previous.nextEpisodeAirDate,
      nextEpisodeStillPath: snapshot.previous.nextEpisodeStillPath,
      nextEpisodeRuntime: snapshot.previous.nextEpisodeRuntime,
      unwatchedAiredCount: snapshot.previous.unwatchedAiredCount,
      remainingAiredCount: snapshot.previous.remainingAiredCount,
      upcomingDropKind: snapshot.previous.upcomingDropKind,
      status: snapshot.previous.status,
      keepWatching: snapshot.previous.keepWatching,
      statusChosen: snapshot.previous.statusChosen,
      trackFromSeason: snapshot.previous.trackFromSeason,
      trackFromEpisode: snapshot.previous.trackFromEpisode,
    };
    try {
      await db.transact(
        snapshot.episodeId
          ? [
              db.tx.userShows[snapshot.showId].update(previousFields),
              db.tx.watchedEpisodes[snapshot.episodeId].delete(),
            ]
          : [db.tx.userShows[snapshot.showId].update(previousFields)]
      );
      // A check write may have landed during the first restore; claim the row again.
      if (checksInFlight.current.get(snapshot.showId) === undoToken) {
        await db.transact([db.tx.userShows[snapshot.showId].update(previousFields)]);
      }
    } finally {
      if (checksInFlight.current.get(snapshot.showId) === undoToken) {
        checksInFlight.current.delete(snapshot.showId);
      }
    }
  }

  function renderShow(item: (typeof allShows)[0]) {
    if (isGrid) {
      return (
        <ShowGridCard
          key={item.id}
          name={item.tmdbShowName as string}
          posterPath={item.tmdbPosterPath as string | null}
          unwatchedCount={getRemainingCount(item)}
          watchedCount={getWatchedCount(item.tmdbShowId as number)}
          totalEpisodes={item.totalEpisodes as number | undefined}
          caption={
            activeTab === 'upcoming'
              ? upcomingAirsCaption(
                  item.upcomingDropKind as string | undefined,
                  item.nextEpisodeNum as number | undefined,
                  formatAirsLabel(
                    shiftAirDate(
                      item.nextEpisodeAirDate as string | undefined,
                      clampEarlyAccessDays(item.earlyAccessDays)
                    )
                  )
                ) ?? undefined
              : undefined
          }
          onPress={() => router.push(`/show/${item.tmdbShowId}`)}
        />
      );
    }
    return (
      <ShowRowTV
        key={item.id}
        id={item.id}
        tmdbShowId={item.tmdbShowId as number}
        name={item.tmdbShowName as string}
        posterPath={item.tmdbPosterPath as string | null}
        status={(item.status as ShowStatus) ?? 'watching'}
        originalLanguage={(item.tmdbOriginalLanguage as string | undefined) || undefined}
        nextSeasonNum={item.nextSeasonNum as number | null | undefined}
        nextEpisodeNum={item.nextEpisodeNum as number | null | undefined}
        nextEpisodeName={item.nextEpisodeName as string | null | undefined}
        nextEpisodeAirDate={item.nextEpisodeAirDate as string | null | undefined}
        nextEpisodeStillPath={item.nextEpisodeStillPath as string | null | undefined}
        nextEpisodeRuntime={item.nextEpisodeRuntime as number | null | undefined}
        episodeRuntime={item.episodeRuntime as number | null | undefined}
        remainingCount={getRemainingCount(item)}
        upcomingDropKind={item.upcomingDropKind as string | null | undefined}
        canMark={isOnWatchlist(item)}
        pendingCheck={
          heldChecks[item.id]?.key === `${item.nextSeasonNum}x${item.nextEpisodeNum}`
        }
        finished={finishedId === item.id}
        daysEarly={clampEarlyAccessDays(item.earlyAccessDays)}
        onShowPress={() => router.push(`/show/${item.tmdbShowId}`)}
        onCheckPress={() => handleCheck(item)}
        onStatusChange={handleStatusChange}
        onRemove={handleRemove}
      />
    );
  }

  const emptyCopy =
    activeTab === 'watchlist' && allShows.length === 0
      ? {
          title: 'No shows yet',
          subtitle: 'Go to Discover to add shows to your list.',
        }
      : activeTab === 'watchlist'
        ? {
            title: 'Nothing to watch',
            subtitle:
              'Caught-up shows stay on your Profile until a new episode airs.',
          }
        : {
            title: 'Nothing coming up',
            subtitle: 'New episodes with a scheduled date show up here.',
          };

  const watchlistEmpty = sections.length === 0;
  const upcomingEmpty = upcomingSections.length === 0;
  const activeSections = activeTab === 'watchlist' ? sections : upcomingSections;
  const sourceEmpty = activeTab === 'watchlist' ? watchlistEmpty : upcomingEmpty;
  const filteredSections = useMemo(
    () =>
      activeSections
        .filter(
          section =>
            activeTab !== 'watchlist' ||
            bucketFilter === 'all' ||
            section.key === bucketFilter
        )
        .filter(section => section.data.length > 0),
    [activeSections, activeTab, bucketFilter]
  );
  const listEmpty = sourceEmpty;
  const noMatches = !sourceEmpty && filteredSections.length === 0;

  return (
    <TabScreen>
      <View style={styles.topBar}>
        <SegmentTabs
          options={[
            { key: 'watchlist', label: 'To watch' },
            { key: 'upcoming', label: 'Coming up' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
        {queryReady && allShows.length > 0 && activeTab === 'watchlist' ? (
          <TouchableOpacity
            onPress={() => setFiltersOpen(open => !open)}
            style={[styles.filterBtn, (filtersOpen || bucketFilter !== 'all') && styles.filterBtnActive]}
            accessibilityRole="button"
            accessibilityLabel={filtersOpen ? 'Hide filters' : 'Show filters'}
            accessibilityState={{ expanded: filtersOpen, selected: bucketFilter !== 'all' }}
          >
            <Ionicons
              name={filtersOpen ? 'close' : 'funnel-outline'}
              size={18}
              color={filtersOpen || bucketFilter !== 'all' ? '#fff' : theme.muted}
            />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => setIsGrid(g => !g)}
          style={styles.gridToggle}
          accessibilityLabel={isGrid ? 'List view' : 'Grid view'}
        >
          <Text style={styles.gridToggleText}>{isGrid ? '≡' : '⊞'}</Text>
        </TouchableOpacity>
      </View>

      {queryReady && allShows.length > 0 && activeTab === 'watchlist' && filtersOpen ? (
        <FilterChips
          options={[
            { key: 'all', label: 'All' },
            { key: 'watchNext', label: 'Continue' },
            { key: 'stale', label: "Haven't watched" },
            { key: 'notStarted', label: 'Not started' },
          ]}
          value={bucketFilter}
          onChange={setBucketFilter}
        />
      ) : null}

      {!queryReady ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : listEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📺</Text>
          <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
          <Text style={styles.emptySubtitle}>{emptyCopy.subtitle}</Text>
          {allShows.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => router.push('/discover')}
              accessibilityRole="button"
              accessibilityLabel="Go to Discover"
            >
              <Text style={styles.emptyBtnText}>Discover shows</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : noMatches ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📺</Text>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptySubtitle}>Try a different filter.</Text>
        </View>
      ) : (
        <CollapsibleScrollView contentContainerStyle={styles.listContent}>
          {filteredSections.map(section => (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
                <Text style={styles.sectionCount}>{section.data.length}</Text>
              </View>
              {isGrid ? (
                <View style={styles.gridWrap}>
                  {section.data.map(item => renderShow(item))}
                </View>
              ) : (
                section.data.map(item => renderShow(item))
              )}
            </View>
          ))}
        </CollapsibleScrollView>
      )}

      {undo ? (
        <View style={[styles.undoBar, undo.finished && styles.undoBarFinished]}>
          {undo.finished ? (
            <View style={styles.finishedCopy}>
              <Text style={styles.finishedTitle} numberOfLines={1}>
                {undo.showName} is finished
              </Text>
              <Text style={styles.finishedText} numberOfLines={2}>
                You watched every episode. The series has ended.
              </Text>
            </View>
          ) : (
            <Text style={styles.undoText} numberOfLines={1}>
              {undo.upToDate
                ? `${undo.showName} is up to date`
                : `Marked ${undo.showName}`}
            </Text>
          )}
          <TouchableOpacity onPress={undoLast} hitSlop={8}>
            <Text style={styles.undoBtn}>Undo</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    minWidth: 0,
  },
  gridToggle: {
    padding: 10,
    flexShrink: 0,
  },
  filterBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.elevated,
    borderWidth: 1,
    borderColor: theme.border,
    flexShrink: 0,
  },
  filterBtnActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  gridToggleText: {
    color: theme.muted,
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
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: theme.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: theme.accent,
  },
  emptyBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: theme.tabBarClearance,
  },
  section: {
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionTitle: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  sectionCount: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    gap: 10,
  },
  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: theme.tabBarClearance - 8,
    backgroundColor: theme.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  undoText: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
  },
  undoBarFinished: {
    borderColor: theme.finished,
    borderLeftWidth: 4,
  },
  finishedCopy: {
    flex: 1,
    gap: 2,
  },
  finishedTitle: {
    color: theme.finished,
    fontSize: 15,
    fontWeight: '800',
  },
  finishedText: {
    color: theme.text,
    fontSize: 13,
  },
  undoBtn: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
