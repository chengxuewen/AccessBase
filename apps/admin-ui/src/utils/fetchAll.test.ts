import { describe, expect, it, vi } from 'vitest';
import { listPermissions } from '../api/roles';
import { fetchAllPermissions } from './fetchAll';

vi.mock('../api/roles', () => ({ listPermissions: vi.fn() }));

const row = (i: number) => ({ id: `p${i}`, resource: 'perm', action: 'read' });

describe('fetchAllPermissions', () => {
  it('pages until total reached', async () => {
    vi.mocked(listPermissions)
      .mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => row(i + 1)), total: 150 })
      .mockResolvedValueOnce({ data: Array.from({ length: 50 }, (_, i) => row(i + 101)), total: 150 });
    const all = await fetchAllPermissions();
    expect(all).toHaveLength(150);
    expect(listPermissions).toHaveBeenCalledTimes(2);
  });

  it('stops at hard cap', async () => {
    vi.mocked(listPermissions).mockResolvedValue({
      data: Array.from({ length: 100 }, (_, i) => row(i + 1)),
      total: 5000,
    });
    const all = await fetchAllPermissions();
    expect(all.length).toBeLessThanOrEqual(1000);
  });
});
