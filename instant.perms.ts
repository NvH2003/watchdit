import type { InstantRules } from '@instantdb/react-native';

const rules = {
  $users: {
    allow: {
      view: 'auth.id != null && auth.id == data.id',
    },
    fields: {
      passwordHash: 'false',
    },
  },
  credentials: {
    allow: {
      view: 'false',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
  },
} satisfies InstantRules;

export default rules;
