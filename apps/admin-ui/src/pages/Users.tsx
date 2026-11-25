import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Select } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ImportOutlined,
  ExportOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { listUsers, deleteUser, forceLogoutUser, exportUsersCsv, type User } from '../api/users';
import ImportUsersModal from './users/ImportUsersModal';
import EmptyState from '../components/EmptyState';
import { message } from '../api/feedback';
import { apiErrorMessage } from '../api/errors';
import { mapSort } from './users/sortParams';
import TenantCell from '../components/TenantCell';
import { EntityCell, StatusPill, Chip, IconActions } from '../components/cells';
import { PageHead } from '../components/shell/PageHead';
import { TableToolbar } from '../components/shell/TableToolbar';

export default function Users() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [loadError, setLoadError] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // S4 (G5/U6): inline search + meta count replace ProTable's query form/toolbar
  const [keyword, setKeyword] = useState('');
  const [total, setTotal] = useState<number>(0);
  // S4: debounce keyword → one list request per settling window (the inline
  // search replaces ProTable's submit-button form; typing must not fire N calls)
  useEffect(() => {
    const timer = setTimeout(() => actionRef.current?.reload(), 300);
    return () => clearTimeout(timer);
  }, [keyword]);
  const [statusFilter, setStatusFilter] = useState<
    'active' | 'suspended' | 'pending' | undefined
  >();

  const columns: ProColumns<User>[] = [
    {
      // S3.5 (U1): composite entity cell — initials tile + name link + mono email
      // (the prototype's `u-cell`; the standalone email column is merged in).
      title: t('users.name'),
      dataIndex: 'name',
      sorter: true,
      render: (_, record) => (
        <EntityCell
          title={record.name}
          subtitle={record.email}
          titleLink={<Link to={`/users/${record.id}`}>{record.name}</Link>}
        />
      ),
    },
    {
      // Q1-f7: the old client-side onFilter only saw the loaded page (half-wired).
      // Filtering now runs server-side via the toolbar Select (users-status-filter);
      // this column just renders the tri-state.
      title: t('users.status'),
      dataIndex: 'isActive',
      search: false,
      render: (_, record) => {
        const status = record.status ?? (record.isActive ? 'active' : 'suspended');
        const tone = status === 'active' ? 'ok' : status === 'pending' ? 'warn' : 'danger';
        const label =
          status === 'active'
            ? t('users.statusActive')
            : status === 'pending'
              ? t('users.statusPending')
              : t('users.statusSuspended');
        return <StatusPill tone={tone} label={label} />;
      },
    },
    {
      // S3.5 (U3): role chips (prototype `tags()` family). The LIST payload does
      // not carry roles today (server gap — see conformance report U3 note);
      // rows that have them render chips, others stay empty.
      title: t('users.roles'),
      dataIndex: 'roles',
      search: false,
      render: (_, record) =>
        record.roles?.length
          ? record.roles.map((r) => <Chip key={r.id} label={r.name} />)
          : null,
    },
    {
      title: t('users.tenant'),
      dataIndex: 'tenantId',
      // S10 B-lite: contract data-prio — hidden on narrow screens
      responsive: ['lg'],
      search: false,
      // Batch G5: read-only tenant slug via cached lookup; '—' when lookup
      // failed (cached failure, no retry) or tenant not in first page.
      render: (_, record) => <TenantCell tenantId={record.tenantId} />,
    },
    {
      title: t('users.createdAt'),
      dataIndex: 'createdAt',
      // S10 B-lite: contract data-prio — hidden on narrow screens
      responsive: ['xl'],
      valueType: 'dateTime',
      sorter: true,
      search: false,
    },
    {
      // S3.5 (G6): icon trio with tooltips (prototype .row-actions) — destructive
      // arms keep their Popconfirm; aria-labels keep the e2e names intact.
      title: t('users.actions'),
      valueType: 'option',
      width: 120,
      render: (_, record) => (
        <IconActions
          actions={[
            {
              key: 'edit',
              icon: <EditOutlined />,
              label: t('common.edit'),
              onClick: () => navigate(`/users/${record.id}/edit`),
            },
            {
              key: 'force-logout',
              icon: <LogoutOutlined />,
              label: t('users.forceLogout'),
              popconfirm: {
                title: t('users.forceLogoutConfirm'),
                okText: t('common.confirm'),
                cancelText: t('common.cancel'),
                onConfirm: async () => {
                  try {
                    await forceLogoutUser(record.id);
                    message.success(t('users.forceLogoutSuccess'));
                  } catch (err) {
                    message.error(apiErrorMessage(err, t('users.forceLogoutError')));
                  }
                },
              },
            },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              label: t('common.delete'),
              danger: true,
              popconfirm: {
                title: t('users.deleteConfirm'),
                okText: t('common.confirm'),
                cancelText: t('common.cancel'),
                onConfirm: async () => {
                  try {
                    await deleteUser(record.id);
                    message.success(t('users.deleteSuccess'));
                    actionRef.current?.reload();
                  } catch (err) {
                    message.error(apiErrorMessage(err, t('users.deleteError')));
                  }
                },
              },
            },
          ]}
        />
      ),
    },
  ];

  const handleRetry = () => {
    setLoadError(false);
    actionRef.current?.reload();
  };

  return (
    <>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('users.loadError')}
          action={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleRetry}
              data-testid="users-load-retry"
            >
              {t('common.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
          className="users-load-error"
          data-testid="users-load-error"
        />
      )}
      {/* S4 (G4): page head — title + subtitle + primary actions */}
      <PageHead
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={
          <>
            <Button
              key="import"
              icon={<ImportOutlined />}
              onClick={() => setImportOpen(true)}
              data-testid="users-import"
            >
              {t('users.import')}
            </Button>
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/users/create')}
            >
              {t('users.create')}
            </Button>
          </>
        }
      />
      {/* S4 (G5/U6): filter card (inline search + status) + meta row */}
      <TableToolbar
        search={{
          value: keyword,
          placeholder: t('users.searchPlaceholder'),
          onChange: setKeyword,
        }}
        filters={
          <Select
            allowClear
            placeholder={t('users.status')}
            style={{ width: 160 }}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              actionRef.current?.reload();
            }}
            options={[
              { value: 'active', label: t('users.statusActive') },
              { value: 'pending', label: t('users.statusPending') },
              { value: 'suspended', label: t('users.statusSuspended') },
            ]}
            data-testid="users-status-filter"
          />
        }
        meta={`${total}`}
        actions={
          <>
            <Button
              size="small"
              data-testid="users-reload"
              icon={<ReloadOutlined />}
              onClick={() => actionRef.current?.reload()}
            />
            <Button
              size="small"
              key="export"
              icon={<ExportOutlined />}
              onClick={() => void exportUsersCsv()}
              data-testid="users-export"
            >
              {t('users.export')}
            </Button>
          </>
        }
      />
      <ProTable<User>
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        columns={columns}
        request={async (params, sort) => {
          try {
            const { current, pageSize, sort: _paramsSort, ...rest } = params;
            const result = await listUsers({
              page: current,
              pageSize,
              search: keyword || undefined,
              ...(statusFilter ? { status: statusFilter } : {}),
              ...mapSort(sort as Record<string, 'ascend' | 'descend' | undefined>),
              ...rest,
            });
            setLoadError(false);
            setTotal(result.total ?? 0);
            return {
              data: result.data,
              total: result.total,
              success: true,
            };
          } catch {
            setLoadError(true);
            return { data: [], total: 0, success: false };
          }
        }}
        pagination={{
          defaultPageSize: 10,
          // S4 (U5): prototype `.pagination .info` — "1-10 of N" mono info
          showTotal: (n, range) => `${range[0]}-${range[1]} / ${n}`,
        }}
        search={false}
        options={false}
        toolBarRender={false}
        locale={{ emptyText: <EmptyState variant={loadError ? 'error' : 'no-data'} /> }}
      />
      <ImportUsersModal
        open={importOpen}
        onClose={(changed) => {
          setImportOpen(false);
          if (changed) actionRef.current?.reload();
        }}
      />
    </>
  );
}
