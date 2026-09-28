import { describe, it, expect } from 'vitest';
import { apiErrorCode, apiErrorMessage } from '../errors';
import type { isAxiosError } from 'axios';

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

describe('apiErrorCode (R1-T10)', () => {
  it('extracts the envelope code (AUTH_EMAIL_003 arm)', () => {
    const err = { isAxiosError: true, response: { status: 403, data: { error: { code: 'AUTH_EMAIL_003', message: 'Email address not verified' } } }, toJSON: () => ({}) };
    expect(apiErrorCode(err as never)).toBe('AUTH_EMAIL_003');
  });
  it('undefined for non-axios values and codeless envelopes', () => {
    expect(apiErrorCode(new Error('x'))).toBeUndefined();
    expect(apiErrorCode({ isAxiosError: true, response: { data: {} }, toJSON: () => ({}) } as never)).toBeUndefined();
  });
});
