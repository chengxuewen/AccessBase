import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
} from '../api/apiKeys';
import EmptyState from '../components/EmptyState';
import { message } from '../api/feedback';
import { apiErrorMessage } from '../api/errors';
import { useAuthStore } from '../stores/auth';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';
import { resolveLang } from '../utils/locale';

// register relativeTime once at module load; per-render extend would be wasteful
dayjs.extend(relativeTime);

interface CreateFormValues {
  name?: string;
  expiresAt?: dayjs.Dayjs | null;
}

export default function ApiKeys() {
  const { t, i18n } = useTranslation();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('apikeys:write');
  // relative timestamps follow the UI language (register ≠ activate in dayjs)
  dayjs.locale(resolveLang(i18n.language) === 'zh' ? 'zh-cn' : 'en');

  const actionRef = useRef<ActionType>(null);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();
  // Plaintext reveal: one-time (create result only — no rotation for API keys)
  const [reveal, setReveal] = useState<{ name: string; plaintext: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const openCreate = () => {
    form.resetFields();
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      setCreating(true);
      const created = await createApiKey({
        name: (values.name ?? '').trim(),
        ...(values.expiresAt ? { expiresAt: values.expiresAt.toISOString() } : {}),
      });
      setCreateOpen(false);
      setReveal({ name: created.name, plaintext: created.plaintext });
      setCopied(false);
      message.success(t('apiKeys.created'));
    } catch (err) {
      message.error(apiErrorMessage(err, t('apiKeys.createError')));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (record: ApiKey) => {
    try {
      await revokeApiKey(record.id);
      message.success(t('apiKeys.revoked'));
      actionRef.current?.reload();
    } catch (err) {
      message.error(apiErrorMessage(err, t('apiKeys.revokeError')));
    }
  };

  const handleCopy = async () => {
    if (!reveal) return;
    const text = reveal.plaintext;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for insecure contexts (http): temporary textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = text;
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
      message.error(t('apiKeys.copyFailed'));
    }
  };

  const closeReveal = () => {
    setReveal(null);
    actionRef.current?.reload();
  };

  const columns: ProColumns<ApiKey>[] = [
    { title: t('apiKeys.name'), dataIndex: 'name' },
    { title: t('apiKeys.prefix'), dataIndex: 'prefix', copyable: true },
    {
      title: t('apiKeys.scopes'),
      dataIndex: 'scopes',
      search: false,
      render: (_, record) => record.scopes.map((s) => <Tag key={s}>{s}</Tag>),
    },
    {
      title: t('apiKeys.createdAt'),
      dataIndex: 'createdAt',
      render: (_, record) => dayjs(record.createdAt).fromNow(),
      search: false,
    },
    {
      title: t('apiKeys.expiresAt'),
      dataIndex: 'expiresAt',
      search: false,
      render: (_, record) =>
        record.expiresAt ? (
          <span>{dayjs(record.expiresAt).format('YYYY-MM-DD')}</span>
        ) : (
          <Typography.Text type="secondary">{t('apiKeys.never')}</Typography.Text>
        ),
    },
    {
      title: t('apiKeys.status'),
      dataIndex: 'revokedAt',
      search: false,
      render: (_, record) =>
        record.revokedAt ? (
          <Tag color="red">{t('apiKeys.revokedTag')}</Tag>
        ) : (
          <Tag color="green">{t('apiKeys.activeTag')}</Tag>
        ),
    },
  ];

  if (canWrite) {
    columns.push({
      title: t('apiKeys.actions'),
      valueType: 'option',
      width: 160,
      render: (_, record) => [
        <Popconfirm
          key="revoke"
          title={t('apiKeys.revokeConfirm')}
          onConfirm={() => handleRevoke(record)}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
        >
          <Button key="revoke-btn" type="link" size="small" danger>
            <DeleteOutlined /> {t('apiKeys.revoke')}
          </Button>
        </Popconfirm>,
      ],
    });
  }

  const handleRetry = () => {
    setLoadError(false);
    actionRef.current?.reload();
  };

  return (
    <div data-testid="api-keys-page">
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('apiKeys.loadError')}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRetry} data-testid="api-keys-load-retry">
              {t('common.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
          data-testid="api-keys-load-error"
        />
      )}
      <ProTable<ApiKey>
        headerTitle={t('apiKeys.title')}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        columns={columns}
        data-testid="api-keys-table"
        request={async () => {
          try {
            const data = await listApiKeys();
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
        toolBarRender={
          canWrite
            ? () => [
                <Button
                  key="create"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreate}
                  data-testid="api-keys-create"
                >
                  {t('apiKeys.create')}
                </Button>,
              ]
            : false
        }
      />

      <Modal
        title={t('apiKeys.createTitle')}
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={creating}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('apiKeys.name')}
            rules={[{ required: true, message: t('apiKeys.nameRequired') }]}
          >
            <Input data-testid="api-keys-name-input" />
          </Form.Item>
          <Form.Item name="expiresAt" label={t('apiKeys.expiresAt')}>
            <DatePicker
              showTime
              style={{ width: '100%' }}
              data-testid="api-keys-expires-input"
              disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('apiKeys.secretTitle')}
        open={reveal !== null}
        onOk={closeReveal}
        onCancel={closeReveal}
        okText={t('apiKeys.ok')}
        cancelButtonProps={{ style: { display: 'none' } }}
        data-testid="api-key-reveal"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert type="warning" showIcon message={t('apiKeys.secretWarning')} />
          <Space.Compact style={{ width: '100%' }}>
            <Input readOnly value={reveal?.plaintext} data-testid="api-key-reveal-value" />
            <Button icon={<CopyOutlined />} onClick={handleCopy} data-testid="api-key-reveal-copy">
              {copied ? t('apiKeys.copied') : t('apiKeys.copy')}
            </Button>
          </Space.Compact>
          <Typography.Text type="secondary">{reveal?.name}</Typography.Text>
        </Space>
      </Modal>
    </div>
  );
}
