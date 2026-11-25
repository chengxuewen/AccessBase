import { useMemo } from 'react';
import { useUiStore } from '../stores/ui.js';
import { PACKS } from './packs/index.js';

/**
 * S1: injects the CURRENT pack's contract cssVars as stylesheet custom
 * properties — the consumption surface for the P-5 exemption file (S2's
 * pack-vars.css references var(--r-tag)/var(--focus)/…). BOTH theme blocks
 * are injected for the active pack: toggling data-theme flips the vars by
 * cascade without re-injection.
 */
export function PackStyleVars(): React.ReactNode {
  const pack = useUiStore((s) => s.pack);
  const css = useMemo(() => {
    const def = PACKS[pack];
    const block = (vars: Record<string, string>): string =>
      Object.entries(vars)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
    return `:root[data-theme="light"]{${block(def.cssVars.light)}}:root[data-theme="dark"]{${block(def.cssVars.dark)}}`;
  }, [pack]);
  return <style data-testid="pack-style-vars">{css}</style>;
}
