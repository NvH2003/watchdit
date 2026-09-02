import db from '@/lib/db';

type AuthPath = '/api/auth/sign-in' | '/api/auth/sign-up';

export async function signInWithPassword(email: string, password: string) {
  await passwordAuth('/api/auth/sign-in', email, password);
}

export async function signUpWithPassword(email: string, password: string) {
  await passwordAuth('/api/auth/sign-up', email, password);
}

async function passwordAuth(path: AuthPath, email: string, password: string) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  let data: { token?: unknown; error?: unknown } = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Something went wrong');
  }
  if (typeof data.token !== 'string') {
    throw new Error('Something went wrong');
  }

  await db.auth.signInWithToken(data.token);
}
