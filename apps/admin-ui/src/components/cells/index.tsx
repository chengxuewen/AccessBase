import { Popconfirm, Tooltip } from 'antd';
import type { ReactNode } from 'react';

/**
 * S3.5 table-cell contract components (adjudication 2=B) — one set, every list
 * page adopts them. Shapes transcribed from the prototype (admin-console.html:
 * .u-cell/.u-av/.u-nm/.u-em :405-408, .tag/.dot :411-416, .row-actions :275-279)
 * and styled through the pack cssVars, so both packs + both themes follow by
 * cascade (contrast is locked at the token level by packs.test).
 */

const INITIALS = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Composite entity cell: 26px initials tile + title + muted mono subtitle. */
export function EntityCell({
  title,
  subtitle,
  /** plain = the prototype's `.entity-name` (no avatar) for roles/groups rows */
  plain = false,
  titleLink,
}: {
  title: string;
  subtitle?: string;
  plain?: boolean;
  titleLink?: ReactNode;
}): React.ReactNode {
  if (plain) {
    return (
      <div data-testid="entity-cell" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
        {titleLink ?? <span style={ellipsis}>{title}</span>}
      </div>
    );
  }
  return (
    <div data-testid="entity-cell" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 'var(--r4)',
          background: 'var(--sunken)',
          border: '1px solid var(--bd)',
          color: 'var(--tx2)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 'var(--fs11)',
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {INITIALS(title)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, ...ellipsis }}>{titleLink ?? title}</div>
        {subtitle ? (
          <div
            style={{
              fontSize: 'var(--fs11)',
              color: 'var(--tx3)',
              fontFamily: 'var(--mono)',
              ...ellipsis,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type Tone = 'ok' | 'danger' | 'warn' | 'info' | 'neutral';

const TONE_STYLE: Record<Tone, { background: string; color: string }> = {
  ok: { background: 'var(--ok-tint)', color: 'var(--ok-text, var(--ok))' },
  danger: { background: 'var(--danger-tint)', color: 'var(--danger-text, var(--danger))' },
  warn: { background: 'var(--warn-tint)', color: 'var(--warn-text, var(--warn))' },
  info: { background: 'var(--accent-tint)', color: 'var(--accent-text, var(--accent))' },
  neutral: { background: 'var(--sunken)', color: 'var(--tx2)' },
};

const TAG_BASE: React.CSSProperties = {
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '1px 6px',
  borderRadius: 'var(--r-tag)',
  fontSize: 'var(--fs11)',
  fontWeight: 500,
  border: '1px solid var(--bd)',
};

/** Status pill: tinted tag + 5px dot (prototype statusTag). */
export function StatusPill({ tone, label }: { tone: Tone; label: ReactNode }): React.ReactNode {
  return (
    <span data-testid="status-pill" style={{ ...TAG_BASE, ...TONE_STYLE[tone] }}>
      <span
        style={{ width: 5, height: 5, borderRadius: 'var(--r2)', background: 'currentColor', flexShrink: 0 }}
      />
      {label}
    </span>
  );
}

/** Plain chip (roles/scopes/tags) — no dot (prototype tags()). */
export function Chip({ label, tone = 'neutral' }: { label: ReactNode; tone?: Tone }): React.ReactNode {
  return (
    <span data-testid="chip" style={{ ...TAG_BASE, ...TONE_STYLE[tone] }}>
      {label}
    </span>
  );
}

export interface IconAction {
  key: string;
  icon: ReactNode;
  /** accessible name + tooltip text (e2e locates buttons by this) */
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** destructive actions keep their Popconfirm confirmation (no silent deletes) */
  popconfirm?: { title: string; okText?: string; cancelText?: string; onConfirm: () => void | Promise<void> };
}

/** 28px ghost icon actions row (prototype .row-actions). */
export function IconActions({ actions }: { actions: IconAction[] }): React.ReactNode {
  return (
    <div data-testid="icon-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
      {actions.map((a) => {
        const btn = (
          <button
            key={a.key}
            type="button"
            aria-label={a.label}
            title={a.label}
            disabled={a.disabled}
            onClick={a.popconfirm ? undefined : a.onClick}
            className="console-icon-action"
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: 'var(--r2)',
              border: '1px solid transparent',
              background: 'transparent',
              color: a.danger ? 'var(--danger)' : 'var(--tx3)',
              display: 'grid',
              placeItems: 'center',
              cursor: a.disabled ? 'not-allowed' : 'pointer',
              opacity: a.disabled ? 0.45 : 1,
            }}
          >
            {a.icon}
          </button>
        );
        return (
          <Tooltip key={a.key} title={a.label}>
            {a.popconfirm ? (
              <Popconfirm
                title={a.popconfirm.title}
                okText={a.popconfirm.okText}
                cancelText={a.popconfirm.cancelText}
                onConfirm={a.popconfirm.onConfirm}
              >
                <span>{btn}</span>
              </Popconfirm>
            ) : (
              btn
            )}
          </Tooltip>
        );
      })}
    </div>
  );
}

const ellipsis: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
