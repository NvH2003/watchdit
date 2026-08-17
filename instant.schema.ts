import { i } from '@instantdb/react-native';

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    userShows: i.entity({
      tmdbShowId: i.number().indexed(),
      tmdbShowName: i.string(),
      tmdbPosterPath: i.string().optional(),
      status: i.string(), // watching | watchLater | finished | upToDate
      addedAt: i.date(),
    }),
    watchedEpisodes: i.entity({
      tmdbShowId: i.number().indexed(),
      seasonNumber: i.number(),
      episodeNumber: i.number(),
      watchedAt: i.date(),
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
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
