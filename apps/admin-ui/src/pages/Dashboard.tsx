import { useTranslation } from 'react-i18next';
import { Card, Col, Row, Statistic } from 'antd';
import { UserOutlined, TeamOutlined, SafetyOutlined, AuditOutlined } from '@ant-design/icons';

export default function Dashboard() {
  const { t } = useTranslation();

  const stats = [
    {
      title: t('dashboard.totalUsers'),
      value: 1280,
      icon: <UserOutlined style={{ fontSize: 24, color: '#1890ff' }} />,
    },
    {
      title: t('dashboard.activeRoles'),
      value: 12,
      icon: <TeamOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
    },
    {
      title: t('dashboard.permissions'),
      value: 56,
      icon: <SafetyOutlined style={{ fontSize: 24, color: '#faad14' }} />,
    },
    {
      title: t('dashboard.auditLogs'),
      value: 8432,
      icon: <AuditOutlined style={{ fontSize: 24, color: '#f5222d' }} />,
    },
  ];

  return (
    <div>
      <h2>{t('dashboard.title')}</h2>
      <Row gutter={[16, 16]}>
        {stats.map((stat) => (
          <Col xs={24} sm={12} lg={6} key={stat.title}>
            <Card>
              <Statistic title={stat.title} value={stat.value} prefix={stat.icon} />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
