import { describe, expect, it } from 'vitest';
import { resolveLang } from './locale';

describe('resolveLang', () => {
  it('maps zh variants to zh', () => {
    expect(resolveLang('zh')).toBe('zh');
    expect(resolveLang('zh-CN')).toBe('zh');
  });
  it('defaults undefined and non-zh to en', () => {
    expect(resolveLang(undefined)).toBe('en');
    expect(resolveLang('en')).toBe('en');
    expect(resolveLang('fr')).toBe('en');
  });
});
