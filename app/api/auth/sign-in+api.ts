import { AuthConfigError, getAdminDb } from '@/lib/server/instantAdmin';
import { authConfigResponse, jsonError, readAuthPayload } from '@/lib/server/authPayload';
import { findCredential } from '@/lib/server/credentials';
import { clientAuthError } from '@/lib/server/instantError';
import { withInstantRetry } from '@/lib/server/instantRetry';
import { verifyPasswordOrDummy } from '@/lib/server/password';

export async function POST(request: Request) {
  const payload = await readAuthPayload(request);
  if (!payload.ok) return payload.response;

  try {
    const db = getAdminDb();
    const stored = (await findCredential(db, payload.email))?.passwordHash ?? null;
    const ok = await verifyPasswordOrDummy(payload.password, stored);
    if (!ok) return jsonError(401, 'Invalid email or password');

    const token = await withInstantRetry(() => db.auth.createToken({ email: payload.email }));
    return Response.json({ token });
  } catch (e) {
    if (e instanceof AuthConfigError) return authConfigResponse();
    return jsonError(500, clientAuthError('Could not sign in', e));
  }
}
