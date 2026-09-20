import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Form, Input, Modal, Popconfirm, Tag } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  LockOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { isAxiosError } from 'axios';
import {
  fetchTenants,
  createTenant,
  updateTenant,
  deleteTenant,
  bootstrapTenant,
  type Tenant,
} from '../api/tenants';
import EmptyState from '../components/EmptyState';
import { message } from '../api/feedback';
import { apiErrorMessage, apiErrorStatus } from '../api/errors';
import { useAuthStore } from '../stores/auth';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';
import { resolveLang } from '../utils/locale';

// register relativeTime once at module load; per-render extend would be wasteful
dayjs.extend(relativeTime);

// Client mirror of the bootstrap password policy (UserCreate precedent — same
// regex/hint). The route remains authoritative (spec D2 step 5, options-driven).
const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// Mirrors the routes/tenants.ts body schema pattern for slug.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface TenantFormValues {
  name?: string;
  slug?: string;
}

interface InitFormValues {
  email?: string;
  name?: string;
  password?: string;
}

export default function Tenants() {
  const { t, i18n } = useTranslation();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('tenants:write');
  const canDelete = hasPermission('tenants:delete');
  // relative timestamps follow the UI language (register ≠ activate in dayjs)
  dayjs.locale(resolveLang(i18n.language) === 'zh' ? 'zh-cn' : 'en');

  const actionRef = useRef<ActionType>(null);
  const [loadError, setLoadError] = useState(false);

  // Create / edit modal (name + slug)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<TenantFormValues>();

  // Init-admin (bootstrap) modal — password lives only in this form instance,
  // never in any persisted store (wizard precedent).
  const [initOpen, setInitOpen] = useState(false);
  const [initTenant, setInitTenant] = useState<Tenant | null>(null);
  const [initing, setIniting] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [initResult, setInitResult] = useState<{ alreadyBootstrapped: boolean } | null>(null);
  const [initForm] = Form.useForm<InitFormValues>();

  const openCreate = () => {
    setEditingTenant(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    form.resetFields();
    form.setFieldsValue({ name: tenant.name, slug: tenant.slug });
    setModalOpen(true);
  };

  const handleSaveTenant = async () => {
    let values: TenantFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // field validation errors render inline
    }
    setSaving(true);
    try {
      const name = (values.name ?? '').trim();
      const slug = (values.slug ?? '').trim();
      if (editingTenant) {
        await updateTenant(editingTenant.id, { name, slug });
        message.success(t('tenants.updated'));
      } else {
        await createTenant({ name, slug });
        message.success(t('tenants.created'));
      }
      setModalOpen(false);
      setEditingTenant(null);
      actionRef.current?.reload();
    } catch (err) {
      message.error(apiErrorMessage(err, editingTenant ? t('tenants.updateError') : t('tenants.createError')));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (record: Tenant) => {
    const next = record.status === 'active' ? 'suspended' : 'active';
    try {
      await updateTenant(record.id, { status: next });
      message.success(next === 'suspended' ? t('tenants.suspended') : t('tenants.activated'));
      actionRef.current?.reload();
    } catch (err) {
      message.error(apiErrorMessage(err, t('tenants.statusError')));
    }
  };

  const handleDelete = async (record: Tenant) => {
    try {
      await deleteTenant(record.id);
      message.success(t('tenants.deleted'));
      actionRef.current?.reload();
    } catch (err) {
      message.error(apiErrorMessage(err, t('tenants.deleteError')));
    }
  };

  const openInit = (tenant: Tenant) => {
    setInitTenant(tenant);
    initForm.resetFields();
    setInitError(null);
    setInitResult(null);
    setInitOpen(true);
  };

  const closeInit = () => {
    setInitOpen(false);
    setInitTenant(null);
    actionRef.current?.reload();
  };

  const handleInitOk = async () => {
    if (initResult) {
      closeInit();
      return;
    }
    if (!initTenant) return;
    let values: InitFormValues;
    try {
      values = await initForm.validateFields();
    } catch {
      return; // field validation errors render inline
    }
    setIniting(true);
    setInitError(null);
    try {
      const result = await bootstrapTenant(initTenant.id, {
        email: (values.email ?? '').trim(),
        name: (values.name ?? '').trim(),
        password: values.password ?? '',
      });
      setInitResult({ alreadyBootstrapped: result.alreadyBootstrapped });
      message.success(
        result.alreadyBootstrapped
          ? t('tenants.initAlreadyBootstrapped')
          : t('tenants.initSuccess'),
      );
    } catch (err: unknown) {
      const code = isAxiosError<{ error?: { code?: string } }>(err)
        ? err.response?.data?.error?.code
        : undefined;
      if (apiErrorStatus(err) === 409 && code === 'EMAIL_EXISTS') {
        // UserCreate precedent: 409 EMAIL_EXISTS highlights the offending field
        initForm.setFields([
          { name: 'email', errors: [apiErrorMessage(err, t('users.emailExists'))] },
        ]);
      } else {
        // TENANT_PROTECTED / TENANT_PLATFORM_ONLY / policy-400 … surface inline
        // (server message passed through, K-R6 apiErrorMessage)
        setInitError(apiErrorMessage(err, t('tenants.initError')));
      }
    } finally {
      setIniting(false);
    }
  };

  const columns: ProColumns<Tenant>[] = [
    { title: t('tenants.name'), dataIndex: 'name' },
    { title: t('tenants.slug'), dataIndex: 'slug', search: false, copyable: true },
    {
      title: t('tenants.status'),
      dataIndex: 'status',
      search: false,
      render: (_, record) =>
        record.status === 'active' ? (
          <Tag color="green">{t('tenants.statusActive')}</Tag>
        ) : (
          <Tag color="red">{t('tenants.statusSuspended')}</Tag>
        ),
    },
    {
      title: t('tenants.createdAt'),
      dataIndex: 'createdAt',
      search: false,
      render: (_, record) => dayjs(record.createdAt).fromNow(),
    },
  ];

  if (canWrite || canDelete) {
    columns.push({
      title: t('tenants.actions'),
      valueType: 'option',
      width: 320,
      render: (_, record) => {
        // Spec D5: the default-tenant row is platform-owned — every mutating
        // action renders disabled with a lock (K-T3 isSystem precedent).
        const locked = record.isDefault === true;
        const actions: React.ReactNode[] = [];
        if (canWrite) {
          actions.push(
            <Button
              key="init"
              type="link"
              size="small"
              disabled={locked}
              onClick={() => openInit(record)}
              data-testid={`tenants-init-${record.id}`}
            >
              {locked ? <LockOutlined /> : <UserAddOutlined />} {t('tenants.initAdmin')}
            </Button>,
            <Button
              key="edit"
              type="link"
              size="small"
              disabled={locked}
              onClick={() => openEdit(record)}
              data-testid={`tenants-edit-${record.id}`}
            >
              {locked ? <LockOutlined /> : <EditOutlined />} {t('common.edit')}
            </Button>,
            <Popconfirm
              key="status"
              disabled={locked}
              title={record.status === 'active' ? t('tenants.suspendConfirm') : t('tenants.activateConfirm')}
              onConfirm={() => void handleToggleStatus(record)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
              <Button
                type="link"
                size="small"
                danger={record.status === 'active'}
                disabled={locked}
                data-testid={`tenants-status-${record.id}`}
              >
                {record.status === 'active' ? t('tenants.suspend') : t('tenants.activate')}
              </Button>
            </Popconfirm>,
          );
        }
        if (canDelete) {
          actions.push(
            <Popconfirm
              key="delete"
              disabled={locked}
              title={t('tenants.deleteConfirm')}
              onConfirm={() => void handleDelete(record)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
              <Button
                type="link"
                size="small"
                danger
                disabled={locked}
                data-testid={`tenants-delete-${record.id}`}
              >
                {locked ? <LockOutlined /> : <DeleteOutlined />} {t('common.delete')}
              </Button>
            </Popconfirm>,
          );
        }
        return actions;
      },
    });
  }

  return (
    <div data-testid="tenants-page">
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('tenants.loadError')}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()} data-testid="tenants-load-retry">
              {t('common.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
          data-testid="tenants-load-error"
        />
      )}
      <ProTable<Tenant>
        headerTitle={t('tenants.title')}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        columns={columns}
        data-testid="tenants-table"
        request={async (params) => {
          try {
            const { current, pageSize, name } = params;
            const result = await fetchTenants({ page: current, pageSize, search: name });
            setLoadError(false);
            return { data: result.data, total: result.total, success: true };
          } catch {
            setLoadError(true);
            return { data: [], total: 0, success: false };
          }
        }}
        pagination={{ defaultPageSize: 10 }}
        search={{ labelWidth: 'auto' }}
        locale={{ emptyText: <EmptyState variant={loadError ? 'error' : 'no-data'} /> }}
        toolBarRender={
          canWrite
            ? () => [
                <Button
                  key="create"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreate}
                  data-testid="tenants-create"
                >
                  {t('tenants.create')}
                </Button>,
              ]
            : false
        }
      />

      <Modal
        title={editingTenant ? t('tenants.editTitle') : t('tenants.createTitle')}
        open={modalOpen}
        onOk={handleSaveTenant}
        onCancel={() => {
          setModalOpen(false);
          setEditingTenant(null);
        }}
        confirmLoading={saving}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('tenants.name')}
            rules={[{ required: true, message: t('tenants.nameRequired') }]}
          >
            <Input data-testid="tenants-name-input" />
          </Form.Item>
          <Form.Item
            name="slug"
            label={t('tenants.slug')}
            extra={t('tenants.slugHint')}
            rules={[
              { required: true, message: t('tenants.slugRequired') },
              { pattern: SLUG_PATTERN, message: t('tenants.slugInvalid') },
            ]}
          >
            <Input data-testid="tenants-slug-input" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('tenants.initAdminTitle')}
        open={initOpen}
        onOk={handleInitOk}
        onCancel={closeInit}
        confirmLoading={initing}
        okText={initResult ? t('tenants.ok') : t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnHidden
        forceRender
        data-testid="tenants-init-modal"
      >
        {initResult ? (
          <Alert
            type="success"
            showIcon
            message={
              initResult.alreadyBootstrapped
                ? t('tenants.initAlreadyBootstrapped')
                : t('tenants.initSuccess')
            }
            data-testid="init-admin-success"
          />
        ) : (
          <>
            {initError && (
              <Alert
                type="error"
                showIcon
                message={initError}
                data-testid="init-admin-error"
                style={{ marginBottom: 12 }}
              />
            )}
            <Form form={initForm} layout="vertical">
              <Form.Item
                name="email"
                label={t('tenants.email')}
                rules={[
                  { required: true, message: t('tenants.emailRequired') },
                  { type: 'email', message: t('tenants.emailInvalid') },
                ]}
              >
                <Input autoComplete="off" data-testid="init-admin-email" />
              </Form.Item>
              <Form.Item
                name="name"
                label={t('tenants.adminName')}
                rules={[{ required: true, message: t('tenants.adminNameRequired') }]}
              >
                <Input autoComplete="off" data-testid="init-admin-name" />
              </Form.Item>
              <Form.Item
                name="password"
                label={t('tenants.password')}
                extra={t('users.passwordPolicy')}
                rules={[
                  { required: true, message: t('tenants.passwordRequired') },
                  {
                    validator: (_, value: string | undefined) =>
                      !value || PASSWORD_POLICY.test(value)
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('users.passwordPolicy'))),
                  },
                ]}
              >
                <Input.Password autoComplete="new-password" data-testid="init-admin-password" />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}
