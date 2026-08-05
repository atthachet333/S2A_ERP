import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface HealthData {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  db: 'up' | 'down';
  version: string;
}

/**
 * ดึงสถานะระบบจาก /api/health (ผ่าน Vite proxy)
 * polling ทุก 10 วินาที (เตรียมแนวทางเดียวกับ Dashboard)
 */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get<HealthData>('/health'),
    refetchInterval: 10_000,
  });
}
