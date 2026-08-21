import type { BrandTokens, DesignTokens, ThemeConfig, ThemeMode } from './types.js';

type Listener = (config: ThemeConfig) => void;

const STORAGE_KEY = 'accessbase:theme';

// ── Safe storage access (no localStorage in Node/SSR) ────────────────────────
interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStorage(): SimpleStorage | undefined {
  try {
    const g = globalThis as unknown as { localStorage?: SimpleStorage };
    return g.localStorage;
  } catch {
    return undefined;
  }
}

function getMatchMedia(): ((query: string) => { matches: boolean }) | undefined {
  try {
    const g = globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } };
    return typeof g.matchMedia === 'function' ? g.matchMedia : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Neutral default brand — no visual identity, pure Ant Design blue.
 */
const DEFAULT_BRAND: BrandTokens = {
  primaryColor: '#1677ff',
  secondaryColor: '#52c41a',
  logo: null,
  logoCollapsed: null,
  brandName: 'AccessBase',
};

const LIGHT_TOKENS: DesignTokens = {
  colors: {
    primary: '#1677ff',
    secondary: '#52c41a',
    success: '#52c41a',
    warning: '#faad14',
    error: '#ff4d4f',
    info: '#1677ff',
    text: { primary: 'rgba(0,0,0,0.88)', secondary: 'rgba(0,0,0,0.45)', disabled: 'rgba(0,0,0,0.25)' },
    background: { default: '#f5f5f5', paper: '#ffffff', elevated: '#ffffff' },
    border: { default: '#d9d9d9', strong: '#8c8c8c' },
  },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px' },
    fontWeight: { light: 300, regular: 400, medium: 500, bold: 600 },
    lineHeight: { tight: 1.25, normal: 1.5, relaxed: 1.75 },
  },
  spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
  borderRadius: { none: '0', sm: '2px', md: '6px', lg: '8px', full: '9999px' },
  shadows: { none: 'none', sm: '0 1px 2px rgba(0,0,0,0.03)', md: '0 6px 16px rgba(0,0,0,0.08)', lg: '0 12px 40px rgba(0,0,0,0.12)' },
  transitions: { duration: { fast: '0.1s', normal: '0.2s', slow: '0.3s' }, easing: { easeIn: 'cubic-bezier(0.55,0.055,0.675,0.19)', easeOut: 'cubic-bezier(0.215,0.61,0.355,1)', easeInOut: 'cubic-bezier(0.645,0.045,0.355,1)' } },
};

const DARK_TOKENS: DesignTokens = {
  colors: {
    primary: '#1668dc',
    secondary: '#49aa19',
    success: '#49aa19',
    warning: '#d89614',
    error: '#dc4446',
    info: '#1668dc',
    text: { primary: 'rgba(255,255,255,0.88)', secondary: 'rgba(255,255,255,0.45)', disabled: 'rgba(255,255,255,0.25)' },
    background: { default: '#141414', paper: '#1f1f1f', elevated: '#262626' },
    border: { default: '#424242', strong: '#666666' },
  },
  typography: LIGHT_TOKENS.typography,
  spacing: LIGHT_TOKENS.spacing,
  borderRadius: LIGHT_TOKENS.borderRadius,
  shadows: { none: 'none', sm: '0 1px 2px rgba(0,0,0,0.2)', md: '0 6px 16px rgba(0,0,0,0.3)', lg: '0 12px 40px rgba(0,0,0,0.4)' },
  transitions: LIGHT_TOKENS.transitions,
};

/**
 * ThemeManager — light/dark switching, BrandTokens injection, localStorage persistence.
 */
export class ThemeManager {
  private mode: ThemeMode;
  private brand: BrandTokens;
  private customTokens: Partial<DesignTokens> | undefined;
  private listeners: Set<Listener> = new Set();
  private storageKey: string;

  constructor(config?: Partial<ThemeConfig>, storageKey?: string) {
    this.storageKey = storageKey ?? STORAGE_KEY;
    this.brand = { ...DEFAULT_BRAND, ...config?.brand };
    this.customTokens = config?.custom;
    this.mode = config?.mode ?? this.restorePreference();
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  setMode(mode: ThemeMode): void {
    this.mode = mode;
    this.persistPreference();
    this.emit();
  }

  toggleMode(): void {
    this.setMode(this.mode === 'light' ? 'dark' : 'light');
  }

  getDesignTokens(): DesignTokens {
    const base = this.mode === 'light' ? LIGHT_TOKENS : DARK_TOKENS;
    if (!this.customTokens) {
      return { ...base, colors: { ...base.colors, primary: this.brand.primaryColor } };
    }
    return this.deepMerge(base, this.customTokens) as DesignTokens;
  }

  /**
   * Merge custom design tokens (partial override).
   */
  mergeCustomTokens(tokens: Partial<DesignTokens>): void {
    this.customTokens = this.customTokens
      ? (this.deepMerge(this.customTokens, tokens) as Partial<DesignTokens>)
      : tokens;
    this.emit();
  }

  /**
   * Inject brand tokens (L1/L2 white-labeling).
   */
  setBrand(tokens: Partial<BrandTokens>): void {
    this.brand = { ...this.brand, ...tokens };
    this.emit();
  }

  getBrand(): BrandTokens {
    return { ...this.brand };
  }

  persistPreference(): void {
    try {
      const data: ThemeConfig = {
        mode: this.mode,
        brand: this.brand,
        custom: this.customTokens,
      };
      getStorage()?.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // SSR or storage unavailable — degrade silently
    }
  }

  restorePreference(): ThemeMode {
    try {
      const raw = getStorage()?.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw) as ThemeConfig;
        if (data.brand) this.brand = { ...DEFAULT_BRAND, ...data.brand };
        if (data.custom) this.customTokens = data.custom;
        if (data.mode === 'light' || data.mode === 'dark') return data.mode;
      }
    } catch {
      // Corrupted storage — fall through
    }
    return this.detectSystemPreference();
  }

  detectSystemPreference(): ThemeMode {
    try {
      const mm = getMatchMedia();
      if (mm?.('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {
      // SSR
    }
    return 'light';
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const config: ThemeConfig = {
      mode: this.mode,
      brand: this.brand,
      custom: this.customTokens,
    };
    for (const listener of this.listeners) {
      listener(config);
    }
  }

  /**
   * Simple recursive deep merge — target wins, source fills gaps.
   * Arrays are replaced, not concatenated.
   */
  private deepMerge(target: unknown, source: unknown): unknown {
    if (!this.isPlainObject(target) || !isPlainObject(source)) return source;
    const result: Record<string, unknown> = { ...target as Record<string, unknown> };
    for (const key of Object.keys(source as Record<string, unknown>)) {
      const srcVal = (source as Record<string, unknown>)[key];
      const tgtVal = result[key];
      if (this.isPlainObject(tgtVal) && isPlainObject(srcVal)) {
        result[key] = this.deepMerge(tgtVal, srcVal);
      } else {
        result[key] = srcVal;
      }
    }
    return result;
  }

  private isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
