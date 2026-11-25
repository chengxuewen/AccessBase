import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

/**
 * S4 contract component (G5/U6): list-page toolbar in the prototype's two-row
 * anatomy (admin-console.html:779-790, .filter-card/.toolbar.table-head):
 *   row 1 (filter card): inline search + filter controls
 *   row 2 (table meta):   count (mono/tx3) left, icon actions right
 * Inline-styled with contract cssVars (pack-driven).
 */
export function TableToolbar({
  search,
  filters,
  meta,
  actions,
}: {
  search?: {
    value?: string;
    placeholder?: string;
    onChange?: (value: string) => void;
  };
  filters?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}): React.ReactNode {
  return (
    <>
      {(search || filters) && (
        <div
          data-testid="filter-bar"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--bd)',
            borderRadius: 'var(--r6)',
            padding: '10px var(--sp16)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          {search ? (
            <Input
              allowClear
              data-testid="table-search"
              value={search.value}
              placeholder={search.placeholder}
              prefix={<SearchOutlined style={{ color: 'var(--tx3)' }} />}
              onChange={(e) => search.onChange?.(e.target.value)}
              style={{ flex: 1, maxWidth: 380 }}
            />
          ) : null}
          {filters}
        </div>
      )}
      <div
        data-testid="table-meta"
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <span
          style={{
            fontSize: 'var(--fs12)',
            color: 'var(--tx3)',
            fontFamily: 'var(--mono)',
          }}
        >
          {meta}
        </span>
        {actions ? (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{actions}</div>
        ) : null}
      </div>
    </>
  );
}
