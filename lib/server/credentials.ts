import { InstantAPIError } from '@instantdb/admin';
import { getAdminDb } from '@/lib/server/instantAdmin';
import { withInstantRetry } from '@/lib/server/instantRetry';

type AdminDb = ReturnType<typeof getAdminDb>;

type UserRow = { id?: string; passwordHash?: string | null };

export async function findCredential(db: AdminDb, email: string) {
  try {
    const data = await withInstantRetry(() =>
      db.query({
        $users: { $: { where: { email } } },
      }),
    );
    const row = (data.$users?.[0] ?? null) as UserRow | null;
    if (!row?.passwordHash) return null;
    return { id: row.id, passwordHash: row.passwordHash };
  } catch (error) {
    console.warn('password lookup skipped', error);
    return null;
  }
}

export async function savePasswordHash(db: AdminDb, email: string, passwordHash: string) {
  const user = await withInstantRetry(() => db.auth.getUser({ email }));
  if (!user?.id) throw new Error('Could not load user');
  await withInstantRetry(() =>
    db.transact([
      db.tx.$users[user.id].update({ passwordHash }),
    ]),
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof InstantAPIError && error.body?.type === 'record-not-unique';
}
