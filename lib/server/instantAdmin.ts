import { init } from '@instantdb/admin';
import './instantRetry';

export class AuthConfigError extends Error {
  constructor() {
    super('Password sign-in is not configured');
    this.name = 'AuthConfigError';
  }
}

export function getAdminDb() {
  const appId = process.env.EXPO_PUBLIC_INSTANT_APP_ID;
  const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN;
  if (!appId || !adminToken) throw new AuthConfigError();
  // Do not pass `schema`. Instant then sets throw-on-missing-attrs, which
  // blocks creating `credentials` until a CLI schema push.
  return init({
    appId,
    adminToken,
  });
}
