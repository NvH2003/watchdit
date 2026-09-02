import { init } from '@instantdb/react-native';
import schema from '../instant.schema';

const APP_ID = process.env.EXPO_PUBLIC_INSTANT_APP_ID ?? '';

const db = init({
  appId: APP_ID,
  schema,
  // Don't block the live connection if production is missing newer attrs (e.g. credentials).
  disableValidation: true,
});

export default db;
