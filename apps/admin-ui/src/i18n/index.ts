import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

const isBrowser = typeof navigator !== 'undefined';
const isStorage = typeof localStorage !== 'undefined';
const probed = isBrowser && navigator.language.startsWith('zh') ? 'zh' : 'en';
const raw = isStorage ? localStorage.getItem('lng') : null;
const stored = raw === 'zh' || raw === 'en' ? raw : probed;

export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: stored,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
}).then(() => i18n);

export default i18n;
