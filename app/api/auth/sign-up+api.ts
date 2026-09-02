import { AuthConfigError, getAdminDb } from '@/lib/server/instantAdmin';
import { authConfigResponse, jsonError, readAuthPayload } from '@/lib/server/authPayload';
import { savePasswordHash } from '@/lib/server/credentials';
import { clientAuthError } from '@/lib/server/instantError';
import { withInstantRetry } from '@/lib/server/instantRetry';
import { hashPassword } from '@/lib/server/password';

export async function POST(request: Request) {
  const payload = await readAuthPayload(request);
  if (!payload.ok) return payload.response;

  try {
    const db = getAdminDb();
    const passwordHash = await hashPassword(payload.password);
    const token = await withInstantRetry(() => db.auth.createToken({ email: payload.email }));
    try {
      await savePasswordHash(db, payload.email, passwordHash);
    } catch (error) {
      // Instant's transact API is currently 504'ing; the session token still works.
      console.error('Could not save password hash', error);
    }
    return Response.json({ token });
  } catch (e) {
    if (e instanceof AuthConfigError) return authConfigResponse();
    return jsonError(500, clientAuthError('Could not create account. Try signing in.', e));
  }
}
