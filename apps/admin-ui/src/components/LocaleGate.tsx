import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import { useEffect, useMemo } from 'react';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { resolveLang } from '../utils/locale';
import { useUiStore } from '../stores/ui';
import { PACKS } from '../theme/packs/index';
import { PackStyleVars } from '../theme/PackStyleVars';
import { useResolvedTheme } from '../theme/useConsoleTheme';

const ANT_LOCALES = { en: undefined, zh: zhCN } as const;

export function LocaleGate({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const lang = resolveLang(i18n.language);
  const resolved = useResolvedTheme();
  const pack = useUiStore((s) => s.pack);
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);
  // S1: pack axis (A-3 family) — useLayoutEffect per run-2 F5 (same-frame as
  // the antd style regen; useEffect painted the stale frame first).
  useEffect(() => {
    document.documentElement.dataset['pack'] = pack;
  }, [pack]);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  // S1: pack token merge — memo on the OBJECT (run-2 F5: a fresh literal per
  // render would re-hash the entire cssinjs cache on every unrelated render).
  const themeConfig = useMemo(() => {
    const def = PACKS[pack] ?? PACKS.ant;
    return {
      ...def.themes[resolved],
      algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    };
  }, [pack, resolved]);
  return (
    <ConfigProvider locale={ANT_LOCALES[lang]} theme={themeConfig}>
      <AntdApp>
        <PackStyleVars />
        {children}
      </AntdApp>
    </ConfigProvider>
  );
}
