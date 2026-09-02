import { InstantAPIError } from '@instantdb/admin';

export function describeInstantError(error: unknown): string {
  if (error instanceof InstantAPIError) {
    if (error.status === 504 || error.status === 502 || error.status === 503) {
      return 'Instant timed out. Try again, or use a magic code.';
    }
    const body = error.body;
    const type = body && typeof body === 'object' && 'type' in body ? String(body.type) : '';
    const message = body && typeof body === 'object' && 'message' in body ? String(body.message) : error.message;
    return type ? `${type}: ${message}` : message;
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

export function clientAuthError(fallback: string, error: unknown) {
  const detail = describeInstantError(error);
  console.error(fallback, error);
  if (typeof __DEV__ !== 'undefined' && __DEV__ && detail) {
    return `${fallback} (${detail})`;
  }
  return fallback;
}
