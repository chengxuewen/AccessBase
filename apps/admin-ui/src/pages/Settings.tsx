import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  List,
  Popconfirm,
  Space,
  Spin,
  Tabs,
  Tag,
} from 'antd';
import {
  SafetyOutlined,
  KeyOutlined,
  GlobalOutlined,
  PlusOutlined,
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

const SITE_SETTINGS_KEY = 'accessbase.site-settings';

/** ponytail: General tab persists to localStorage — real settings API is Task 5+ scope */
function loadSiteSettings(): { siteName: string; logoUrl: string } {
  try {
    const raw = localStorage.getItem(SITE_SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as { siteName: string; logoUrl: string };
  } catch {
    // corrupted storage → defaults
  }
  return { siteName: '', logoUrl: '' };
}

export default function Settings() {
  const { t } = useTranslation();

  // --- General tab (localStorage only, backend out of scope) ---
  const [siteForm] = Form.useForm();
  const [siteSaved, setSiteSaved] = useState(false);

  const handleSaveSite = () => {
    const values = siteForm.getFieldsValue() as { siteName?: string; logoUrl?: string };
    localStorage.setItem(
      SITE_SETTINGS_KEY,
      JSON.stringify({ siteName: values.siteName ?? '', logoUrl: values.logoUrl ?? '' }),
    );
    setSiteSaved(true);
  };

  // --- Security tab: sessions ---
  const [sessions, setSessions] = useState<SafeSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadSessions = () => {
    setSessionsLoading(true);
    setSessionsError(null);
    getSessions()
      .then(setSessions)
      .catch(() => setSessionsError(t('settings.sessionsLoadError')))
      .finally(() => setSessionsLoading(false));
  };

  const handleRevoke = async (id: string) => {
    setSessionsError(null);
    try {
      await revokeSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setSessionsError(t('settings.sessionRevokeError'));
    }
  };

  // --- Security tab: passkeys ---
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [passkeysError, setPasskeysError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const loadPasskeys = () => {
    setPasskeysLoading(true);
    setPasskeysError(null);
    getPasskeys()
      .then(setPasskeys)
      .catch(() => setPasskeysError(t('settings.passkeysLoadError')))
      .finally(() => setPasskeysLoading(false));
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionsTab = (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title={t('settings.activeSessions')} data-testid="active-sessions">
        {sessionsError && (
          <Alert type="error" showIcon message={sessionsError} style={{ marginBottom: 16 }} data-testid="sessions-error" />
        )}
        <Spin spinning={sessionsLoading}>
          {sessions.length === 0 && !sessionsLoading ? (
            <span style={{ color: '#999' }}>{t('settings.noSessions')}</span>
          ) : (
            <List
              dataSource={sessions}
              renderItem={(item) => (
                <List.Item
                  data-testid={`session-${item.id}`}
                  actions={[
                    <Popconfirm
                      key="revoke"
                      title={t('settings.revokeConfirm')}
                      onConfirm={() => handleRevoke(item.id)}
                      okText={t('common.confirm')}
                      cancelText={t('common.cancel')}
                    >
                      <Button danger size="small" data-testid={`revoke-session-${item.id}`}>
                        {t('settings.revoke')}
                      </Button>
                    </Popconfirm>,
                  ]}
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

      <Card title={t('settings.passkeys')} data-testid="passkeys">
        {passkeysError && (
          <Alert type="error" showIcon message={passkeysError} style={{ marginBottom: 16 }} data-testid="passkeys-error" />
        )}
        <Spin spinning={passkeysLoading}>
          {passkeys.length === 0 && !passkeysLoading ? (
            <span style={{ color: '#999' }}>{t('settings.noPasskeys')}</span>
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
    <Card title={t('settings.general')} style={{ maxWidth: 560 }} data-testid="general-settings">
      {siteSaved && (
        <Alert type="success" showIcon message={t('settings.saveSuccess')} style={{ marginBottom: 16 }} data-testid="site-save-success" />
      )}
      <Form form={siteForm} layout="vertical">
        <Form.Item name="siteName" label={t('settings.siteName')}>
          <Input placeholder={t('settings.siteNamePlaceholder')} />
        </Form.Item>
        <Form.Item name="logoUrl" label={t('settings.logoUrl')}>
          <Input placeholder="https://…" />
        </Form.Item>
        <Button type="primary" htmlType="submit" onClick={handleSaveSite} data-testid="save-site-settings">
          {t('common.save')}
        </Button>
      </Form>
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
      ]}
    />
  );
}
