/**
 * toCsv — RFC4180 serialization with formula-injection guard.
 *
 * - Quote fields containing comma, quote, or CR/LF; double inner quotes.
 * - Cells starting with =, +, -, or @ get a `'` prefix (Excel/LibreOffice
 *   formula injection guard).
 * - Header row is `headers` verbatim; rows are emitted in input order.
 */
const INJECTION_PREFIX = /^[=+\-@]/;

function escapeCell(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  const guarded = INJECTION_PREFIX.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  }
  return lines.join('\r\n');
}
