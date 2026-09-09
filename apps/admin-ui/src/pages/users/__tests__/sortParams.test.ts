import { describe, expect, test } from 'vitest';
import { mapSort } from '../sortParams';

describe('mapSort', () => {
  test('maps ascend → sortBy=name&sortOrder=asc', () => {
    expect(mapSort({ name: 'ascend' })).toEqual({ sortBy: 'name', sortOrder: 'asc' });
  });

  test('maps descend → sortBy=name&sortOrder=desc', () => {
    expect(mapSort({ name: 'descend' })).toEqual({ sortBy: 'name', sortOrder: 'desc' });
  });

  test('returns {} for undefined', () => {
    expect(mapSort(undefined)).toEqual({});
  });

  test('returns {} for empty object', () => {
    expect(mapSort({})).toEqual({});
  });

  test('takes first entry when multiple columns sorted', () => {
    const result = mapSort({ createdAt: 'descend', name: 'ascend' });
    expect(result.sortBy).toBe('createdAt');
    expect(result.sortOrder).toBe('desc');
  });

  test('treats undefined/null entry value as no sort (cleared)', () => {
    expect(mapSort({ email: undefined })).toEqual({});
  });
});
