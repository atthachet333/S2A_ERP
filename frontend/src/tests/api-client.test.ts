import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient, ApiClientError } from '@/lib/api-client';

/** ทดสอบว่า api-client แกะ envelope (success/error) ได้ถูกต้อง */
describe('api-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('คืนค่า data เมื่อ success = true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ success: true, data: { status: 'ok' }, message: 'ok' }),
      }),
    );

    const data = await apiClient.get<{ status: string }>('/health');
    expect(data.status).toBe('ok');
  });

  it('โยน ApiClientError เมื่อ success = false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 409,
        json: async () => ({
          success: false,
          error: { code: 'INSUFFICIENT_STOCK', message: 'สต๊อกไม่พอ' },
        }),
      }),
    );

    await expect(apiClient.get('/x')).rejects.toBeInstanceOf(ApiClientError);
    await expect(apiClient.get('/x')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });
});
