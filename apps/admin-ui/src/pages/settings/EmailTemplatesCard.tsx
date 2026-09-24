import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import {
  fetchEmailTemplates,
  updateEmailTemplate,
  previewEmailTemplate,
  testEmailTemplate,
  type EmailTemplate,
  type EmailTemplateId,
  type TemplatePreview,
} from '../../api/emailTemplates';
import { apiErrorMessage, apiErrorStatus } from '../../api/errors';
import { message } from '../../api/feedback';
import { useAuthStore } from '../../stores/auth';

// Sample substitution set from the Q4c contract — preview always renders the
// STORED template (server route), these vars only fill {{placeholders}}.
const SAMPLE_VARS: Record<string, string | number> = {
  link: 'https://example.invalid/x',
  name: 'Ada',
  invitee: 'bob@example.com',
  inviter: 'Ada',
  hours: 24,
};

interface TemplateFormValues {
  subjectEn?: string;
  subjectZh?: string;
  htmlEn?: string;
  htmlZh?: string;
}

export default function EmailTemplatesCard() {
  const { t } = useTranslation();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('options:write');

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Edit drawer state (one template at a time; preview + test live inside)
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<TemplateFormValues>();

  const [previewLocale, setPreviewLocale] = useState<'en' | 'zh'>('en');
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [testTo, setTestTo] = useState('');
  const [sending, setSending] = useState(false);
  const [smtpDown, setSmtpDown] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    fetchEmailTemplates()
      .then((rows) => setTemplates(rows))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (record: EmailTemplate) => {
    setEditing(record);
    setPreview(null);
    setSmtpDown(false);
    setTestTo('');
  };

  const closeEdit = () => {
    setEditing(null);
    setPreview(null);
    setSmtpDown(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    let values: TemplateFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // field errors render inline
    }
    const subjectEn = (values.subjectEn ?? '').trim();
    const subjectZh = (values.subjectZh ?? '').trim();
    const htmlEn = (values.htmlEn ?? '').trim();
    const htmlZh = (values.htmlZh ?? '').trim();
    setSaving(true);
    try {
      const merged = await updateEmailTemplate(editing.id, {
        subject: { ...(subjectEn ? { en: subjectEn } : {}), ...(subjectZh ? { zh: subjectZh } : {}) },
        html: { ...(htmlEn ? { en: htmlEn } : {}), ...(htmlZh ? { zh: htmlZh } : {}) },
      });
      setTemplates((prev) => prev.map((row) => (row.id === merged.id ? merged : row)));
      setEditing(merged);
      message.success(t('settings.emailTemplates.saved'));
    } catch (err) {
      message.error(apiErrorMessage(err, t('settings.emailTemplates.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!editing) return;
    setPreviewing(true);
    try {
      setPreview(await previewEmailTemplate(editing.id, previewLocale, SAMPLE_VARS));
    } catch (err) {
      message.error(apiErrorMessage(err, t('settings.emailTemplates.previewError')));
    } finally {
      setPreviewing(false);
    }
  };

  const handleTestSend = async () => {
    if (!editing) return;
    const to = testTo.trim();
    if (!to) {
      message.error(t('settings.emailTemplates.toRequired'));
      return;
    }
    setSending(true);
    setSmtpDown(false);
    try {
      await testEmailTemplate(editing.id, to);
      message.success(t('settings.emailTemplates.sent'));
    } catch (err) {
      // 502 SMTP_UNAVAILABLE → persistent warning Alert, other errors → toast
      if (apiErrorStatus(err) === 502) setSmtpDown(true);
      else message.error(apiErrorMessage(err, t('settings.emailTemplates.sendError')));
    } finally {
      setSending(false);
    }
  };

  const columns: ColumnsType<EmailTemplate> = [
    {
      title: t('settings.emailTemplates.template'),
      dataIndex: 'id',
      render: (id: EmailTemplateId) => t(`settings.emailTemplates.ids.${id}`),
    },
    {
      title: t('settings.emailTemplates.source'),
      dataIndex: 'overridden',
      render: (overridden: boolean) =>
        overridden ? (
          <Tag color="green" data-testid="email-templates-overridden">
            {t('settings.emailTemplates.overridden')}
          </Tag>
        ) : (
          <Tag data-testid="email-templates-default">{t('settings.emailTemplates.defaultTag')}</Tag>
        ),
    },
    {
      title: t('settings.emailTemplates.actions'),
      render: (_, record) =>
        canWrite ? (
          <Button type="link" size="small" onClick={() => openEdit(record)} data-testid="email-templates-edit">
            {t('common.edit')}
          </Button>
        ) : null,
    },
  ];

  return (
    <Card
      title={t('settings.emailTemplates.title')}
      style={{ width: '100%' }}
      data-testid="email-templates-card"
      extra={
        <Button icon={<ReloadOutlined />} onClick={load} data-testid="email-templates-reload">
          {t('common.retry')}
        </Button>
      }
    >
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('settings.emailTemplates.loadError')}
          style={{ marginBottom: 16 }}
          data-testid="email-templates-load-error"
        />
      )}
      <Table<EmailTemplate>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={templates}
        pagination={false}
        data-testid="email-templates-table"
      />

      <Drawer
        title={t('settings.emailTemplates.drawerTitle', {
          name: editing ? t(`settings.emailTemplates.ids.${editing.id}`) : '',
        })}
        width={640}
        open={editing !== null}
        onClose={closeEdit}
        destroyOnHidden
        extra={
          <Button type="primary" loading={saving} onClick={() => void handleSave()} data-testid="email-templates-save">
            {t('common.save')}
          </Button>
        }
      >
        {editing && (
          <div data-testid="email-templates-drawer">
          <Space direction="vertical" size="large" style={{ display: 'flex' }}>
            <Form
              form={form}
              layout="vertical"
              key={editing.id}
              initialValues={{
                subjectEn: editing.subject.en ?? '',
                subjectZh: editing.subject.zh ?? '',
                htmlEn: editing.html.en ?? '',
                htmlZh: editing.html.zh ?? '',
              }}
            >
              <Form.Item name="subjectEn" label={t('settings.emailTemplates.subjectEn')}>
                <Input data-testid="email-templates-subject-en" />
              </Form.Item>
              <Form.Item name="subjectZh" label={t('settings.emailTemplates.subjectZh')}>
                <Input data-testid="email-templates-subject-zh" />
              </Form.Item>
              <Form.Item name="htmlEn" label={t('settings.emailTemplates.htmlEn')}>
                <Input.TextArea rows={6} data-testid="email-templates-html-en" />
              </Form.Item>
              <Form.Item name="htmlZh" label={t('settings.emailTemplates.htmlZh')}>
                <Input.TextArea rows={6} data-testid="email-templates-html-zh" />
              </Form.Item>
            </Form>

            <div>
              <Typography.Title level={5}>{t('settings.emailTemplates.preview')}</Typography.Title>
              <Typography.Text type="secondary">{t('settings.emailTemplates.previewHint')}</Typography.Text>
              <Space style={{ marginTop: 8, marginBottom: 8 }}>
                <Radio.Group
                  value={previewLocale}
                  onChange={(e) => setPreviewLocale(e.target.value as 'en' | 'zh')}
                  options={[
                    { label: 'en', value: 'en' },
                    { label: 'zh', value: 'zh' },
                  ]}
                  optionType="button"
                  data-testid="email-templates-preview-locale"
                />
                <Button loading={previewing} onClick={() => void handlePreview()} data-testid="email-templates-preview-run">
                  {t('settings.emailTemplates.previewRun')}
                </Button>
              </Space>
              {preview && (
                <div data-testid="email-templates-preview">
                  <Typography.Paragraph strong data-testid="email-templates-preview-subject">
                    {preview.subject}
                  </Typography.Paragraph>
                  <iframe
                    title={t('settings.emailTemplates.preview')}
                    sandbox=""
                    srcDoc={preview.html}
                    style={{ width: '100%', height: 240, border: '1px solid #d9d9d9' }}
                    data-testid="email-templates-preview-frame"
                  />
                </div>
              )}
            </div>

            <div>
              <Typography.Title level={5}>{t('settings.emailTemplates.testSend')}</Typography.Title>
              {smtpDown && (
                <Alert
                  type="warning"
                  showIcon
                  message={t('settings.emailTemplates.smtpUnavailable')}
                  style={{ marginBottom: 8 }}
                  data-testid="email-templates-smtp-alert"
                />
              )}
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder={t('settings.emailTemplates.toPlaceholder')}
                  data-testid="email-templates-test-to"
                />
                <Button loading={sending} onClick={() => void handleTestSend()} data-testid="email-templates-test-send">
                  {t('settings.emailTemplates.sendTest')}
                </Button>
              </Space.Compact>
            </div>
          </Space>
          </div>
        )}
      </Drawer>
    </Card>
  );
}
