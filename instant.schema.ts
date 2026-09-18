import { i } from '@instantdb/core';

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
      passwordHash: i.string().optional(),
    }),
    userShows: i.entity({
      tmdbShowId: i.number().indexed(),
      tmdbShowName: i.string(),
      tmdbPosterPath: i.string().optional(),
      status: i.string(), // watching | watchLater | finished | upToDate
      addedAt: i.date(),
      totalEpisodes: i.number().optional(),
      nextSeasonNum: i.number().optional(),
      nextEpisodeNum: i.number().optional(),
      nextEpisodeName: i.string().optional(),
      nextEpisodeAirDate: i.string().optional(),
      nextEpisodeStillPath: i.string().optional(),
      /** Runtime in minutes of the next episode to watch. */
      nextEpisodeRuntime: i.number().optional(),
      unwatchedAiredCount: i.number().optional(),
      remainingAiredCount: i.number().optional(),
      /** season = new season drop; episode = a single upcoming episode. */
      upcomingDropKind: i.string().optional(),
      tvTimeSeriesId: i.number().optional(),
      lastTouchedAt: i.date().optional().indexed(),
      tmdbOriginalLanguage: i.string().optional(),
      /** Average episode length in minutes (from TMDB episode_run_time). */
      episodeRuntime: i.number().optional(),
      /** Days before TMDB air date the next episode counts as available. */
      earlyAccessDays: i.number().optional(),
      /** Ignore unwatched episodes before this S/E for status and Continue watching. */
      trackFromSeason: i.number().optional(),
      trackFromEpisode: i.number().optional(),
      ownerShowKey: i.string().unique().indexed().optional(),
    }),
    watchedEpisodes: i.entity({
      tmdbShowId: i.number().indexed(),
      seasonNumber: i.number(),
      episodeNumber: i.number(),
      watchedAt: i.date(),
      /** Exact TMDB episode runtime in minutes when known. */
      runtime: i.number().optional(),
      /** Normalized episode title so checks survive TMDB numbering remaps. */
      titleKey: i.string().optional(),
      /** Normalized synopsis; part 1 vs part 2 with the same title stay distinct. */
      overviewKey: i.string().optional(),
    }),
    userMovies: i.entity({
      tmdbMovieId: i.number().indexed(),
      tmdbMovieName: i.string(),
      tmdbPosterPath: i.string().optional(),
      status: i.string(), // watching | watchLater | finished
      addedAt: i.date(),
      watchedAt: i.date().optional(),
      lastTouchedAt: i.date().optional().indexed(),
      tmdbReleaseDate: i.string().optional(),
      runtime: i.number().optional(),
      ownerMovieKey: i.string().unique().indexed().optional(),
      /** TMDB collection id when the movie belongs to a franchise (Bond, Potter, …). */
      tmdbCollectionId: i.number().indexed().optional(),
      tmdbCollectionName: i.string().optional(),
      /** Set after we looked up collection info (even if the movie has none). */
      collectionSyncedAt: i.date().optional(),
    }),
    credentials: i.entity({
      email: i.string().unique().indexed(),
      passwordHash: i.string(),
    }),
  },
  links: {
    userShowOwner: {
      forward: { on: 'userShows', has: 'one', label: '$user' },
      reverse: { on: '$users', has: 'many', label: 'shows' },
    },
    watchedEpisodeOwner: {
      forward: { on: 'watchedEpisodes', has: 'one', label: '$user' },
      reverse: { on: '$users', has: 'many', label: 'episodes' },
    },
    userMovieOwner: {
      forward: { on: 'userMovies', has: 'one', label: '$user' },
      reverse: { on: '$users', has: 'many', label: 'movies' },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
