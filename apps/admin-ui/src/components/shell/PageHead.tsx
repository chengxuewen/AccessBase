import type { ReactNode } from 'react';

/**
 * S4 contract component (G4): the page head — title + muted subtitle on the
 * left, primary/secondary actions on the right (prototype .page-head, admin-
 * console.html:115-116 — h1 fs20/600/-.02em, sub tx3/fs12/mt2, actions gap 8).
 * Styled with contract cssVars; pack-driven by cascade.
 */
export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}): React.ReactNode {
  return (
    <div
      data-testid="page-head"
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 'var(--sp20)',
        flexWrap: 'wrap',
        gap: 'var(--sp8)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontSize: 'var(--fs20)',
            fontWeight: 600,
            letterSpacing: '-.02em',
            margin: 0,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <div style={{ color: 'var(--tx3)', fontSize: 'var(--fs12)', marginTop: 2 }}>{subtitle}</div>
        ) : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div> : null}
    </div>
  );
}
