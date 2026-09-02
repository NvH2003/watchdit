const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export type AuthPayload = { email: string; password: string };

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function readAuthPayload(
  request: Request,
): Promise<{ ok: true; email: string; password: string } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, 'Invalid request') };
  }

  if (!body || typeof body !== 'object') {
    return { ok: false, response: jsonError(400, 'Invalid request') };
  }

  const emailRaw = 'email' in body ? body.email : null;
  const passwordRaw = 'password' in body ? body.password : null;
  if (typeof emailRaw !== 'string' || typeof passwordRaw !== 'string') {
    return { ok: false, response: jsonError(400, 'Enter an email and password') };
  }

  const email = emailRaw.trim().toLowerCase();
  const password = passwordRaw;
  if (!EMAIL_RE.test(email)) {
    return { ok: false, response: jsonError(400, 'Enter a valid email') };
  }
  if (password.length < MIN_PASSWORD) {
    return { ok: false, response: jsonError(400, `Password must be at least ${MIN_PASSWORD} characters`) };
  }

  return { ok: true, email, password };
}

export function authConfigResponse() {
  return jsonError(503, 'Password sign-in is not configured');
}
