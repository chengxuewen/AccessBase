import { describe, expect, test } from 'vitest';
import { landingPath } from './landing';

describe('landingPath', () => {
  test('undefined permissions (legacy backend) lands on /', () => {
    expect(landingPath(undefined)).toBe('/');
  });

  test('permissions without stats:read land on /profile', () => {
    expect(landingPath(['users:read'])).toBe('/profile');
  });

  test('stats:read lands on /', () => {
    expect(landingPath(['stats:read'])).toBe('/');
  });

  test('empty permissions land on /profile', () => {
    expect(landingPath([])).toBe('/profile');
  });
});
