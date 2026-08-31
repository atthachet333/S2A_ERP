import { describe, expect, it } from 'vitest';
import { businessDateKey, expiryStatus } from '../src/lib/inventory-lot.js';

describe('inventory lot business dates',()=>{
  it('uses Bangkok business date and exact expiry thresholds',()=>{
    const now=new Date('2026-08-24T18:00:00.000Z');
    expect(businessDateKey(now)).toBe('2026-08-25');
    expect(expiryStatus(new Date('2026-08-24'),now)).toBe('EXPIRED');
    expect(expiryStatus(new Date('2026-08-25'),now)).toBe('EXPIRING_SOON');
    expect(expiryStatus(new Date('2026-09-01'),now)).toBe('EXPIRING_SOON');
    expect(expiryStatus(new Date('2026-09-02'),now)).toBe('GOOD');
    expect(expiryStatus(null,now)).toBe('NO_EXPIRY');
  });
});
