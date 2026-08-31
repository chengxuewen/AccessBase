import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Popconfirm, Space, Spin, Switch, Tag, message } from 'antd';
import { deleteUser, changeUserStatus, getUser, type User } from '../../api/users';

export default function UserDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusSaving, setStatusSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getUser(id)
      .then(setUser)
      .catch(() => message.error(t('users.deleteError')))
      .finally(() => setLoading(false));
  }, [id, t]);

  const handleStatusToggle = async (checked: boolean) => {
    if (!id || !user) return;
    const next = checked ? 'active' : 'suspended';
    try {
      setStatusSaving(true);
      const updated = await changeUserStatus(id, next);
      setUser({ ...user, isActive: updated.isActive });
      message.success(t('users.detail.statusToggleSuccess'));
    } catch {
      message.error(t('users.detail.statusToggleError'));
    } finally {
      setStatusSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteUser(id);
      message.success(t('users.detail.deleteSuccess'));
      navigate('/users');
    } catch {
      message.error(t('users.detail.deleteError'));
    }
  };

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '40vh auto' }} />;
  }

  if (!user) {
    return null;
  }

  return (
    <Card
      title={t('users.detail.title')}
      style={{ maxWidth: 640, margin: '0 auto' }}
      extra={
        <Space>
          <Button type="primary" onClick={() => navigate(`/users/${id}/edit`)}>
            {t('users.detail.editUser')}
          </Button>
          <Popconfirm
            title={t('users.detail.deleteConfirm')}
            onConfirm={handleDelete}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button danger>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      }
    >
      <Descriptions column={1} bordered>
        <Descriptions.Item label={t('users.name')}>{user.name}</Descriptions.Item>
        <Descriptions.Item label={t('users.email')}>{user.email}</Descriptions.Item>
        <Descriptions.Item label={t('users.detail.statusLabel')}>
          <Space>
            <Switch
              checked={user.isActive}
              loading={statusSaving}
              onChange={handleStatusToggle}
              checkedChildren={t('users.detail.statusActive')}
              unCheckedChildren={t('users.detail.statusSuspended')}
            />
            <Tag color={user.isActive ? 'green' : 'red'}>
              {user.isActive ? t('users.detail.statusActive') : t('users.detail.statusSuspended')}
            </Tag>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('users.detail.roles')}>
          {user.roles && user.roles.length > 0 ? (
            <Space>
              {user.roles.map((r) => (
                <Tag key={r.id}>{r.name}</Tag>
              ))}
            </Space>
          ) : (
            t('users.detail.noRoles')
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('users.detail.createdAt')}>
          {new Date(user.createdAt).toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item label={t('users.detail.updatedAt')}>
          {new Date(user.updatedAt).toLocaleString()}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
