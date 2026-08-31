import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Button, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { listUsers, deleteUser, type User } from '../api/users';

export default function Users() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);

  const columns: ProColumns<User>[] = [
    {
      title: t('users.name'),
      dataIndex: 'name',
      sorter: true,
      render: (_, record) => (
        <a onClick={() => navigate(`/users/${record.id}`)}>{record.name}</a>
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
        <a key="edit" onClick={() => navigate(`/users/${record.id}/edit`)}>
          {t('common.edit')}
        </a>,
        <Popconfirm
          key="delete"
          title={t('users.deleteConfirm')}
          onConfirm={async () => {
            try {
              await deleteUser(record.id);
              message.success(t('users.deleteSuccess'));
              actionRef.current?.reload();
            } catch {
              message.error(t('users.deleteError'));
            }
          }}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
        >
          <a style={{ color: '#ff4d4f' }}>
            <DeleteOutlined /> {t('common.delete')}
          </a>
        </Popconfirm>,
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
        const { current, pageSize, name, ...rest } = params;
        const result = await listUsers({
          page: current,
          pageSize,
          search: name,
          ...rest,
        });
        return {
          data: result.data,
          total: result.total,
          success: true,
        };
      }}
      pagination={{ defaultPageSize: 10 }}
      search={{ labelWidth: 'auto' }}
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
  );
}
