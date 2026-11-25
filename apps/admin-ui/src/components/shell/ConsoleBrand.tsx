import { useTranslation } from 'react-i18next';

/**
 * S3' contract component (adjudication 1=C, G2): the sidebar brand block —
 * 26px accent logo tile (or the configured logo) + product name + tagline.
 * Styled with contract cssVars (pack-driven by cascade); collapses to the
 * tile only (prototype `.brand` / collapsed mode).
 */
export function ConsoleBrand({
  name,
  logoUrl,
  collapsed,
  /** centered = full-width block with centered content (standalone surfaces
   *  like the setup wizard — the hairline then spans the whole card) */
  centered = false,
}: {
  name: string;
  logoUrl?: string | null;
  collapsed: boolean;
  centered?: boolean;
}): React.ReactNode {
  const { t } = useTranslation();
  const initials = (name || 'AccessBase')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      data-testid="console-brand"
      style={{
        height: 'var(--top-h)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: collapsed ? '0 14px' : '0 var(--sp16)',
        borderBottom: '1px solid var(--bd-hair)',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...(centered ? { width: '100%', justifyContent: 'center' } : {}),
      }}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={name}
          style={{ width: 26, height: 26, borderRadius: 'var(--r4)', objectFit: 'contain', flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 'var(--r4)',
            background: 'var(--accent)',
            color: 'var(--txinv)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 600,
            fontSize: 'var(--fs12)',
            letterSpacing: '.02em',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
      )}
      {!collapsed && (
        <div style={{ fontWeight: 600, fontSize: 'var(--fs14)', letterSpacing: '-.01em' }}>
          {name}
          <small
            style={{
              display: 'block',
              fontWeight: 400,
              fontSize: 'var(--fs11)',
              color: 'var(--tx3)',
              letterSpacing: 0,
            }}
          >
            {t('brand.tagline')}
          </small>
        </div>
      )}
    </div>
  );
}
