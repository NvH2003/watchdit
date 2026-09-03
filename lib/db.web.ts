import { init } from '@instantdb/react';
import schema from '../instant.schema';

export const instantAppId = (process.env.EXPO_PUBLIC_INSTANT_APP_ID ?? '').trim();

const db = init({
  appId: instantAppId || '00000000-0000-0000-0000-000000000000',
  schema,
  disableValidation: true,
});

export default db;
