import i18next, { type i18n, type InitOptions, type TFunction } from 'i18next';

import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };

/**
 * Supported language codes
 */
export type LanguageCode = 'en' | 'zh';

/**
 * Language info
 */
export interface Language {
  code: LanguageCode;
  name: string;
  nativeName: string;
}

/**
 * Supported languages
 */
export const SUPPORTED_LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
] as const;

/**
 * Built-in translation resources keyed by language then namespace
 */
const builtInResources: Record<string, Record<string, Record<string, unknown>>> = {
  en: { common: en },
  zh: { common: zh },
};

/**
 * i18n configuration
 */
export interface I18nConfig {
  /** Default language (default: 'zh') */
  defaultLanguage?: LanguageCode;
  /** Fallback language (default: 'en') */
  fallbackLanguage?: LanguageCode;
  /** Namespace list */
  namespaces?: string[];
  /** Default namespace */
  defaultNamespace?: string;
  /** Custom resources to merge with built-in */
  resources?: Record<string, Record<string, Record<string, unknown>>>;
  /** Additional i18next init options */
  initOptions?: Partial<InitOptions>;
}

/**
 * Create and configure an i18next instance with namespace support.
 * Follows the same pattern as createLogger() in @accessbase/logging.
 *
 * @example
 * ```ts
 * const i18n = createI18n();
 * await i18n.init();
 * const t = i18n.getFixedT(null, 'common');
 * t('common.loading'); // "加载中..."
 * ```
 */
export function createI18n(config?: I18nConfig): i18n {
  const defaultLanguage = config?.defaultLanguage ?? 'zh';
  const fallbackLanguage = config?.fallbackLanguage ?? 'en';
  const namespaces = config?.namespaces ?? ['common'];
  const defaultNamespace = config?.defaultNamespace ?? 'common';

  // Merge built-in resources with custom resources
  const resources: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const lng of [defaultLanguage, fallbackLanguage]) {
    resources[lng] = {
      ...(builtInResources[lng] ?? {}),
      ...(config?.resources?.[lng] ?? {}),
    };
  }
  // Also add any extra languages from custom resources
  if (config?.resources) {
    for (const [lng, nsMap] of Object.entries(config.resources)) {
      if (!resources[lng]) {
        resources[lng] = nsMap;
      }
    }
  }

  const instance = i18next.createInstance();

  instance.init({
    lng: defaultLanguage,
    fallbackLng: fallbackLanguage,
    ns: namespaces,
    defaultNS: defaultNamespace,
    resources,
    interpolation: {
      escapeValue: false,
    },
    ...config?.initOptions,
  });

  return instance;
}

/**
 * Re-export i18next types and core for consumers
 */
export type { i18n, TFunction, InitOptions };
export { i18next };
