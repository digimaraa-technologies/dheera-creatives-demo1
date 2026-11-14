import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  UNAUTHORIZED_EVENT,
  apiRequest,
  assetUrl,
  toQuery,
} from '../api/client';

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('sends cookies and parses JSON', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ items: [] }));

    await expect(apiRequest('/api/products')).resolves.toEqual({ items: [] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/products');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('x-csrf-token')).toBeNull();
  });

  it('echoes the CSRF cookie on state-changing requests', async () => {
    document.cookie = 'dheera_csrf=csrf-value-123; path=/';
    fetchMock.mockResolvedValue(fakeResponse({ ok: true }));

    await apiRequest('/api/admin/products', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('x-csrf-token')).toBe('csrf-value-123');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('leaves the content type to the browser for FormData uploads', async () => {
    document.cookie = 'dheera_csrf=csrf-upload; path=/';
    fetchMock.mockResolvedValue(fakeResponse({ imageUrl: '/uploads/products/a.png' }));

    const body = new FormData();
    body.append('image', new File(['x'], 'photo.png', { type: 'image/png' }));

    await apiRequest('/api/admin/uploads/products', { method: 'POST', body });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has('content-type')).toBe(false);
    expect(headers.get('x-csrf-token')).toBe('csrf-upload');
  });

  it('throws an ApiError and announces 401 responses', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ message: 'Invalid credentials' }, 401));
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);

    const request = apiRequest('/api/admin/products');
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('can skip the unauthorized event for login and session bootstrap', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ message: 'Not signed in' }, 401));
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);

    await expect(
      apiRequest('/api/auth/me', { skipUnauthorizedEvent: true }),
    ).rejects.toMatchObject({ status: 401 });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('falls back to the status when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(apiRequest('/api/admin/products')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (500)',
    });
  });
});

describe('helpers', () => {
  it('drops empty query values', () => {
    expect(
      toQuery({ page: 1, search: '', category: undefined, isActive: 'true', blank: null }),
    ).toBe('?page=1&isActive=true');
  });

  it('only prefixes local asset paths', () => {
    expect(assetUrl('/uploads/products/a.png')).toBe('/uploads/products/a.png');
    expect(assetUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
  });
});
