import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Space,
  Spin,
  Tag,
  message,
} from 'antd';
import { EditOutlined, LogoutOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getCurrentUser, updateUser } from '../api/users';
import { changePassword, revokeOtherSessions } from '../api/auth';
import { useAuthStore } from '../stores/auth';

export default function Profile() {
  const { t } = useTranslation();
  const { refreshToken } = useAuthStore();
  const [user, setUser] = useState<{ id: string; email: string; name: string; isActive: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser({ id: u.id, email: u.email, name: u.name, isActive: u.isActive });
      })
      .catch(() => message.error(t('profile.loadError')))
      .finally(() => setLoading(false));
  }, [t, nameForm]);

  const handleSaveName = async () => {
    if (!user) return;
    try {
      const { name } = await nameForm.validateFields();
      setSavingName(true);
      const updated = await updateUser(user.id, { name });
      setUser({ ...user, name: updated.name ?? name });
      setEditingName(false);
      message.success(t('profile.nameUpdateSuccess'));
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(t('profile.nameUpdateError'));
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (values: { oldPassword: string; newPassword: string }) => {
    try {
      setChangingPwd(true);
      await changePassword({ oldPassword: values.oldPassword, newPassword: values.newPassword });
      setPwdError(null);
      pwdForm.resetFields();
    } catch (err: unknown) {
      // Backend enforces 12+ chars with classes; surface its VALIDATION_001 message on 400
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      const backendMsg = axiosErr?.response?.data?.error?.message;
      setPwdError(backendMsg ?? t('profile.passwordChangeError'));
    } finally {
      setChangingPwd(false);
    }
  };

  const handleRevokeOthers = async () => {
    if (!refreshToken) {
      message.error(t('profile.logoutOtherDevicesError'));
      return;
    }
    try {
      await revokeOtherSessions(refreshToken);
      message.success(t('profile.logoutOtherDevicesSuccess'));
    } catch {
      message.error(t('profile.logoutOtherDevicesError'));
    }
  };

  return (
    <Spin spinning={loading}>
    <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 720 }}>
      <Card
        title={t('profile.personalInfo')}
        extra={
          <Popconfirm
            title={t('profile.logoutOtherDevicesConfirm')}
            onConfirm={handleRevokeOthers}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button icon={<LogoutOutlined />} danger className="profile-revoke-others">
              {t('profile.logoutOtherDevices')}
            </Button>
          </Popconfirm>
        }
      >
        <Descriptions column={1}>
          <Descriptions.Item label={t('profile.name')}>
            {editingName ? (
              <Form form={nameForm} layout="inline" className="profile-name-form">
                <Form.Item
                  name="name"
                  rules={[{ required: true, message: t('profile.nameRequired') }]}
                >
                  <Input style={{ width: 200 }} />
                </Form.Item>
                <Button type="link" icon={<CheckOutlined />} loading={savingName} onClick={handleSaveName} className="profile-name-save" />
                <Button type="link" icon={<CloseOutlined />} onClick={() => setEditingName(false)} />
              </Form>
            ) : (
              <Space>
                <span className="profile-name">{user?.name}</span>
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    nameForm.setFieldsValue({ name: user?.name });
                    setEditingName(true);
                  }}
                  className="profile-name-edit"
                >
                  {t('profile.editName')}
                </Button>
              </Space>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t('profile.email')}>{user?.email}</Descriptions.Item>
          <Descriptions.Item label={t('profile.status')}>
            <Tag color={user?.isActive ? 'green' : 'red'}>
              {user?.isActive ? t('profile.statusActive') : t('profile.statusSuspended')}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={t('profile.changePassword')}>
        {/* UI-level min 8 for usability; the backend enforces the real policy (12 + classes) */}
        <Alert type="info" showIcon message={t('profile.passwordPolicyHint')} style={{ marginBottom: 16 }} />
        {pwdError && <Alert type="error" showIcon message={pwdError} style={{ marginBottom: 16 }} className="profile-pwd-error" />}
        <Form form={pwdForm} layout="vertical" onFinish={handleChangePassword} style={{ maxWidth: 400 }}>
          <Form.Item
            name="oldPassword"
            label={t('profile.currentPassword')}
            rules={[{ required: true, message: t('profile.currentPasswordRequired') }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label={t('profile.newPassword')}
            rules={[
              { required: true, message: t('profile.newPasswordRequired') },
              { min: 8, message: t('profile.newPasswordMinLength') },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t('profile.confirmPassword')}
            dependencies={['newPassword']}
            rules={[
              { required: true, message: t('profile.confirmPasswordRequired') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error(t('profile.confirmPasswordMismatch')));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={changingPwd} className="profile-password-submit">
            {t('profile.changePassword')}
          </Button>
        </Form>
      </Card>
    </Space>
    </Spin>
  );
}
