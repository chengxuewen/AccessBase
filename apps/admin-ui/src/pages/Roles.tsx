import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Tooltip, Transfer } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LoadingOutlined, ReloadOutlined, LockOutlined } from '@ant-design/icons';
import EmptyState from '../components/EmptyState';
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  type Role,
  type Permission,
  type DataScope,
  } from '../api/roles';
import { fetchAllPermissions } from '../utils/fetchAll';
import { message } from '../api/feedback';
import { apiErrorMessage } from '../api/errors';
import TenantCell from '../components/TenantCell';

/** The scope Select carries a fourth value: 'mixed' is a hydration-only display
 * sentinel (B5 disclosure), never part of the saved payload. */
type ScopeDisplay = DataScope | 'mixed';

export default function Roles() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType>(null);
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [targetPermissionIds, setTargetPermissionIds] = useState<string[]>([]);
  // data-scope batch: one Select fanning the selected users:* bindings (A4); the mixed
  // flag carries the B5 state where stored scopes diverge and cannot be unified in the UI.
  const [dataScope, setDataScope] = useState<DataScope>('all');
  const [scopeMixed, setScopeMixed] = useState(false);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  // L'-T5: latest page of roles captured from the table request — feeds the
  // parent-role Select with zero extra endpoints.
  // ponytail: page-scoped options; fetch-all via utils/fetchAll if tenants exceed page size.
  const [roleRows, setRoleRows] = useState<Role[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [permLoadError, setPermLoadError] = useState(false);

  const loadPerms = () => {
    fetchAllPermissions()
      .then((perms) => {
        setAllPermissions(perms);
        setPermLoadError(false);
      })
      .catch(() => setPermLoadError(true));
  };

  useEffect(() => {
    loadPerms();
  }, []);

  const openCreate = () => {
    setEditingRole(null);
    form.resetFields();
    setTargetPermissionIds([]);
    setDataScope('all');
    setScopeMixed(false);
    setModalOpen(true);
  };

  // B7 fix: hydrate from the detail endpoint — list rows carry no permission data
  const openEdit = async (role: Role) => {
    setEditLoadingId(role.id);
    try {
      const detail = await getRole(role.id);
      setEditingRole(detail);
      form.setFieldsValue({ name: detail.name, description: detail.description, parentId: detail.parentId });
      setTargetPermissionIds((detail.permissions ?? []).map((p) => p.id));
      const usersIds = (detail.permissions ?? [])
        .filter((p) => p.resource === 'users')
        .map((p) => p.id);
      const stored = detail.permissionScopes ?? {};
      const distinct = [...new Set(usersIds.map((id) => stored[id] ?? 'all'))];
      // B5: divergent users:* bindings are not representable by a single value — show
      // the disabled 'mixed' sentinel instead of silently picking one of them.
      setScopeMixed(distinct.length > 1);
      setDataScope(distinct.length === 1 ? distinct[0] ?? 'all' : 'all');
      setModalOpen(true);
    } catch {
      message.error(t('roles.loadDetailError'));
    } finally {
      setEditLoadingId(null);
    }
  };

  const doSave = async (values: { name: string; description?: string; parentId?: string }) => {
    setSaving(true);
    try {
      if (editingRole) {
        const payload: {
          name: string;
          description?: string;
          permissionIds: string[];
          parentId?: string | null;
          permissionScopes?: Record<string, DataScope>;
        } = { ...values, permissionIds: targetPermissionIds };
        // Only send parentId when the user actually touched the Select: an untouched
        // edit must not rewrite the parent, and a touched+cleared one sends explicit
        // null (route maps it to setParent(id, null) = unlink).
        if (form.isFieldTouched('parentId')) payload.parentId = values.parentId ?? null;
        // Fan the displayed scope onto the users:* ids only — other resources keep the
        // server default. Mixed state sends nothing (the sentinel tooltip discloses it).
        if (!scopeMixed && selectedUsersIds.length > 0) {
          payload.permissionScopes = Object.fromEntries(
            selectedUsersIds.map((id) => [id, dataScope] as const),
          );
        }
        await updateRole(editingRole.id, payload);
        message.success(t('roles.updateSuccess'));
      } else {
        await createRole({ ...values, permissionIds: targetPermissionIds });
        message.success(t('roles.createSuccess'));
      }
      setModalOpen(false);
      setEditingRole(null);
      form.resetFields();
      actionRef.current?.reload();
    } catch (err) {
      message.error(apiErrorMessage(err, editingRole ? t('roles.updateError') : t('roles.createError')));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    let values: { name: string; description?: string; parentId?: string };
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
      // L'-T5: findAll batch-resolves permissions[] server-side — pure client count.
      title: t('roles.permissions'),
      dataIndex: 'permissions',
      search: false,
      render: (_, record) => record.permissions?.length ?? 0,
    },
    {
      // Batch G5: read-only tenant column — slug via cached lookup, '—' on failure
      title: t('roles.tenant'),
      dataIndex: 'tenantId',
      search: false,
      render: (_, record) => record.tenantId ? <TenantCell tenantId={record.tenantId} /> : '—',
    },
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
        <Button type="link" size="small" key="edit" disabled={record.isSystem} onClick={() => void openEdit(record)}>
          {editLoadingId === record.id ? (
            <LoadingOutlined />
          ) : record.isSystem ? (
            <LockOutlined />
          ) : (
            <EditOutlined />
          )}{" "}
          {t('common.edit')}
        </Button>,
        <Popconfirm
          key="delete"
          disabled={record.isSystem}
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
          <Button type="link" size="small" danger disabled={record.isSystem}>
            <DeleteOutlined /> {t('common.delete')}
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  // data-scope batch (v1 = users surface): the editor appears once a users:* permission
  // is selected, and the save payload fans its value onto exactly those ids.
  const selectedUsersIds = targetPermissionIds.filter((id) =>
    allPermissions.some((p) => p.id === id && p.resource === 'users'),
  );
  const showScopeEditor = editingRole !== null && selectedUsersIds.length > 0;
  const scopeOptions: { value: ScopeDisplay; label: string }[] = [
    { value: 'all', label: t('roles.dataScopeAll') },
    { value: 'dept', label: t('roles.dataScopeDept') },
    { value: 'self', label: t('roles.dataScopeSelf') },
  ];

  return (
    <>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('roles.loadError')}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>{t('common.retry')}</Button>
          }
          data-testid="roles-load-error"
          style={{ marginBottom: 16 }}
        />
      )}
      <ProTable<Role>
        headerTitle={t('roles.title')}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        columns={columns}
        request={async (params) => {
          try {
            const { current, pageSize, name } = params;
            const result = await listRoles({
              page: current,
              pageSize,
              search: name,
            });
            setLoadError(false);
            setRoleRows(result.data);
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
          <Form.Item name="parentId" label={t('roles.parent')}>
            <Select
              data-testid="roles-parent-select"
              allowClear
              showSearch
              optionFilterProp="label"
              options={roleRows
                .filter((r) => r.id !== editingRole?.id)
                .map((r) => ({ label: r.name, value: r.id }))}
            />
          </Form.Item>
          {permLoadError && (
            <Alert
              type="error"
              showIcon
              message={t('roles.loadPermissionsError')}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={loadPerms}>{t('common.retry')}</Button>
              }
              data-testid="perm-load-error"
              style={{ marginBottom: 12 }}
            />
          )}
          <Form.Item label={t('roles.permissions')}>
            <Transfer
              dataSource={allPermissions.map((p) => ({
                key: p.id,
                title: `${p.resource}:${p.action}`,
                description: p.description ?? '',
              }))}
              titles={[t('roles.transferAvailable'), t('roles.transferSelected')]}
              targetKeys={targetPermissionIds}
              onChange={(nextTargetKeys) => {
                setTargetPermissionIds(nextTargetKeys as string[]);
                // Re-editing the permission set resolves the mixed sentinel into a concrete
                // value (otherwise a disabled Select could never be re-armed in this session).
                setScopeMixed(false);
              }}
              render={(item) => item.title}
              showSearch
              listStyle={{ width: '46%', height: 300 }}
            />
          </Form.Item>
          {showScopeEditor && (
            <Form.Item label={t('roles.dataScope')}>
              <Tooltip title={scopeMixed ? t('roles.dataScopeMixedHint') : undefined}>
                <Select<ScopeDisplay>
                  data-testid="roles-scope-select"
                  disabled={scopeMixed}
                  value={scopeMixed ? 'mixed' : dataScope}
                  onChange={(value: ScopeDisplay) => {
                    if (value !== 'mixed') setDataScope(value);
                  }}
                  options={
                    scopeMixed
                      ? [{ value: 'mixed', label: t('roles.dataScopeMixed') }, ...scopeOptions]
                      : scopeOptions
                  }
                />
              </Tooltip>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
