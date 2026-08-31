import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Result } from 'antd';

export default function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Result
      status="404"
      title="404"
      subTitle={t('errors.notFound.subTitle')}
      extra={
        <Button type="primary" onClick={() => navigate('/dashboard')}>
          {t('errors.backToDashboard')}
        </Button>
      }
    />
  );
}
