import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Input, Modal, Table, Typography } from 'antd';
import { importUsers, type ImportReport } from '../../api/users';

/**
 * Naive simple-CSV parser (R11): no quoted fields, no embedded commas or
 * newlines. Requires header line `email,name,password`. Any JSON array of
 * row objects is accepted verbatim.
 */
export function parseImportInput(text: string): Array<{ email: string; name: string; password: string }> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(
        (r): r is { email: string; name: string; password: string } =>
          typeof r === 'object' && r !== null && 'email' in r,
      );
    } catch {
      return null;
    }
  }
  // Simple CSV path
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const header = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  if (header.join(',') !== 'email,name,password') return null;
  const rows: Array<{ email: string; name: string; password: string }> = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    if (cells.length !== 3) return null; // quoted/embedded comma → invalid
    rows.push({
      email: (cells[0] ?? '').trim(),
      name: (cells[1] ?? '').trim(),
      password: (cells[2] ?? '').trim(),
    });
  }
  return rows;
}

interface ImportModalProps {
  open: boolean;
  onClose: (changed: boolean) => void;
}

/** Two-phase import modal: paste rows → Check (dry-run report) → Import (commit). */
export default function ImportUsersModal({ open, onClose }: ImportModalProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [parseError, setParseError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);

  const reset = () => {
    setText('');
    setReport(null);
    setParseError(false);
    setBusy(false);
    setCommitted(false);
  };

  const close = (changed: boolean) => {
    reset();
    onClose(changed);
  };

  const runCheck = async () => {
    setParseError(false);
    setReport(null);
    setCommitted(false);
    const rows = parseImportInput(text);
    if (!rows) {
      setParseError(true);
      return;
    }
    setBusy(true);
    try {
      setReport(await importUsers(rows, false));
    } catch {
      setReport(null);
      setParseError(true);
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    const rows = parseImportInput(text);
    if (!rows) return;
    setBusy(true);
    try {
      setReport(await importUsers(rows, true));
      setCommitted(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('users.importTitle')}
      open={open}
      onCancel={() => close(false)}
      footer={[
        <Typography.Text key="hint" type="secondary">
          {t('users.importCsvLimit')}
        </Typography.Text>,
      ]}
      width={640}
      data-testid="import-users-modal"
    >
      <Input.TextArea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('users.importPlaceholder')}
        aria-label={t('users.importRowsLabel')}
        data-testid="import-input"
      />
      <Alert
        style={{ marginTop: 8 }}
        type="info"
        showIcon
        message={t('users.importCsvLimit')}
        data-testid="import-csv-limitation"
      />
      {parseError && (
        <Alert style={{ marginTop: 8 }} type="error" showIcon message={t('users.importParseError')} />
      )}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <Button onClick={runCheck} disabled={busy} data-testid="import-check">
          {t('users.importCheck')}
        </Button>
        <Button type="primary" onClick={runCommit} disabled={busy || !report} data-testid="import-commit">
          {t('users.importCommit')}
        </Button>
      </div>
      {report && (
        <div style={{ marginTop: 12 }} data-testid="import-report">
          {report.errors.length === 0 ? (
            <Alert
              type="success"
              showIcon
              message={t(committed ? 'users.importCreated' : 'users.importValid', {
                count: committed ? (report.created ?? 0) : (report.valid ?? 0),
              })}
            />
          ) : (
            <>
              <Alert
                style={{ marginBottom: 8 }}
                type={committed ? 'warning' : 'info'}
                showIcon
                message={t(committed ? 'users.importCreated' : 'users.importValid', {
                  count: committed ? (report.created ?? 0) : (report.valid ?? 0),
                })}
              />
              <Typography.Text strong>{t('users.importRowErrors')}</Typography.Text>
              <Table
                size="small"
                rowKey={(r) => `${r.row}-${r.field}`}
                pagination={false}
                dataSource={report.errors}
                columns={[
                  { title: 'Row', dataIndex: 'row', width: 60 },
                  { title: 'Field', dataIndex: 'field', width: 100 },
                  { title: 'Message', dataIndex: 'message' },
                ].map((c) => ({ ...c, key: c.dataIndex }))}
              />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
