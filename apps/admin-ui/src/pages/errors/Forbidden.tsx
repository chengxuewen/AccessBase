import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Result } from 'antd';
import { landingPath } from '../../utils/landing';
import { useAuthStore } from '../../stores/auth';

export default function Forbidden() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Result
      status="403"
      title="403"
      subTitle={t('errors.forbidden.subTitle')}
      extra={
        <Button type="primary" onClick={() => navigate(landingPath(useAuthStore.getState().user?.permissions))}>
          {t('errors.backToDashboard')}
        </Button>
      }
    />
  );
}
