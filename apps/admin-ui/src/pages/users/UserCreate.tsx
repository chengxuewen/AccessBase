import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { Alert, Button, Card, Form, Input, Popconfirm, Select, Space, Switch } from 'antd';
import { createUser } from '../../api/users';
import { listRoles } from '../../api/roles';
import { message } from '../../api/feedback';
import { apiErrorMessage } from '../../api/errors';

// Password policy client mirror — keep in sync with server enforcement.
// ponytail: mirrors PasswordProvider policy (packages/identity); share a constant if policy becomes configurable
const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// isActive/roleIds are accepted by POST /users (T2-2): isActive defaults active,
// roleIds are tenant-validated then assigned via RoleManager.setUserRoles.
// confirmPassword is UI-only and stripped before the API call.
export default function UserCreate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [roleOptions, setRoleOptions] = useState<{ label: string; value: string }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState(false);

  const fetchRoles = useCallback(() => {
    setRolesLoading(true);
    setRolesError(false);
    listRoles({ page: 1, pageSize: 100 })
      .then((result) => setRoleOptions(result.data.map((r) => ({ label: r.name, value: r.id }))))
      .catch(() => setRolesError(true))
      .finally(() => setRolesLoading(false));
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const { confirmPassword: _confirmPassword, ...payload } = values;
      await createUser(payload);
      message.success(t('users.createSuccess'));
      navigate('/users');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      if (isAxiosError(err) && err.response?.status === 409) {
        form.setFields([{ name: 'email', errors: [apiErrorMessage(err, t('users.emailExists'))] }]);
      } else {
        message.error(apiErrorMessage(err, t('users.createError')));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (dirty) setCancelOpen(true);
    else navigate(-1);
  };

  return (
    <Card title={t('users.createTitle')} style={{ width: '100%', maxWidth: 560, margin: '0 auto' }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ isActive: true, roleIds: [] }}
        onFinish={handleSubmit}
        onValuesChange={() => setDirty(true)}
        validateTrigger={['onChange', 'onBlur']}
        requiredMark="optional"
      >
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
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('users.password')}
          extra={t('users.passwordPolicy')}
          rules={[
            { required: true, message: t('users.passwordRequired') },
            {
              validator: (_, value: string | undefined) =>
                !value || PASSWORD_POLICY.test(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('users.passwordPolicy'))),
            },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label={t('users.confirmPassword')}
          dependencies={['password']}
          rules={[
            {
              validator: (_, value: string | undefined) => {
                const password = form.getFieldValue('password');
                return password && value !== password
                  ? Promise.reject(new Error(t('users.passwordMismatch')))
                  : Promise.resolve();
              },
            },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="isActive" label={t('users.status')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="roleIds" label={t('users.roles')}>
          <Select
            mode="multiple"
            options={roleOptions}
            loading={rolesLoading}
            placeholder={roleOptions.length === 0 ? t('users.rolesEmpty') : t('users.rolesPlaceholder')}
          />
        </Form.Item>
        {rolesError && (
          <Alert
            type="error"
            showIcon
            message={t('users.rolesLoadError')}
            action={
              <Button size="small" data-testid="roles-retry" onClick={fetchRoles}>
                {t('common.retry')}
              </Button>
            }
          />
        )}
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              {t('common.save')}
            </Button>
            <Popconfirm
              title={t('users.discardConfirm')}
              open={cancelOpen}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              onConfirm={() => {
                setCancelOpen(false);
                navigate(-1);
              }}
              onCancel={() => setCancelOpen(false)}
            >
              <Button onClick={handleCancel}>{t('common.cancel')}</Button>
            </Popconfirm>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
