import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Button, DatePicker, Input, Select, Tag, Tooltip, message } from 'antd';
import { DownloadOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
// ponytail: derive date types from antd instead of importing dayjs types directly
type RangeDayjs = NonNullable<NonNullable<Parameters<NonNullable<React.ComponentProps<typeof DatePicker.RangePicker>['onChange']>>[0]>[number]>;
import { listAuditLogs, type AuditLog } from '../api/audit';

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
  const [currentRows, setCurrentRows] = useState<AuditLog[]>([]);

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

  const handleExport = () => {
    // ponytail: client-side export of the CURRENT PAGE only — server-side full export when volume demands it
    const header = ['id', 'action', 'actor', 'resource', 'ipAddress', 'status', 'createdAt'];
    const escape = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const csv = [
      header.join(','),
      ...currentRows.map((r) =>
        [r.id, r.action, r.actor ?? '', r.resource ?? '', r.ipAddress ?? '', r.status ?? '', r.createdAt]
          .map((v) => escape(String(v)))
          .join(','),
      ),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
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
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            setFilters({});
            actionRef.current?.reload();
          }}
        />
        <Tooltip title={t('audit.exportTooltip')}>
          <Button icon={<DownloadOutlined />} onClick={handleExport} className="audit-export">
            {t('audit.export')}
          </Button>
        </Tooltip>
      </div>
      <ProTable<AuditLog>
        headerTitle={t('audit.title')}
        actionRef={actionRef}
        rowKey="id"
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
            setCurrentRows(result.data);
            return { data: result.data, total: result.total, success: true };
          } catch {
            message.error(t('audit.loadError'));
            return { data: [], total: 0, success: false };
          }
        }}
        pagination={{ defaultPageSize: 10 }}
        search={false}
      />
    </>
  );
}
