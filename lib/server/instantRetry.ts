import dns from 'node:dns';
import { InstantAPIError } from '@instantdb/admin';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // ignore runtimes without this API
}

function errorBlob(error: unknown): string {
  if (error instanceof InstantAPIError) {
    const message = error.body && typeof error.body === 'object' && 'message' in error.body
      ? String(error.body.message)
      : error.message;
    return `${error.status} ${message}`.toLowerCase();
  }
  if (!(error instanceof Error)) return String(error);
  const cause = 'cause' in error && error.cause != null ? String(error.cause) : '';
  const code = 'code' in error ? String((error as { code: unknown }).code) : '';
  return `${error.message} ${cause} ${code}`.toLowerCase();
}

export function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof InstantAPIError && [408, 429, 500, 502, 503, 504].includes(error.status)) {
    return true;
  }
  return /econnreset|econnrefused|etimedout|epipe|enotfound|eai_again|socket|network|fetch failed|und_err|other side closed|econnaborted|upstream error|gateway.timeout/.test(
    errorBlob(error),
  );
}

export async function withInstantRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!isTransientNetworkError(error) || i === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (i + 1)));
    }
  }
  throw last;
}
