import { Button, Empty } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

export type EmptyVariant = 'no-data' | 'no-result' | 'error';

interface EmptyStateProps {
  variant?: EmptyVariant;
  action?: ReactNode;
}

export default function EmptyState({ variant = 'no-data', action }: EmptyStateProps) {
  const { t } = useTranslation();

  const description =
    variant === 'no-result'
      ? t('empty.noResult')
      : variant === 'error'
        ? t('empty.error')
        : t('empty.noData');

  return (
    <Empty
      description={description}
      image={variant === 'error' ? Empty.PRESENTED_IMAGE_SIMPLE : undefined}
      style={{ padding: '24px 0' }}
    >
      {action}
    </Empty>
  );
}
