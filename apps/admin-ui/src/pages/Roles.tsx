import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Button, Form, Input, Modal, Popconfirm, Transfer } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LoadingOutlined } from '@ant-design/icons';
import EmptyState from '../components/EmptyState';
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
  type Role,
  type Permission,
} from '../api/roles';
import { message } from '../api/feedback';

export default function Roles() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType>(null);
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [targetPermissionIds, setTargetPermissionIds] = useState<string[]>([]);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);

  useEffect(() => {
    listPermissions({ page: 1, pageSize: 100 })
      .then((result) => setAllPermissions(result.data))
      .catch(() => message.error(t('roles.loadPermissionsError')));
  }, [t]);

  const openCreate = () => {
    setEditingRole(null);
    form.resetFields();
    setTargetPermissionIds([]);
    setModalOpen(true);
  };

  // B7 fix: hydrate from the detail endpoint — list rows carry no permission data
  const openEdit = async (role: Role) => {
    setEditLoadingId(role.id);
    try {
      const detail = await getRole(role.id);
      setEditingRole(detail);
      form.setFieldsValue({ name: detail.name, description: detail.description });
      setTargetPermissionIds((detail.permissions ?? []).map((p) => p.id));
      setModalOpen(true);
    } catch {
      message.error(t('roles.loadDetailError'));
    } finally {
      setEditLoadingId(null);
    }
  };

  const doSave = async (values: { name: string; description?: string }) => {
    setSaving(true);
    try {
      const payload = { ...values, permissionIds: targetPermissionIds };
      if (editingRole) {
        await updateRole(editingRole.id, payload);
        message.success(t('roles.updateSuccess'));
      } else {
        await createRole(payload);
        message.success(t('roles.createSuccess'));
      }
      setModalOpen(false);
      setEditingRole(null);
      form.resetFields();
      actionRef.current?.reload();
    } catch {
      message.error(editingRole ? t('roles.updateError') : t('roles.createError'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    let values: { name: string; description?: string };
    try {
      values = await form.validateFields();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(editingRole ? t('roles.updateError') : t('roles.createError'));
      return;
    }
    if (editingRole && targetPermissionIds.length === 0) {
      // Deliberate emptying is allowed — but confirm it (saves with [] wipe permissions)
      Modal.confirm({
        title: t('roles.confirmEmptyTitle'),
        content: t('roles.confirmEmptyContent'),
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        onOk: () => void doSave(values),
      });
      return;
    }
    await doSave(values);
  };

  const columns: ProColumns<Role>[] = [
    { title: t('roles.name'), dataIndex: 'name' },
    { title: t('roles.description'), dataIndex: 'description', search: false },
    {
      title: t('roles.createdAt'),
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      search: false,
    },
    {
      title: t('roles.actions'),
      valueType: 'option',
      width: 140,
      render: (_, record) => [
        <a key="edit" onClick={() => void openEdit(record)}>
          {editLoadingId === record.id ? <LoadingOutlined /> : <EditOutlined />} {t('common.edit')}
        </a>,
        <Popconfirm
          key="delete"
          title={t('roles.deleteConfirm')}
          onConfirm={async () => {
            try {
              await deleteRole(record.id);
              message.success(t('roles.deleteSuccess'));
              actionRef.current?.reload();
            } catch {
              message.error(t('roles.deleteError'));
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
    <>
      <ProTable<Role>
        headerTitle={t('roles.title')}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current, pageSize, name } = params;
          const result = await listRoles({
            page: current,
            pageSize,
            search: name,
          });
          return {
            data: result.data,
            total: result.total,
            success: true,
          };
        }}
        pagination={{ defaultPageSize: 10 }}
        search={false}
        locale={{ emptyText: <EmptyState variant="no-data" /> }}
        toolBarRender={() => [
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('roles.create')}
          </Button>,
        ]}
      />

      <Modal
        title={editingRole ? t('roles.editTitle') : t('roles.createTitle')}
        open={modalOpen}
        forceRender
        onOk={handleSave}
        confirmLoading={saving}
        onCancel={() => {
          setModalOpen(false);
          setEditingRole(null);
          form.resetFields();
        }}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('roles.name')}
            rules={[{ required: true, message: t('roles.nameRequired') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('roles.description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label={t('roles.permissions')}>
            <Transfer
              dataSource={allPermissions.map((p) => ({
                key: p.id,
                title: `${p.resource}:${p.action}`,
                description: p.description ?? '',
              }))}
              titles={[t('roles.transferAvailable'), t('roles.transferSelected')]}
              targetKeys={targetPermissionIds}
              onChange={(nextTargetKeys) => setTargetPermissionIds(nextTargetKeys as string[])}
              render={(item) => item.title}
              showSearch
              listStyle={{ width: 250, height: 300 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
