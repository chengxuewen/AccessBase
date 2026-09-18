/**
 * K-T1 test helper: faithful tenant filtering for mocked drizzle chains.
 *
 * Renders the SQL node the route passes to .where() via PgDialect, extracts
 * the parameter values of the "tenant_id" predicate (eq or inArray), and
 * filters fixture rows by it. Returns rows unfiltered when no tenant
 * predicate is present — so tenant-isolation tests go RED against the
 * current (unfiltered) route code and GREEN once the predicate lands.
 */
import { PgDialect } from 'drizzle-orm/pg-core/dialect';
import type { SQL } from 'drizzle-orm';

const dialect = new PgDialect();

/** Tenant ids visible under the given WHERE SQL, or null when unscoped. */
export function visibleTenants(where: unknown): Set<string> | null {
  if (where == null) return null;
  const { sql, params } = dialect.sqlToQuery(where as SQL);
  const inMatch = /"tenant_id"\s+in\s+\(([^)]*)\)/i.exec(sql);
  if (inMatch) {
    const out = new Set<string>();
    for (const m of (inMatch[1] ?? '').matchAll(/\$(\d+)/g)) {
      const v = params[Number(m[1]) - 1];
      if (typeof v === 'string') out.add(v);
    }
    return out;
  }
  const eqMatch = /"tenant_id"\s*=\s*\$(\d+)/i.exec(sql);
  if (eqMatch) {
    const v = params[Number(eqMatch[1]) - 1];
    return new Set(typeof v === 'string' ? [v] : []);
  }
  return null;
}

/** Rows whose tenantId is in the visible set (unscoped SQL returns all). */
export function filterByTenant<T extends Record<string, unknown>>(rows: T[], where: unknown): T[] {
  const visible = visibleTenants(where);
  if (visible === null) return rows;
  return rows.filter((row) => {
    const t = row['tenantId'];
    return typeof t === 'string' && visible.has(t);
  });
}
