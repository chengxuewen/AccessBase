import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Popconfirm, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { listUsers, deleteUser, type User } from '../api/users';
import EmptyState from '../components/EmptyState';
import { message } from '../api/feedback';
import { apiErrorMessage } from '../api/errors';
import { mapSort } from './users/sortParams';

export default function Users() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [loadError, setLoadError] = useState(false);

  const columns: ProColumns<User>[] = [
    {
      title: t('users.name'),
      dataIndex: 'name',
      sorter: true,
      render: (_, record) => (
        <Link to={`/users/${record.id}`}>{record.name}</Link>
      ),
    },
    {
      title: t('users.email'),
      dataIndex: 'email',
    },
    {
      title: t('users.status'),
      dataIndex: 'isActive',
      search: false,
      render: (_, record) => (
        <Tag color={record.isActive ? 'green' : 'red'}>
          {record.isActive ? t('users.statusActive') : t('users.statusSuspended')}
        </Tag>
      ),
    },
    {
      title: t('users.createdAt'),
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      sorter: true,
      search: false,
    },
    {
      title: t('users.actions'),
      valueType: 'option',
      width: 160,
      render: (_, record) => [
        <Button type="link" size="small" key="edit" onClick={() => navigate(`/users/${record.id}/edit`)}>
          {t('common.edit')}
        </Button>,
        <Popconfirm
          key="delete"
          title={t('users.deleteConfirm')}
          onConfirm={async () => {
            try {
              await deleteUser(record.id);
              message.success(t('users.deleteSuccess'));
              actionRef.current?.reload();
            } catch (err) {
              message.error(apiErrorMessage(err, t('users.deleteError')));
            }
          }}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
        >
          <Button type="link" size="small" danger>
            <DeleteOutlined /> {t('common.delete')}
          </Button>,
        </Popconfirm>,
      ],
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
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRetry} data-testid="users-load-retry">
              {t('common.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
          className="users-load-error"
          data-testid="users-load-error"
        />
      )}
      <ProTable<User>
        headerTitle={t('users.title')}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params, sort) => {
          try {
            const { current, pageSize, name, sort: _paramsSort, ...rest } = params;
            const result = await listUsers({
              page: current,
              pageSize,
              search: name,
              ...mapSort(sort as Record<string, 'ascend' | 'descend' | undefined>),
              ...rest,
            });
            setLoadError(false);
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
        pagination={{ defaultPageSize: 10 }}
        search={{ labelWidth: 'auto' }}
        locale={{ emptyText: <EmptyState variant={loadError ? 'error' : 'no-data'} /> }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/users/create')}
          >
            {t('users.create')}
          </Button>,
        ]}
      />
    </>
  );
}
