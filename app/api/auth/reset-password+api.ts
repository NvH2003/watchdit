import { AuthConfigError, getAdminDb } from '@/lib/server/instantAdmin';
import { authConfigResponse, jsonError } from '@/lib/server/authPayload';
import { savePasswordHash } from '@/lib/server/credentials';
import { clientAuthError } from '@/lib/server/instantError';
import { withInstantRetry } from '@/lib/server/instantRetry';
import { hashPassword } from '@/lib/server/password';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid request');
  }

  if (!body || typeof body !== 'object') {
    return jsonError(400, 'Invalid request');
  }

  const emailRaw = 'email' in body ? body.email : null;
  const codeRaw = 'code' in body ? body.code : null;
  const passwordRaw = 'password' in body ? body.password : null;

  if (
    typeof emailRaw !== 'string' ||
    typeof codeRaw !== 'string' ||
    typeof passwordRaw !== 'string'
  ) {
    return jsonError(400, 'Enter your email, code, and a new password');
  }

  const email = emailRaw.trim().toLowerCase();
  const code = codeRaw.trim();
  const password = passwordRaw;

  if (!EMAIL_RE.test(email)) return jsonError(400, 'Enter a valid email');
  if (!code) return jsonError(400, 'Enter the code from your email');
  if (password.length < MIN_PASSWORD) {
    return jsonError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  }

  try {
    const db = getAdminDb();
    await withInstantRetry(() => db.auth.verifyMagicCode(email, code));
    const passwordHash = await hashPassword(password);
    try {
      await savePasswordHash(db, email, passwordHash);
    } catch (error) {
      console.error('Could not save reset password hash', error);
      return jsonError(500, 'Could not save new password. Try again.');
    }
    const token = await withInstantRetry(() => db.auth.createToken({ email }));
    return Response.json({ token });
  } catch (e) {
    if (e instanceof AuthConfigError) return authConfigResponse();
    const message = e instanceof Error ? e.message : '';
    if (/magic|code|invalid|expired/i.test(message)) {
      return jsonError(401, 'Invalid or expired code');
    }
    return jsonError(500, clientAuthError('Could not reset password', e));
  }
}
