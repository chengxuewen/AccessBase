import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Button, Form, Input, Modal, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  type User,
} from '../api/users';

export default function Users() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

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
      width: 120,
      render: (_, record) => [
        <a
          key="edit"
          onClick={() => {
            setEditingUser(record);
            editForm.setFieldsValue({ name: record.name });
            setEditOpen(true);
          }}
        >
          <EditOutlined /> {t('common.edit')}
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

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await createUser(values);
      message.success(t('users.createSuccess'));
      setCreateOpen(false);
      createForm.resetFields();
      actionRef.current?.reload();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(t('users.createError'));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editingUser) return;
    try {
      const values = await editForm.validateFields();
      setEditLoading(true);
      await updateUser(editingUser.id, values);
      message.success(t('users.updateSuccess'));
      setEditOpen(false);
      setEditingUser(null);
      editForm.resetFields();
      actionRef.current?.reload();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(t('users.updateError'));
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <>
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
            onClick={() => setCreateOpen(true)}
          >
            {t('users.create')}
          </Button>,
        ]}
      />

      <Modal
        title={t('users.createTitle')}
        open={createOpen}
        onOk={handleCreate}
        confirmLoading={createLoading}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="name"
            label={t('users.name')}
            rules={[{ required: true, message: t('users.nameRequired') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label={t('users.email')}
            rules={[
              { required: true, message: t('users.emailRequired') },
              { type: 'email', message: t('users.emailInvalid') },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('users.password')}
            rules={[{ required: true, message: t('users.passwordRequired') }]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('users.editTitle')}
        open={editOpen}
        onOk={handleEdit}
        confirmLoading={editLoading}
        onCancel={() => {
          setEditOpen(false);
          setEditingUser(null);
          editForm.resetFields();
        }}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label={t('users.name')}
            rules={[{ required: true, message: t('users.nameRequired') }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
