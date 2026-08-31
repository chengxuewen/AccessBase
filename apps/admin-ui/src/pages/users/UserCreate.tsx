import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Select, Switch, message } from 'antd';
import { createUser, type User } from '../../api/users';
import { listRoles } from '../../api/roles';
import { useEffect } from 'react';

// ponytail: isActive/roleIds are sent for forward-compat — backend POST /users
// currently ignores both; wire UserManager role assignment when it exists.
export default function UserCreate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [roleOptions, setRoleOptions] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    listRoles({ page: 1, pageSize: 100 })
      .then((result) => setRoleOptions(result.data.map((r) => ({ label: r.name, value: r.id }))))
      .catch(() => setRoleOptions([]));
  }, []);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await createUser(values);
      message.success(t('users.createSuccess'));
      navigate('/users');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(t('users.createError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('users.createTitle')} style={{ maxWidth: 560, margin: '0 auto' }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ isActive: true, roleIds: [] }}
        onFinish={handleSubmit}
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
          <Input />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('users.password')}
          rules={[{ required: true, message: t('users.passwordRequired') }]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item name="isActive" label={t('users.status')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="roleIds" label={t('users.roles')}>
          <Select mode="multiple" options={roleOptions} placeholder={t('users.roles')} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            {t('common.save')}
          </Button>
          <Button style={{ marginLeft: 8 }} onClick={() => navigate('/users')}>
            {t('common.cancel')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
