import { Form, Input, Button, Grid, notification } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSetupStore } from '../../../stores/setup';
import { createAdmin } from '../../../api/setup';

interface AdminFormData {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface StepProps {
  next: () => void;
  prev: () => void;
  stepTitleRef: React.RefObject<HTMLHeadingElement | null>;
}

export default function AdminStep({ next, prev, stepTitleRef }: StepProps) {
  const { t } = useTranslation();
  const { md } = Grid.useBreakpoint();
  const { setAdminData, isLoading, setLoading, setError } = useSetupStore();
  const [form] = Form.useForm<AdminFormData>();

  const handleSubmit = async (values: AdminFormData) => {
    setLoading(true);
    setError(null);
    try {
      await createAdmin({ name: values.name, email: values.email, password: values.password });
      setAdminData({ name: values.name, email: values.email, password: values.password });
      next();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: { code?: string } } }; message?: string };
      const code = error.response?.data?.error?.code;
      if (code === 'ADMIN_EXISTS') {
        notification.error({ message: t('setup.errors.adminExists') });
      } else {
        notification.error({
          message: t('setup.errors.serverError'),
          description: error.message,
        });
      }
      setError(t('setup.errors.setupFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div role="region" aria-labelledby="admin-title">
      <h2 id="admin-title" ref={stepTitleRef} tabIndex={-1}>
        {t('setup.admin.title')}
      </h2>

      <Form
        form={form}
        onFinish={handleSubmit}
        layout={md ? 'horizontal' : 'vertical'}
        aria-label={t('setup.admin.title')}
        style={{ maxWidth: 600 }}
      >
        <Form.Item
          label={t('setup.admin.name')}
          name="name"
          rules={[{ required: true, message: t('setup.admin.nameRequired') }]}
        >
          <Input aria-required="true" placeholder={t('setup.admin.namePlaceholder')} />
        </Form.Item>

        <Form.Item
          label={t('setup.admin.email')}
          name="email"
          rules={[
            { required: true, message: t('setup.admin.emailRequired') },
            { type: 'email', message: t('setup.admin.emailInvalid') },
          ]}
        >
          <Input aria-required="true" placeholder={t('setup.admin.emailPlaceholder')} />
        </Form.Item>

        <Form.Item
          label={t('setup.admin.password')}
          name="password"
          rules={[
            { required: true, message: t('setup.admin.passwordRequired') },
            { min: 8, message: t('setup.admin.passwordMinLength') },
            {
              pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
              message: t('setup.admin.passwordPattern'),
            },
          ]}
        >
          <Input.Password
            aria-required="true"
            placeholder={t('setup.admin.passwordPlaceholder')}
          />
        </Form.Item>

        <Form.Item
          label={t('setup.admin.confirmPassword')}
          name="confirmPassword"
          dependencies={['password']}
          rules={[
            { required: true, message: t('setup.admin.confirmPasswordRequired') },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(t('setup.admin.confirmPasswordMismatch')),
                );
              },
            }),
          ]}
        >
          <Input.Password
            aria-required="true"
            placeholder={t('setup.admin.confirmPasswordPlaceholder')}
          />
        </Form.Item>

        <Form.Item>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={prev}>{t('setup.navigation.previous')}</Button>
            <Button type="primary" htmlType="submit" loading={isLoading}>
              {t('setup.navigation.next')}
            </Button>
          </div>
        </Form.Item>
      </Form>
    </div>
  );
}
