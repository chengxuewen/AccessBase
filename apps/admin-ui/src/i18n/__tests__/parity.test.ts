import { describe, it, expect } from 'vitest';
import en from '../locales/en.json';
import zh from '../locales/zh.json';

/** Q1-f1 (gap-audit ui C-series + Momus R6): en/zh key-set parity is now a
 * locked gate — the sync round measured 474/474 ad hoc; from here it fails CI. */
function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out.push(...flatten(v as Record<string, unknown>, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

describe('locale key parity', () => {
  it('en and zh carry identical key sets', () => {
    const enKeys = new Set(flatten(en as Record<string, unknown>));
    const zhKeys = new Set(flatten(zh as Record<string, unknown>));
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
    expect({ missingInZh, missingInEn }).toEqual({ missingInZh: [], missingInEn: [] });
  });
});
