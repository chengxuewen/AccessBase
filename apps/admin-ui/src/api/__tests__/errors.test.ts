import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from '../errors';
import { isAxiosError } from 'axios';

describe('apiErrorMessage', () => {
  it('extracts server envelope message from axios error', () => {
    const err = { isAxiosError: true, response: { data: { error: { message: 'Role name already exists' } } },
      toJSON: () => ({}) } as unknown as Parameters<typeof isAxiosError>[0];
    expect(apiErrorMessage(err, 'fb')).toBe('Role name already exists');
  });
  it('falls back when no envelope message', () => {
    expect(apiErrorMessage(new Error('Request failed with status code 401'), 'fb')).toBe('fb');
  });
  it('falls back on 429 with hint key handled by caller', () => {
    const err = { isAxiosError: true, response: { status: 429, data: {} }, toJSON: () => ({}) };
    expect(apiErrorMessage(err as never, 'fb')).toBe('fb');
  });
});
