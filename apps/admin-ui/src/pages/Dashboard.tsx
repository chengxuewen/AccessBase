import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Col, Row, Statistic, List, Tag, Button, Space, Alert, Spin } from 'antd';
import {
  UserOutlined,
  TeamOutlined,
  SafetyOutlined,
  AuditOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import i18n from '../i18n';

interface RecentActivityItem {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string | null;
  createdAt: string;
}

interface StatsData {
  users: number;
  roles: number;
  activeSessions: number;
  audits: number;
  recentActivity: RecentActivityItem[];
}

const relTime = (ts: number | string) => {
  const diffMin = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
  return rtf.format(-Math.round(diffMin / 60), 'hour');
};

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    client
      .get<{ data: StatsData }>('/v1/stats')
      .then((res) => setStats(res.data?.data ?? null))
      .catch(() => setError(t('dashboard.loadError')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const cards = [
    {
      title: t('dashboard.totalUsers'),
      value: stats?.users ?? 0,
      icon: <UserOutlined style={{ fontSize: 24, color: '#1890ff' }} />,
    },
    {
      title: t('dashboard.activeRoles'),
      value: stats?.roles ?? 0,
      icon: <TeamOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
    },
    {
      title: t('dashboard.activeSessions'),
      value: stats?.activeSessions ?? 0,
      icon: <SafetyOutlined style={{ fontSize: 24, color: '#faad14' }} />,
    },
    {
      title: t('dashboard.auditLogs'),
      value: stats?.audits ?? 0,
      icon: <AuditOutlined style={{ fontSize: 24, color: '#f5222d' }} />,
    },
  ];

  return (
    <div>
      <h2>{t('dashboard.title')}</h2>

      {error && (
        <Alert type="error" showIcon data-testid="dashboard-error" message={error} style={{ marginBottom: 16 }} />
      )}

      <Row gutter={[16, 16]}>
        {cards.map((stat) => (
          <Col xs={24} sm={12} lg={6} key={stat.title}>
            <Card>
              <Statistic title={stat.title} value={stat.value} prefix={stat.icon} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title={t('dashboard.recentActivity')} extra={<Button icon={<ReloadOutlined />} onClick={load} size="small" />}>
            {loading ? (
              <Spin data-testid="dashboard-loading" />
            ) : (
              <List
                data-testid="recent-activity"
                dataSource={stats?.recentActivity ?? []}
                locale={{ emptyText: t('dashboard.noActivity') }}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          <Tag color="blue">{item.action}</Tag>
                          {item.resourceType && <Tag>{item.resourceType}</Tag>}
                        </Space>
                      }
                      description={`${item.userId ?? '—'} · ${relTime(item.createdAt)}`}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title={t('dashboard.quickActions')}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button type="primary" block onClick={() => navigate('/users/create')}>
                {t('dashboard.createUser')}
              </Button>
              <Button block onClick={() => navigate('/roles')}>
                {t('dashboard.manageRoles')}
              </Button>
              <Button block onClick={() => navigate('/audit')}>
                {t('dashboard.viewAudit')}
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
