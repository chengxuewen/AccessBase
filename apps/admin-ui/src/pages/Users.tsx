import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Tag } from 'antd';
import client from '../api/client';

interface User {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'suspended' | 'pending';
  roles: string[];
  createdAt: string;
}

export default function Users() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType>(null);

  const columns: ProColumns<User>[] = [
    {
      title: t('users.name'),
      dataIndex: 'name',
      sorter: true,
    },
    {
      title: t('users.email'),
      dataIndex: 'email',
    },
    {
      title: t('users.status'),
      dataIndex: 'status',
      valueEnum: {
        active: { text: t('users.statusActive'), status: 'Success' },
        suspended: { text: t('users.statusSuspended'), status: 'Error' },
        pending: { text: t('users.statusPending'), status: 'Processing' },
      },
      render: (_, record) => {
        const colorMap: Record<string, string> = {
          active: 'green',
          suspended: 'red',
          pending: 'orange',
        };
        return <Tag color={colorMap[record.status]}>{record.status}</Tag>;
      },
    },
    {
      title: t('users.roles'),
      dataIndex: 'roles',
      render: (_, record) => record.roles.map((role) => <Tag key={role}>{role}</Tag>),
    },
    {
      title: t('users.createdAt'),
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      sorter: true,
    },
    {
      title: t('users.actions'),
      valueType: 'option',
      render: (_, record) => [
        <a key="edit">{t('common.edit')}</a>,
        <a key="delete" style={{ color: '#ff4d4f' }}>
          {t('common.delete')}
        </a>,
      ],
    },
  ];

  return (
    <ProTable<User>
      headerTitle={t('users.title')}
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      request={async (params) => {
        const { current, pageSize, ...rest } = params;
        const { data } = await client.get('/users', {
          params: { page: current, pageSize, ...rest },
        });
        return {
          data: data.data,
          total: data.total,
          success: true,
        };
      }}
      pagination={{ defaultPageSize: 10 }}
      search={{ labelWidth: 'auto' }}
      toolBarRender={() => [
        <a key="create" style={{ fontWeight: 500 }}>
          + {t('users.create')}
        </a>,
      ]}
    />
  );
}
