import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Form, Input, Select, message } from 'antd';
import { getUser, updateUser, type User } from '../../api/users';
import { listRoles } from '../../api/roles';

export default function UserEdit() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [roleOptions, setRoleOptions] = useState<{ label: string; value: string }[]>([]);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!id) return;
    getUser(id)
      .then((u) => {
        setUser(u);
        form.setFieldsValue({ name: u.name, roleIds: u.roleIds ?? [] });
      })
      .catch(() => message.error(t('users.updateError')));
    listRoles({ page: 1, pageSize: 100 })
      .then((result) => setRoleOptions(result.data.map((r) => ({ label: r.name, value: r.id }))))
      .catch(() => setRoleOptions([]));
  }, [id, form, t]);

  const handleSubmit = async () => {
    if (!id) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await updateUser(id, values);
      message.success(t('users.updateSuccess'));
      navigate(`/users/${id}`);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(t('users.updateError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('users.editTitle')} style={{ maxWidth: 560, margin: '0 auto' }}>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="name"
          label={t('users.name')}
          rules={[{ required: true, message: t('users.nameRequired') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label={t('users.email')}>
          <Input value={user?.email} disabled />
        </Form.Item>
        <Form.Item name="roleIds" label={t('users.roles')}>
          <Select mode="multiple" options={roleOptions} placeholder={t('users.roles')} />
        </Form.Item>
        {/* No password change here — password rotation lives in auth change-password flow */}
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            {t('common.save')}
          </Button>
          <Button
            style={{ marginLeft: 8 }}
            onClick={() => navigate(id ? `/users/${id}` : '/users')}
          >
            {t('common.cancel')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
