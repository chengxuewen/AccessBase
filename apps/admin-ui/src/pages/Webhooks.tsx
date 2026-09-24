import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CopyOutlined,
  SendOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import {
  fetchWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  rotateWebhookSecret,
  pingWebhook,
  fetchWebhookDeliveries,
  type Webhook,
  type WebhookDelivery,
} from '../api/webhooks';
import EmptyState from '../components/EmptyState';
import { message } from '../api/feedback';
import { apiErrorMessage } from '../api/errors';
import { useAuthStore } from '../stores/auth';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

// Server contract (routes/webhooks.ts): each entry is '*' OR ^[a-z]+\.[a-z_]+$
const EVENT_PATTERN = /^[a-z]+\.[a-z_]+$/;
const EVENT_PRESETS = ['*', 'user.created', 'user.updated', 'user.deleted', 'webhook.test'];

interface WebhookFormValues {
  url?: string;
  description?: string;
  subscribedEvents?: string[];
}

interface RevealState {
  secret: string;
  url: string;
}

interface DeliveriesState {
  webhook: Webhook;
  deliveries: WebhookDelivery[];
  loading: boolean;
}

const DELIVERY_STATUS_COLOR: Record<WebhookDelivery['status'], string> = {
  pending: 'orange',
  delivered: 'green',
  dead: 'red',
};

export default function Webhooks() {
  const { t } = useTranslation();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('webhooks:write');

  const actionRef = useRef<ActionType>(null);
  const [loadError, setLoadError] = useState(false);

  // Create / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<WebhookFormValues>();

  // Reveal-once secret (create result or rotate result) — Clients precedent
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [copied, setCopied] = useState(false);

  // Deliveries drawer
  const [drawer, setDrawer] = useState<DeliveriesState | null>(null);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: Webhook) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      url: record.url,
      description: record.description,
      subscribedEvents: record.subscribedEvents,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    let values: WebhookFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // field validation errors render inline
    }
    setSaving(true);
    try {
      const url = (values.url ?? '').trim();
      const description = (values.description ?? '').trim();
      const subscribedEvents = values.subscribedEvents ?? [];
      if (editing) {
        await updateWebhook(editing.id, { url, description, subscribedEvents });
        message.success(t('webhooks.updated'));
      } else {
        const created = await createWebhook({
          url,
          ...(description ? { description } : {}),
          subscribedEvents,
        });
        setReveal({ secret: created.secret, url: created.url });
        setCopied(false);
        message.success(t('webhooks.created'));
      }
      setModalOpen(false);
      setEditing(null);
      actionRef.current?.reload();
    } catch (err) {
      // 400 WEBHOOK_INVALID / WEBHOOK_URL_DENIED, 409 WEBHOOK_EXISTS messages
      // surface verbatim via apiErrorMessage (K-R6 passthrough)
      message.error(apiErrorMessage(err, editing ? t('webhooks.updateError') : t('webhooks.createError')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: Webhook) => {
    try {
      await deleteWebhook(record.id);
      message.success(t('webhooks.deleted'));
      actionRef.current?.reload();
    } catch (err) {
      message.error(apiErrorMessage(err, t('webhooks.deleteError')));
    }
  };

  const handleToggleActive = async (record: Webhook, active: boolean) => {
    try {
      await updateWebhook(record.id, { active });
      message.success(t('webhooks.updated'));
    } catch (err) {
      message.error(apiErrorMessage(err, t('webhooks.updateError')));
    } finally {
      actionRef.current?.reload();
    }
  };

  const handleRotate = async (record: Webhook) => {
    try {
      const secret = await rotateWebhookSecret(record.id);
      setReveal({ secret, url: record.url });
      setCopied(false);
      message.success(t('webhooks.rotated'));
    } catch (err) {
      message.error(apiErrorMessage(err, t('webhooks.rotateError')));
    }
  };

  const handlePing = async (record: Webhook) => {
    try {
      await pingWebhook(record.id);
      message.success(t('webhooks.pingQueued'));
    } catch (err) {
      message.error(apiErrorMessage(err, t('webhooks.pingError')));
    }
  };

  const loadDeliveries = useCallback(
    async (webhook: Webhook): Promise<void> => {
      setDrawer({ webhook, deliveries: [], loading: true });
      try {
        const deliveries = await fetchWebhookDeliveries(webhook.id);
        setDrawer({ webhook, deliveries, loading: false });
      } catch (err) {
        message.error(apiErrorMessage(err, t('webhooks.deliveriesLoadError')));
        setDrawer({ webhook, deliveries: [], loading: false });
      }
    },
    [t],
  );

  const openDeliveries = (record: Webhook) => {
    void loadDeliveries(record);
  };

  const handleCopy = async () => {
    if (!reveal) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(reveal.secret);
      } else {
        // Fallback for insecure contexts (http): temporary textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = reveal.secret;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('execCommand copy failed');
      }
      setCopied(true);
    } catch {
      message.error(t('webhooks.copyFailed'));
    }
  };

  const closeReveal = () => {
    setReveal(null);
    actionRef.current?.reload();
  };

  const columns: ProColumns<Webhook>[] = [
    { title: t('webhooks.url'), dataIndex: 'url', copyable: true, ellipsis: true },
    {
      title: t('webhooks.events'),
      dataIndex: 'subscribedEvents',
      search: false,
      render: (_, record) => (
        <Space size={4} wrap>
          {record.subscribedEvents.map((e) => (
            <Tag key={e}>{e}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('webhooks.active'),
      dataIndex: 'active',
      search: false,
      render: (_, record) => (
        <Switch
          checked={record.active}
          disabled={!canWrite}
          onChange={(checked) => void handleToggleActive(record, checked)}
          data-testid="webhooks-active-switch"
          aria-label={t('webhooks.active')}
        />
      ),
    },
    {
      title: t('webhooks.pending'),
      dataIndex: 'pending',
      search: false,
      render: (_, record) => <Tag color={record.pending > 0 ? 'orange' : 'default'}>{record.pending}</Tag>,
    },
    {
      title: t('webhooks.dead'),
      dataIndex: 'dead',
      search: false,
      render: (_, record) => <Tag color={record.dead > 0 ? 'red' : 'default'}>{record.dead}</Tag>,
    },
    {
      title: t('webhooks.createdAt'),
      dataIndex: 'createdAt',
      search: false,
      render: (_, record) => dayjs(record.createdAt).fromNow(),
    },
  ];

  // Deliveries is a read action (webhooks:read); mutating controls gate on
  // webhooks:write inside the actions array (Groups gating pattern).
  columns.push({
    title: t('webhooks.actions'),
    valueType: 'option',
    width: 430,
    render: (_, record) => {
      const actions: React.ReactNode[] = [
        <Button
          key="deliveries"
          type="link"
          size="small"
          icon={<HistoryOutlined />}
          onClick={() => openDeliveries(record)}
          data-testid="webhooks-deliveries-open"
        >
          {t('webhooks.deliveries')}
        </Button>,
      ];
      if (canWrite) {
        actions.push(
          <Button
            key="ping"
            type="link"
            size="small"
            icon={<SendOutlined />}
            onClick={() => void handlePing(record)}
            data-testid="webhooks-ping"
          >
            {t('webhooks.test')}
          </Button>,
          <Button
            key="edit"
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
            data-testid="webhooks-edit"
          >
            {t('common.edit')}
          </Button>,
          <Button
            key="rotate"
            type="link"
            size="small"
            onClick={() => void handleRotate(record)}
            data-testid="webhooks-rotate"
          >
            {t('webhooks.rotateSecret')}
          </Button>,
          <Popconfirm
            key="delete"
            title={t('webhooks.deleteConfirm')}
            onConfirm={() => void handleDelete(record)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} data-testid="webhooks-delete">
              {t('common.delete')}
            </Button>
          </Popconfirm>,
        );
      }
      return actions;
    },
  });

  const deliveryColumns: ColumnsType<WebhookDelivery> = [
    {
      title: t('webhooks.deliveryStatus'),
      dataIndex: 'status',
      render: (status: WebhookDelivery['status'], record) =>
        record.lastError ? (
          <Tooltip title={record.lastError}>
            <Tag color={DELIVERY_STATUS_COLOR[status]} data-testid={`webhooks-delivery-status-${record.id}`}>
              {t(`webhooks.status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
            </Tag>
          </Tooltip>
        ) : (
          <Tag color={DELIVERY_STATUS_COLOR[status]} data-testid={`webhooks-delivery-status-${record.id}`}>
            {t(`webhooks.status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
          </Tag>
        ),
    },
    { title: t('webhooks.attempts'), dataIndex: 'attempts' },
    {
      title: t('webhooks.responseStatus'),
      dataIndex: 'responseStatus',
      render: (value: number | null) => (value === null ? '-' : String(value)),
    },
    {
      title: t('webhooks.createdAt'),
      dataIndex: 'createdAt',
      render: (value: string) => dayjs(value).fromNow(),
    },
  ];

  return (
    <div data-testid="webhooks-page">
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('webhooks.loadError')}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()} data-testid="webhooks-load-retry">
              {t('common.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
          data-testid="webhooks-load-error"
        />
      )}
      <ProTable<Webhook>
        headerTitle={t('webhooks.title')}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        columns={columns}
        data-testid="webhooks-table"
        request={async () => {
          try {
            const data = await fetchWebhooks();
            setLoadError(false);
            return { data, success: true };
          } catch {
            setLoadError(true);
            return { data: [], success: false };
          }
        }}
        pagination={{ defaultPageSize: 10 }}
        search={false}
        locale={{ emptyText: <EmptyState variant={loadError ? 'error' : 'no-data'} /> }}
        rowClassName={() => 'webhooks-row'}
        toolBarRender={
          canWrite
            ? () => [
                <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate} data-testid="webhooks-create">
                  {t('webhooks.create')}
                </Button>,
              ]
            : false
        }
      />

      <Modal
        data-testid="webhooks-form-modal"
        title={editing ? t('webhooks.editTitle') : t('webhooks.createTitle')}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        confirmLoading={saving}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="url"
            label={t('webhooks.url')}
            rules={[{ required: true, message: t('webhooks.urlRequired') }]}
          >
            <Input placeholder="https://example.com/hooks/accessbase" data-testid="webhooks-url-input" />
          </Form.Item>
          <Form.Item name="description" label={t('webhooks.description')}>
            <Input data-testid="webhooks-description-input" />
          </Form.Item>
          <Form.Item
            name="subscribedEvents"
            label={t('webhooks.events')}
            extra={t('webhooks.eventsHint')}
            rules={[
              {
                validator: (_, value: string[] | undefined) => {
                  const bad = (value ?? []).filter((e) => e !== '*' && !EVENT_PATTERN.test(e));
                  return bad.length
                    ? Promise.reject(new Error(t('webhooks.eventsInvalid', { events: bad.join(', ') })))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Select
              mode="tags"
              options={EVENT_PRESETS.map((e) => ({ label: e, value: e }))}
              placeholder={t('webhooks.eventsPlaceholder')}
              data-testid="webhooks-events-select"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('webhooks.secretTitle')}
        open={reveal !== null}
        onOk={closeReveal}
        onCancel={closeReveal}
        okText={t('webhooks.ok')}
        cancelButtonProps={{ style: { display: 'none' } }}
        data-testid="webhooks-secret-reveal"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert type="warning" showIcon message={t('webhooks.secretWarning')} />
          <Space.Compact style={{ width: '100%' }}>
            <Input readOnly value={reveal?.secret} data-testid="webhooks-secret-value" />
            <Button icon={<CopyOutlined />} onClick={() => void handleCopy()} data-testid="webhooks-secret-copy">
              {copied ? t('webhooks.copied') : t('webhooks.copy')}
            </Button>
          </Space.Compact>
          <Typography.Text type="secondary">{reveal?.url}</Typography.Text>
        </Space>
      </Modal>

      <Drawer
        title={t('webhooks.deliveriesTitle', { url: drawer?.webhook.url ?? '' })}
        width={640}
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        destroyOnHidden
        extra={
          <Button
            icon={<ReloadOutlined />}
            disabled={!drawer}
            onClick={() => drawer && void loadDeliveries(drawer.webhook)}
            data-testid="webhooks-deliveries-refresh"
          >
            {t('common.retry')}
          </Button>
        }
      >
        <div data-testid="webhooks-deliveries">
          <Table<WebhookDelivery>
          rowKey="id"
          size="small"
          loading={drawer?.loading ?? false}
          columns={deliveryColumns}
          dataSource={drawer?.deliveries ?? []}
          pagination={false}
          locale={{ emptyText: t('webhooks.noDeliveries') }}
          />
        </div>
      </Drawer>
    </div>
  );
}
