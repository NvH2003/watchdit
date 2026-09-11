import db from './db';

function errorBlob(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = 'cause' in error && error.cause != null ? String(error.cause) : '';
  const status =
    'status' in error && error.status != null ? String(error.status) : '';
  const body =
    'body' in error && error.body != null ? JSON.stringify(error.body) : '';
  return `${error.message} ${cause} ${status} ${body}`.toLowerCase();
}

export function isRetryableTransactError(error: unknown): boolean {
  const blob = errorBlob(error);
  if (/\b(408|429|500|502|503|504)\b/.test(blob)) return true;
  return /timeout|timed out|timedout|too many|rate limit|try again|gateway/.test(blob);
}

export async function transactWithRetry(
  chunks: Parameters<typeof db.transact>[0],
  attempts = 5
): Promise<Awaited<ReturnType<typeof db.transact>>> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await db.transact(chunks);
    } catch (error) {
      last = error;
      if (!isRetryableTransactError(error) || i === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** i));
    }
  }
  throw last;
}
