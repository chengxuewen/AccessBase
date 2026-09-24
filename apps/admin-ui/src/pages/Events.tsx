import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/EmptyState';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, DatePicker, Input, Modal, Tag, Tooltip, Typography } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
// ponytail: derive date types from antd instead of importing dayjs types directly
type RangeDayjs = NonNullable<NonNullable<Parameters<NonNullable<React.ComponentProps<typeof DatePicker.RangePicker>['onChange']>>[0]>[number]>;
import { listEvents, type DomainEvent } from '../api/events';

/** Tag color by event family (the catalog prefix before the dot). */
const FAMILY_COLORS: Record<string, string> = {
  user: 'blue',
  role: 'purple',
  tenant: 'geekblue',
  apikey: 'red',
  group: 'cyan',
  webhook: 'default',
};

function familyOf(type: string): string {
  return type.split('.')[0] ?? type;
}

interface FilterState {
  type?: string;
  startDate?: RangeDayjs;
  endDate?: RangeDayjs;
}

export default function Events() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType>(null);
  const [filters, setFilters] = useState<FilterState>({});
  const [loadError, setLoadError] = useState(false);
  const [detail, setDetail] = useState<DomainEvent | null>(null);

  const columns: ProColumns<DomainEvent>[] = [
    {
      title: t('events.createdAt'),
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
    },
    {
      title: t('events.type'),
      dataIndex: 'type',
      width: 180,
      render: (_, record) => <Tag color={FAMILY_COLORS[familyOf(record.type)] ?? 'default'}>{record.type}</Tag>,
    },
    {
      title: t('events.resource'),
      dataIndex: 'payload',
      ellipsis: true,
      render: (_, record) => (
        <Typography.Text code className="events-payload-cell">
          {JSON.stringify(record.payload)}
        </Typography.Text>
      ),
    },
    {
      title: t('events.fanout'),
      dataIndex: 'fanoutComplete',
      width: 140,
      render: (_, record) =>
        record.fanoutComplete ? (
          <Tag color="success">{t('events.fanoutDone')}</Tag>
        ) : (
          <Tag color="processing">{t('events.fanoutPending')}</Tag>
        ),
    },
    {
      title: t('events.detail'),
      dataIndex: 'detail',
      width: 90,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => setDetail(record)} data-testid={`events-detail-${record.id}`}>
          {t('events.view')}
        </Button>
      ),
    },
  ];

  return (
    <>
      {loadError && (
        <Alert type="error" showIcon message={t('events.loadError')} style={{ marginBottom: 16 }} data-testid="events-load-error" />
      )}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Input
          allowClear
          placeholder={t('events.filterType')}
          style={{ width: 220 }}
          value={filters.type}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value || undefined }))}
          className="events-type-filter"
        />
        <DatePicker.RangePicker
          value={filters.startDate ? [filters.startDate, filters.endDate ?? null] : null}
          onChange={(range) =>
            setFilters({
              startDate: range?.[0] ?? undefined,
              endDate: range?.[1] ?? undefined,
            })
          }
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => actionRef.current?.reload()} className="events-search">
          {t('events.search')}
        </Button>
        <Tooltip title={t('events.resetFilters')}>
          <Button
            icon={<ReloadOutlined />}
            aria-label={t('events.resetFilters')}
            onClick={() => {
              setFilters({});
              actionRef.current?.reload();
            }}
          />
        </Tooltip>
      </div>
      <ProTable<DomainEvent>
        headerTitle={t('events.title')}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        columns={columns}
        request={async (params) => {
          try {
            const result = await listEvents({
              page: params.current ?? 1,
              pageSize: params.pageSize ?? 10,
              type: filters.type,
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
          emptyText: <EmptyState variant={loadError ? 'error' : 'no-data'} />,
        }}
      />
      <Modal
        open={detail !== null}
        title={detail ? `${t('events.detailTitle')}: ${detail.type}` : ''}
        footer={null}
        onCancel={() => setDetail(null)}
        data-testid="events-detail-modal"
      >
        {detail && (
          <>
            <Typography.Paragraph>
              {t('events.createdAt')}: {new Date(detail.createdAt).toLocaleString()}
            </Typography.Paragraph>
            {detail.tenantId && (
              <Typography.Paragraph>
                {t('events.tenant')}: <Typography.Text code>{detail.tenantId}</Typography.Text>
              </Typography.Paragraph>
            )}
            <Typography.Paragraph>
              {t('events.fanout')}:{' '}
              {detail.fanoutComplete ? t('events.fanoutDone') : t('events.fanoutPending')}
            </Typography.Paragraph>
            <Typography.Paragraph strong>{t('events.payload')}</Typography.Paragraph>
            <Typography.Paragraph>
              <pre style={{ maxHeight: 320, overflow: 'auto', margin: 0 }}>
                <Typography.Text code>{JSON.stringify(detail.payload, null, 2)}</Typography.Text>
              </pre>
            </Typography.Paragraph>
          </>
        )}
      </Modal>
    </>
  );
}
