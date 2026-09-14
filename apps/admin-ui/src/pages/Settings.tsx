import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SafetyOutlined,
  KeyOutlined,
  GlobalOutlined,
  SlidersOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import {
  getSessions,
  revokeSession,
  getPasskeys,
  deletePasskey,
  getWebAuthnRegisterOptions,
  verifyWebAuthnRegistration,
  type SafeSessionInfo,
  type PasskeyCredential,
} from '../api/auth';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useAuthStore } from '../stores/auth';
import { loadSiteSettings, saveSiteSettings } from '../siteSettings';
import { listOptions, setOption, deleteOption, type OptionRow } from '../api/options';
import { message } from '../api/feedback';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';
import { resolveLang } from '../utils/locale';

// register relativeTime once at module load; per-render extend would be wasteful
dayjs.extend(relativeTime);

import MfaCard from './settings/MfaCard';

// Client-side mirror of server SENSITIVE_KEY_PATTERN (routes/options.ts) —
// DISPLAY masking only; the server remains the authority on mask rejection.
const SENSITIVE_KEY_PATTERN = /secret|password|token|key/i;
const MASK = '******';
const OPTION_KEY_PATTERN = /^[a-z][a-zA-Z0-9_.-]{1,63}$/;

interface OptionFormValues {
  key?: string;
  valueText?: string;
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManageOptions = hasPermission('options:read');
  // relative timestamps follow the UI language (register ≠ activate in dayjs)
  dayjs.locale(resolveLang(i18n.language) === 'zh' ? 'zh-cn' : 'en');

  // --- General tab (localStorage only, backend out of scope) ---
  const [siteForm] = Form.useForm();
  const [siteSaved, setSiteSaved] = useState(false);

  const handleSaveSite = async () => {
    try {
      await siteForm.validateFields();
    } catch {
      return; // field-level errors are rendered inline by antd
    }
    const values = siteForm.getFieldsValue() as { siteName?: string; logoUrl?: string };
    saveSiteSettings({ siteName: values.siteName ?? '', logoUrl: values.logoUrl ?? '' });
    setSiteSaved(true);
  };

  // --- Security tab: sessions ---
  const [sessions, setSessions] = useState<SafeSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    setSessionsLoading(true);
    setSessionsError(null);
    // our refresh token lets the server flag the caller's own session current:true
    getSessions(useAuthStore.getState().refreshToken ?? undefined)
      .then(setSessions)
      .catch(() => setSessionsError(t('settings.sessionsLoadError')))
      .finally(() => setSessionsLoading(false));
  }, [t]);

  const doRevoke = async (id: string) => {
    setSessionsError(null);
    try {
      await revokeSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setSessionsError(t('settings.sessionRevokeError'));
    }
  };

  const handleRevoke = (item: SafeSessionInfo) => {
    if (item.current) {
      // unreachable via UI (current rows render a Tag, no button); hard guard as defense-in-depth
      Modal.confirm({
        title: t('settings.revokeCurrentTitle'),
        content: t('settings.revokeCurrentWarning'),
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        onOk: () => void doRevoke(item.id),
      });
      return;
    }
    void doRevoke(item.id);
  };

  // --- Security tab: passkeys ---
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [passkeysError, setPasskeysError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const loadPasskeys = useCallback(() => {
    setPasskeysLoading(true);
    setPasskeysError(null);
    getPasskeys()
      .then(setPasskeys)
      .catch(() => setPasskeysError(t('settings.passkeysLoadError')))
      .finally(() => setPasskeysLoading(false));
  }, [t]);

  const handleRegisterPasskey = async () => {
    setPasskeysError(null);
    setRegistering(true);
    try {
      const { options, flowToken } = await getWebAuthnRegisterOptions();
      const attestation = await startRegistration({
        optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
      });
      await verifyWebAuthnRegistration(flowToken, attestation);
      loadPasskeys();
    } catch {
      setPasskeysError(t('settings.passkeyRegisterError'));
    } finally {
      setRegistering(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    setPasskeysError(null);
    try {
      await deletePasskey(id);
      setPasskeys((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setPasskeysError(t('settings.passkeyDeleteError'));
    }
  };

  useEffect(() => {
    loadSessions();
    loadPasskeys();
    siteForm.setFieldsValue(loadSiteSettings());
  }, [loadSessions, loadPasskeys, siteForm]);

  const sessionsTab = (
    <Space direction="vertical" size="large" style={{ display: 'flex', width: '100%' }}>
      <Card title={t('settings.activeSessions')} data-testid="active-sessions">
        {sessionsError && (
          <Alert type="error" showIcon message={sessionsError} style={{ marginBottom: 16 }} data-testid="sessions-error" />
        )}
        <Spin spinning={sessionsLoading}>
          {sessions.length === 0 && !sessionsLoading ? (
            <Typography.Text type="secondary">{t('settings.noSessions')}</Typography.Text>
          ) : (
            <List
              dataSource={sessions}
              renderItem={(item) => (
                <List.Item
                  data-testid={`session-${item.id}`}
                  actions={
                    item.current
                      ? [
                          <Tag key="current" color="blue" data-testid={`session-current-${item.id}`}>
                            {t('settings.currentSession')}
                          </Tag>,
                        ]
                      : [
                          <Popconfirm
                            key="revoke"
                            title={t('settings.revokeConfirm')}
                            onConfirm={() => handleRevoke(item)}
                            okText={t('common.confirm')}
                            cancelText={t('common.cancel')}
                          >
                            <Button danger size="small" data-testid={`revoke-session-${item.id}`}>
                              {t('settings.revoke')}
                            </Button>
                          </Popconfirm>,
                        ]
                  }
                >
                  <List.Item.Meta
                    title={item.userAgent || t('settings.unknownDevice')}
                    description={`${item.ip} · ${new Date(item.createdAt).toLocaleString()}`}
                  />
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Card>

      <MfaCard />

      <Card title={t('settings.passkeys')} data-testid="passkeys">
        {passkeysError && (
          <Alert type="error" showIcon message={passkeysError} style={{ marginBottom: 16 }} data-testid="passkeys-error" />
        )}
        <Spin spinning={passkeysLoading}>
          {passkeys.length === 0 && !passkeysLoading ? (
            <Typography.Text type="secondary">{t('settings.noPasskeys')}</Typography.Text>
          ) : (
            <List
              dataSource={passkeys}
              renderItem={(item) => (
                <List.Item
                  data-testid={`passkey-${item.id}`}
                  actions={[
                    <Popconfirm
                      key="del"
                      title={t('settings.passkeyDeleteConfirm')}
                      onConfirm={() => handleDeletePasskey(item.id)}
                      okText={t('common.confirm')}
                      cancelText={t('common.cancel')}
                    >
                      <Button danger size="small" icon={<DeleteOutlined />} data-testid={`delete-passkey-${item.id}`}>
                        {t('common.delete')}
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<KeyOutlined />}
                    title={item.id.slice(0, 12) + '…'}
                    description={
                      <Space>
                        {item.transports.map((tr) => (
                          <Tag key={tr}>{tr}</Tag>
                        ))}
                        <span>
                          {t('settings.lastUsed')}:{' '}
                          {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : t('settings.never')}
                        </span>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Spin>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={registering}
          onClick={handleRegisterPasskey}
          style={{ marginTop: 16 }}
          data-testid="register-passkey"
        >
          {t('settings.registerPasskey')}
        </Button>
      </Card>
    </Space>
  );

  const generalTab = (
    <Card title={t('settings.general')} style={{ width: '100%' }} data-testid="general-settings">
      {siteSaved && (
        <Alert type="success" showIcon message={t('settings.saveSuccess')} style={{ marginBottom: 16, maxWidth: 400 }} data-testid="site-save-success" />
      )}
      <Form form={siteForm} layout="vertical" onValuesChange={() => setSiteSaved(false)} style={{ maxWidth: 400 }}>
        <Form.Item name="siteName" label={t('settings.siteName')}>
          <Input placeholder={t('settings.siteNamePlaceholder')} />
        </Form.Item>
        <Form.Item
          name="logoUrl"
          label={t('settings.logoUrl')}
          rules={[{ type: 'url', message: t('settings.logoUrlInvalid') }]}
        >
          <Input placeholder="https://…" />
        </Form.Item>
        <Button type="primary" htmlType="submit" onClick={handleSaveSite} data-testid="save-site-settings">
          {t('common.save')}
        </Button>
      </Form>
    </Card>
  );

  // --- Options tab: runtime key/value config ---
  const [optionForm] = Form.useForm<OptionFormValues>();
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionModalOpen, setOptionModalOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<OptionRow | null>(null);
  const [savingOption, setSavingOption] = useState(false);

  const loadOptions = useCallback(() => {
    setOptionsLoading(true);
    setOptionsError(null);
    listOptions()
      .then((res) => setOptions(res.data.data ?? []))
      .catch(() => setOptionsError(t('settings.options.loadError')))
      .finally(() => setOptionsLoading(false));
  }, [t]);

  useEffect(() => {
    if (canManageOptions) loadOptions();
  }, [canManageOptions, loadOptions]);

  const openAddOption = () => {
    setEditingOption(null);
    optionForm.resetFields();
    setOptionModalOpen(true);
  };

  // Mask write-back guard (M5): never prefill '******' — blank = keep current.
  const openEditOption = (row: OptionRow) => {
    setEditingOption(row);
    optionForm.setFieldsValue({ key: row.key, valueText: '' });
    setOptionModalOpen(true);
  };

  const handleSaveOption = async () => {
    let values: OptionFormValues;
    try {
      values = await optionForm.validateFields();
    } catch {
      return; // field-level errors are rendered inline by antd
    }
    const key = values.key?.trim() ?? '';
    const raw = (values.valueText ?? '').trim();
    // Edit of a sensitive row with a blank value = keep current, no PUT.
    if (editingOption && raw === '') return;
    let parsed: unknown;
    try {
      parsed = raw === '' ? '' : JSON.parse(raw);
    } catch {
      optionForm.setFields([{ name: 'valueText', errors: [t('settings.options.invalidJson')] }]);
      return;
    }
    setSavingOption(true);
    try {
      const { data } = await setOption(key, parsed);
      const saved = data.data;
      setOptions((prev) => {
        const rest = prev.filter((o) => o.key !== key);
        return [...rest, { key, value: saved?.value ?? parsed, updatedAt: saved ? saved.updatedAt : new Date().toISOString() }].sort(
          (a, b) => a.key.localeCompare(b.key),
        );
      });
      message.success(t('settings.options.saveSuccess'));
      setOptionModalOpen(false);
    } catch {
      message.error(t('settings.options.saveError'));
    } finally {
      setSavingOption(false);
    }
  };

  const handleDeleteOption = async (key: string) => {
    try {
      await deleteOption(key);
      setOptions((prev) => prev.filter((o) => o.key !== key));
    } catch {
      message.error(t('settings.options.deleteError'));
    }
  };

  const optionColumns: ColumnsType<OptionRow> = [
    {
      title: t('settings.options.key'),
      dataIndex: 'key',
      render: (value: string) => <code>{value}</code>,
    },
    {
      title: t('settings.options.value'),
      dataIndex: 'value',
      render: (value: unknown, record: OptionRow) => (
        <code data-testid={`option-value-${record.key}`}>
          {SENSITIVE_KEY_PATTERN.test(record.key) ? MASK : JSON.stringify(value)}
        </code>
      ),
    },
    {
      title: t('settings.options.updatedAt'),
      dataIndex: 'updatedAt',
      render: (value: string) => dayjs(value).fromNow(),
    },
    {
      title: t('settings.options.actions'),
      render: (_, record: OptionRow) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditOption(record)}
            data-testid={`edit-option-${record.key}`}
          >
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('settings.options.deleteConfirm')}
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleDeleteOption(record.key)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button danger type="link" size="small" icon={<DeleteOutlined />} data-testid={`delete-option-${record.key}`}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const optionsTab = (
    <Card
      title={t('settings.options.title')}
      extra={(
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddOption} data-testid="add-option">
          {t('settings.options.add')}
        </Button>
      )}
      style={{ width: '100%' }}
      data-testid="options-settings"
    >
      {optionsError && (
        <Alert type="error" showIcon message={optionsError} style={{ marginBottom: 16 }} data-testid="options-error" />
      )}
      <Table<OptionRow>
        rowKey="key"
        size="small"
        columns={optionColumns}
        dataSource={options}
        loading={optionsLoading}
        pagination={false}
        locale={{ emptyText: t('settings.options.empty') }}
        data-testid="options-table"
      />

      <Modal
        title={editingOption ? t('settings.options.editTitle') : t('settings.options.addTitle')}
        open={optionModalOpen}
        forceRender
        onOk={() => void handleSaveOption()}
        onCancel={() => setOptionModalOpen(false)}
        confirmLoading={savingOption}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        destroyOnHidden
      >
        <Form form={optionForm} layout="vertical">
          <Form.Item
            name="key"
            rules={[
              { required: true, message: t('settings.options.keyRequired') },
              { pattern: OPTION_KEY_PATTERN, message: t('settings.options.invalidKey') },
            ]}
          >
            <Input
              placeholder="my_feature.flag"
              disabled={editingOption !== null}
              data-testid="option-key-input"
            />
          </Form.Item>
          <Form.Item name="valueText" label={t('settings.options.value')} extra={editingOption ? t('settings.options.editValueHint') : undefined}>
            <Input.TextArea
              rows={4}
              placeholder={editingOption ? t('settings.options.editValuePlaceholder') : t('settings.options.valuePlaceholder')}
              data-testid="option-value-input"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );

  return (
    <Tabs
      defaultActiveKey="general"
      items={[
        {
          key: 'general',
          label: (
            <span>
              <GlobalOutlined /> {t('settings.general')}
            </span>
          ),
          children: generalTab,
        },
        {
          key: 'security',
          label: (
            <span>
              <SafetyOutlined /> {t('settings.security')}
            </span>
          ),
          children: sessionsTab,
        },
        ...(canManageOptions
          ? [
              {
                key: 'options',
                label: (
                  <span>
                    <SlidersOutlined /> {t('settings.options.tab')}
                  </span>
                ),
                children: optionsTab,
              },
            ]
          : []),
      ]}
    />
  );
}
