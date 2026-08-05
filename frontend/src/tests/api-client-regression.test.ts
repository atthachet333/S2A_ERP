import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiClientError, sessionStore } from '@/lib/api-client';

const success = <T,>(data: T, status = 200) => ({ status, json: async () => ({ success: true, data, message: 'ok' }) });
const failure = (code: string, status = 401) => ({ status, json: async () => ({ success: false, error: { code, message: code } }) });

describe('api client regression and session behavior', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it('does not send Content-Type on a bodyless GET', async () => { const fetchMock = vi.fn().mockResolvedValue(success({})); vi.stubGlobal('fetch', fetchMock); await apiClient.get('/health'); expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Content-Type'); });
  it('sends Content-Type when a JSON body exists', async () => { const fetchMock = vi.fn().mockResolvedValue(success({})); vi.stubGlobal('fetch', fetchMock); await apiClient.post('/x', { a: 1 }); expect(fetchMock.mock.calls[0][1].headers).toHaveProperty('Content-Type', 'application/json'); });
  it('sends the stored access token', async () => { sessionStore.save('access', 'refresh'); const fetchMock = vi.fn().mockResolvedValue(success({})); vi.stubGlobal('fetch', fetchMock); await apiClient.get('/auth/me'); expect(fetchMock.mock.calls[0][1].headers).toHaveProperty('Authorization', 'Bearer access'); });
  it('unwraps successful envelopes', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success({ value: 7 }))); await expect(apiClient.get('/x')).resolves.toEqual({ value: 7 }); });
  it('throws API errors with status and code', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failure('FORBIDDEN', 403))); await expect(apiClient.get('/x')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 }); });
  it('throws INTERNAL_ERROR for a non-JSON response', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 502, json: async () => { throw new Error('bad'); } })); await expect(apiClient.get('/x')).rejects.toBeInstanceOf(ApiClientError); });
  it('stores both session tokens', () => { sessionStore.save('a', 'r'); expect(sessionStore.accessToken()).toBe('a'); expect(sessionStore.refreshToken()).toBe('r'); });
  it('clears both session tokens', () => { sessionStore.save('a', 'r'); sessionStore.clear(); expect(sessionStore.accessToken()).toBeNull(); expect(sessionStore.refreshToken()).toBeNull(); });
  it('refreshes once and retries the original request', async () => { sessionStore.save('old-a', 'old-r'); const fetchMock = vi.fn().mockResolvedValueOnce(failure('UNAUTHORIZED')).mockResolvedValueOnce(success({ accessToken: 'new-a', refreshToken: 'new-r' })).mockResolvedValueOnce(success({ username: 'win' })); vi.stubGlobal('fetch', fetchMock); await expect(apiClient.get('/auth/me')).resolves.toEqual({ username: 'win' }); expect(fetchMock).toHaveBeenCalledTimes(3); expect(sessionStore.accessToken()).toBe('new-a'); });
  it('never recursively refreshes the refresh endpoint', async () => { sessionStore.save('a', 'r'); const fetchMock = vi.fn().mockResolvedValue(failure('INVALID_REFRESH_TOKEN')); vi.stubGlobal('fetch', fetchMock); await expect(apiClient.post('/auth/refresh', { refreshToken: 'r' })).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it('does not refresh when no refresh token exists', async () => { const fetchMock = vi.fn().mockResolvedValue(failure('UNAUTHORIZED')); vi.stubGlobal('fetch', fetchMock); await expect(apiClient.get('/auth/me')).rejects.toBeInstanceOf(ApiClientError); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it('uses DELETE for delete requests', async () => { const fetchMock = vi.fn().mockResolvedValue(success(null)); vi.stubGlobal('fetch', fetchMock); await apiClient.delete('/x'); expect(fetchMock.mock.calls[0][1].method).toBe('DELETE'); });
  it('serializes PATCH request bodies', async () => { const fetchMock = vi.fn().mockResolvedValue(success(null)); vi.stubGlobal('fetch', fetchMock); await apiClient.patch('/x', { enabled: true }); expect(fetchMock.mock.calls[0][1].body).toBe('{"enabled":true}'); });
  it('preserves custom request headers', async () => { const fetchMock = vi.fn().mockResolvedValue(success(null)); vi.stubGlobal('fetch', fetchMock); await apiClient.get('/x', { headers: { 'x-request-id': 'test-id' } }); expect(fetchMock.mock.calls[0][1].headers).toHaveProperty('x-request-id', 'test-id'); });
});
