import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import {
  listClients,
  createClient,
  rotateClientSecret,
  deleteClient,
  type OidcClient,
} from '../api/clients';
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

const GRANT_TYPES = ['authorization_code', 'client_credentials'] as const;
const TOKEN_AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'none'] as const;
const DEFAULT_SCOPE = 'openid profile email';

interface CreateFormValues {
  name?: string;
  redirectUrisText?: string;
  grantTypes?: string[];
  scope?: string;
  tokenAuthMethod?: string;
}

export default function Clients() {
  const { t, i18n } = useTranslation();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('clients:write');
  // relative timestamps follow the UI language (register ≠ activate in dayjs)
  dayjs.locale(resolveLang(i18n.language) === 'zh' ? 'zh-cn' : 'en');

  const actionRef = useRef<ActionType>(null);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();
  // Secret reveal: one-time plaintext (create result or rotate result)
  const [reveal, setReveal] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const openCreate = () => {
    form.resetFields();
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      setCreating(true);
      const created = await createClient({
        name: (values.name ?? '').trim(),
        redirectUris: (values.redirectUrisText ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        grantTypes: values.grantTypes ?? [],
        scope: (values.scope ?? '').trim(),
        tokenAuthMethod: values.tokenAuthMethod,
      });
      setCreateOpen(false);
      setReveal({ clientId: created.clientId, clientSecret: created.clientSecret });
      setCopied(false);
      message.success(t('clients.created'));
    } catch (err) {
      message.error(apiErrorMessage(err, t('clients.createError')));
    } finally {
      setCreating(false);
    }
  };

  const handleRotate = async (record: OidcClient) => {
    try {
      const result = await rotateClientSecret(record.clientId);
      setReveal(result);
      setCopied(false);
      message.success(t('clients.rotated'));
    } catch (err) {
      message.error(apiErrorMessage(err, t('clients.rotateError')));
    }
  };

  const handleDelete = async (record: OidcClient) => {
    try {
      await deleteClient(record.clientId);
      message.success(t('clients.deleted'));
      actionRef.current?.reload();
    } catch (err) {
      message.error(apiErrorMessage(err, t('clients.deleteError')));
    }
  };

  const handleCopy = async () => {
    if (!reveal) return;
    const text = reveal.clientSecret;
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
      message.error(t('clients.copyFailed'));
    }
  };

  const closeReveal = () => {
    setReveal(null);
    actionRef.current?.reload();
  };

  const columns: ProColumns<OidcClient>[] = [
    { title: t('clients.name'), dataIndex: 'name' },
    { title: t('clients.clientId'), dataIndex: 'clientId', copyable: true },
    {
      title: t('clients.redirectUris'),
      dataIndex: 'redirectUris',
      search: false,
      ellipsis: true,
      render: (_, record) => record.redirectUris.join(', '),
    },
    {
      title: t('clients.grantTypes'),
      dataIndex: 'grantTypes',
      search: false,
      render: (_, record) =>
        record.grantTypes.map((g) => <Tag key={g}>{g}</Tag>),
    },
    { title: t('clients.scope'), dataIndex: 'scope', search: false },
    {
      title: t('clients.createdAt'),
      dataIndex: 'createdAt',
      render: (_, record) => dayjs(record.createdAt).fromNow(),
      search: false,
    },
  ];

  if (canWrite) {
    columns.push({
      title: t('clients.actions'),
      valueType: 'option',
      width: 220,
      render: (_, record) => [
        <Button key="rotate" type="link" size="small" onClick={() => handleRotate(record)}>
          {t('clients.rotateSecret')}
        </Button>,
        <Popconfirm
          key="delete"
          title={t('clients.deleteConfirm')}
          onConfirm={() => handleDelete(record)}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
        >
          <Button type="link" size="small" danger>
            <DeleteOutlined /> {t('common.delete')}
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
    <div data-testid="clients-page">
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('clients.loadError')}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRetry} data-testid="clients-load-retry">
              {t('common.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
          data-testid="clients-load-error"
        />
      )}
      <ProTable<OidcClient>
        headerTitle={t('clients.title')}
        actionRef={actionRef}
        rowKey="clientId"
        scroll={{ x: 'max-content' }}
        columns={columns}
        data-testid="clients-table"
        request={async () => {
          try {
            const data = await listClients();
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
                  data-testid="clients-create"
                >
                  {t('clients.create')}
                </Button>,
              ]
            : false
        }
      />

      <Modal
        title={t('clients.createTitle')}
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={creating}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical" initialValues={{ grantTypes: ['authorization_code'], scope: DEFAULT_SCOPE, tokenAuthMethod: 'client_secret_basic' }}>
          <Form.Item
            name="name"
            label={t('clients.name')}
            rules={[{ required: true, message: t('clients.nameRequired') }]}
          >
            <Input data-testid="clients-name-input" />
          </Form.Item>
          <Form.Item
            name="redirectUrisText"
            label={t('clients.redirectUris')}
            extra={t('clients.redirectUrisHint')}
            rules={[{ required: true, message: t('clients.redirectUrisRequired') }]}
          >
            <Input.TextArea rows={3} data-testid="clients-redirect-uris-input" />
          </Form.Item>
          <Form.Item
            name="grantTypes"
            label={t('clients.grantTypes')}
            rules={[{ required: true, message: t('clients.grantTypesRequired') }]}
          >
            <Checkbox.Group options={GRANT_TYPES.map((g) => ({ label: g, value: g }))} />
          </Form.Item>
          <Form.Item
            name="scope"
            label={t('clients.scope')}
            rules={[{ required: true, message: t('clients.scopeRequired') }]}
          >
            <Input data-testid="clients-scope-input" />
          </Form.Item>
          <Form.Item name="tokenAuthMethod" label={t('clients.tokenAuthMethod')}>
            <Select
              options={TOKEN_AUTH_METHODS.map((m) => ({ label: m, value: m }))}
              data-testid="clients-token-auth-select"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('clients.secretTitle')}
        open={reveal !== null}
        onOk={closeReveal}
        onCancel={closeReveal}
        okText={t('clients.ok')}
        cancelButtonProps={{ style: { display: 'none' } }}
        data-testid="secret-reveal"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert type="warning" showIcon message={t('clients.secretWarning')} />
          <Space.Compact style={{ width: '100%' }}>
            <Input readOnly value={reveal?.clientSecret} data-testid="secret-reveal-value" />
            <Button icon={<CopyOutlined />} onClick={handleCopy} data-testid="secret-reveal-copy">
              {copied ? t('clients.copied') : t('clients.copy')}
            </Button>
          </Space.Compact>
          <Typography.Text type="secondary">{reveal?.clientId}</Typography.Text>
        </Space>
      </Modal>
    </div>
  );
}
