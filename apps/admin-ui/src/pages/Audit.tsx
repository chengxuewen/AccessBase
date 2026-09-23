import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/EmptyState';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, DatePicker, Input, Select, Tag, Tooltip } from 'antd';
import { DownloadOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
// ponytail: derive date types from antd instead of importing dayjs types directly
type RangeDayjs = NonNullable<NonNullable<Parameters<NonNullable<React.ComponentProps<typeof DatePicker.RangePicker>['onChange']>>[0]>[number]>;
import { listAuditLogs, exportAuditLogs, type AuditLog } from '../api/audit';

// Static action filter list — audit actions follow the METHOD /path convention from the middleware
const ACTION_OPTIONS = ['POST', 'PUT', 'PATCH', 'DELETE'].map((a) => ({ label: a, value: a }));

const METHOD_COLORS: Record<string, string> = {
  POST: 'blue',
  PUT: 'orange',
  PATCH: 'purple',
  DELETE: 'red',
};

interface FilterState {
  action?: string;
  actor?: string;
  startDate?: RangeDayjs;
  endDate?: RangeDayjs;
}

export default function Audit() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType>(null);
  const [filters, setFilters] = useState<FilterState>({});
  const [loadError, setLoadError] = useState(false);

  const columns: ProColumns<AuditLog>[] = [
    {
      title: t('audit.createdAt'),
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
    },
    { title: t('audit.actor'), dataIndex: 'actor' },
    {
      title: t('audit.action'),
      dataIndex: 'action',
      render: (_, record) => {
        const method = record.action.split(' ')[0] ?? record.action;
        return <Tag color={METHOD_COLORS[method] ?? 'default'}>{record.action}</Tag>;
      },
    },
    { title: t('audit.resource'), dataIndex: 'resource' },
    { title: t('audit.ipAddress'), dataIndex: 'ipAddress' },
    {
      title: t('audit.status'),
      dataIndex: 'status',
      width: 80,
      render: (_, record) => (record.status ? String(record.status) : '-'),
    },
  ];

  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(false);

  // Q1-f6: server-side FULL export (all rows matching the filters, tenant-safe;
  // the CSV injection guard lives in the route). Replaces the old current-page-only
  // client-side builder. Errors surface as an inline Alert (no blob ever lands).
  const handleExport = async () => {
    setExportBusy(true);
    setExportError(false);
    try {
      await exportAuditLogs({
        action: filters.action,
        actor: filters.actor,
        startDate: filters.startDate?.format('YYYY-MM-DD'),
        endDate: filters.endDate?.format('YYYY-MM-DD'),
      });
    } catch {
      setExportError(true);
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('audit.loadError')}
          style={{ marginBottom: 16 }}
          className="audit-load-error"
        />
      )}
      {exportError && (
        <Alert
          type="error"
          showIcon
          message={t('audit.exportError')}
          style={{ marginBottom: 16 }}
          data-testid="audit-export-error"
        />
      )}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Select
          allowClear
          placeholder={t('audit.filterAction')}
          style={{ width: 160 }}
          options={ACTION_OPTIONS}
          value={filters.action}
          onChange={(v) => setFilters((f) => ({ ...f, action: v }))}
          className="audit-action-filter"
        />
        <Input
          allowClear
          placeholder={t('audit.filterActor')}
          style={{ width: 200 }}
          value={filters.actor}
          onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value || undefined }))}
          className="audit-actor-filter"
        />
        <DatePicker.RangePicker
          value={filters.startDate ? [filters.startDate, filters.endDate ?? null] : null}
          onChange={(range) =>
            setFilters((f) => ({ ...f, startDate: range?.[0] ?? undefined, endDate: range?.[1] ?? undefined }))
          }
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => actionRef.current?.reload()}>
          {t('audit.search')}
        </Button>
        <Tooltip title={t('audit.resetFilters')}>
          <Button
            icon={<ReloadOutlined />}
            aria-label={t('audit.resetFilters')}
            onClick={() => {
              setFilters({});
              actionRef.current?.reload();
            }}
          />
        </Tooltip>
        <Tooltip title={t('audit.exportTooltip')}>
          <Button icon={<DownloadOutlined />} onClick={handleExport} loading={exportBusy} className="audit-export">
            {t('audit.export')}
          </Button>
        </Tooltip>
      </div>
      <ProTable<AuditLog>
        headerTitle={t('audit.title')}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        columns={columns}
        request={async (params) => {
          try {
            const result = await listAuditLogs({
              page: params.current ?? 1,
              pageSize: params.pageSize ?? 10,
              action: filters.action,
              actor: filters.actor,
              startDate: filters.startDate?.format('YYYY-MM-DD'),
              endDate: filters.endDate?.format('YYYY-MM-DD'),
            });
            setLoadError(false);
            return { data: result.data, total: result.total, success: true };
          } catch {
            setLoadError(true);
            return { data: [], total: 0, success: false };
          }
        }}
        pagination={{ defaultPageSize: 10 }}
        search={false}
        locale={{
          emptyText: (
            <EmptyState
              variant={loadError ? 'error' : 'no-data'}
            />
          ),
        }}
      />
    </>
  );
}
