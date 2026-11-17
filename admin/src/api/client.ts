const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export const UNAUTHORIZED_EVENT = 'dheera:unauthorized';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  /** Login and session bootstrap expect 401; they handle it themselves. */
  skipUnauthorizedEvent?: boolean;
}

function readCookie(name: string): string | undefined {
  const row = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`));
  return row ? row.split('=').slice(1).join('=') : undefined;
}

// Production cookies use the __Host- prefix; development does not.
const CSRF_COOKIE_NAMES = ['__Host-dheera_csrf', 'dheera_csrf'];

function readCsrfToken(): string | undefined {
  for (const name of CSRF_COOKIE_NAMES) {
    const value = readCookie(name);
    if (value) return value;
  }
  return undefined;
}

export function toQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function assetUrl(imageUrl: string): string {
  return /^https?:\/\//i.test(imageUrl) ? imageUrl : `${API_BASE}${imageUrl}`;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { skipUnauthorizedEvent, ...init } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers.set('x-csrf-token', csrf);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && !skipUnauthorizedEvent) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let body: unknown;
    try {
      body = await response.json();
      const payload = body as { message?: string | string[] };
      if (Array.isArray(payload.message)) message = payload.message.join(', ');
      else if (typeof payload.message === 'string') message = payload.message;
    } catch {
      // Non-JSON error response: keep the generic status message.
    }
    throw new ApiError(message, response.status, body);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
