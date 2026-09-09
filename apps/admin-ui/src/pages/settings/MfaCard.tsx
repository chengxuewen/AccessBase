import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Checkbox, Input, Modal, Spin, Typography } from 'antd';
import { setupMfa, enableMfa, disableMfa, type MfaSetupData } from '../../api/mfa';
import { apiErrorMessage } from '../../api/errors';
import { message } from '../../api/feedback';
import { useAuthStore } from '../../stores/auth';

/**
 * Self-service TOTP panel (Settings → Security).
 * Recovery codes live ONLY in this component's state — never zustand/persist
 * (conventions: sensitive fields must not hit localStorage).
 */
export default function MfaCard() {
  const { t } = useTranslation();
  const mfaEnabled = useAuthStore((s) => s.user?.mfaEnabled === true);
  const fetchUser = useAuthStore((s) => s.fetchUser);

  // --- setup flow (disabled state) ---
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [enabling, setEnabling] = useState(false);

  // --- one-time recovery codes modal ---
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState(false);

  // --- disable flow (enabled state) ---
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const openSetup = async () => {
    setModalError(null);
    setSetupOpen(true);
    setSetupLoading(true);
    try {
      setSetupData(await setupMfa());
    } catch (err: unknown) {
      setModalError(apiErrorMessage(err, t('settings.mfa.setupError')));
    } finally {
      setSetupLoading(false);
    }
  };

  const closeSetup = () => {
    setSetupOpen(false);
    setCode('');
    setSetupData(null);
    setModalError(null);
  };

  const handleEnable = async () => {
    setEnabling(true);
    setModalError(null);
    try {
      await enableMfa(code);
      closeSetup();
      // codes were returned by /mfa/setup and are shown exactly once
      setRecoveryCodes(setupData?.recoveryCodes ?? []);
      setCodesSaved(false);
      setRecoveryOpen(true);
    } catch (err: unknown) {
      setModalError(apiErrorMessage(err, t('settings.mfa.enableError')));
    } finally {
      setEnabling(false);
    }
  };

  const handleRecoveryDone = () => {
    setRecoveryOpen(false);
    setRecoveryCodes([]);
    message.success(t('settings.mfa.enableSuccess'));
    void fetchUser();
  };

  const openDisable = () => {
    setDisableError(null);
    setPassword('');
    setDisableOpen(true);
  };

  const handleDisable = async () => {
    setDisabling(true);
    setDisableError(null);
    try {
      await disableMfa(password);
      setDisableOpen(false);
      message.success(t('settings.mfa.disableSuccess'));
      void fetchUser();
    } catch (err: unknown) {
      setDisableError(apiErrorMessage(err, t('settings.mfa.disableError')));
    } finally {
      setDisabling(false);
    }
  };

  return (
    <Card title={t('settings.mfa.title')} data-testid="mfa-card">
      {mfaEnabled ? (
        <>
          <Alert
            type="success"
            showIcon
            message={t('settings.mfa.alreadyEnabled')}
            style={{ marginBottom: 16 }}
            data-testid="mfa-enabled-alert"
          />
          <Button danger onClick={openDisable} data-testid="mfa-disable-btn">
            {t('settings.mfa.disable')}
          </Button>
        </>
      ) : (
        <>
          <Typography.Paragraph>{t('settings.mfa.description')}</Typography.Paragraph>
          <Button type="primary" onClick={() => void openSetup()} data-testid="mfa-setup-btn">
            {t('settings.mfa.setup')}
          </Button>
        </>
      )}

      <Modal
        open={setupOpen}
        title={t('settings.mfa.setupTitle')}
        onCancel={closeSetup}
        footer={null}
        destroyOnHidden
      >
        {modalError && (
          <Alert type="error" showIcon message={modalError} style={{ marginBottom: 16 }} data-testid="mfa-enable-error" />
        )}
        <Spin spinning={setupLoading}>
          {setupData && (
            <>
              <Typography.Paragraph>{t('settings.mfa.scanHint')}</Typography.Paragraph>
              <div style={{ textAlign: 'center', margin: '16px 0' }}>
                <img src={setupData.qrDataUrl} alt="TOTP QR" data-testid="mfa-qr" style={{ width: 200, height: 200 }} />
              </div>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                {t('settings.mfa.secretHint')}
              </Typography.Paragraph>
              <Typography.Paragraph code copyable={{ text: setupData.otpauthUrl }}>
                {setupData.otpauthUrl}
              </Typography.Paragraph>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('settings.mfa.codePlaceholder')}
                inputMode="numeric"
                maxLength={8}
                data-testid="mfa-code-input"
                style={{ marginBottom: 16 }}
              />
              <Button
                type="primary"
                loading={enabling}
                disabled={!/^\d{6,8}$/.test(code)}
                onClick={() => void handleEnable()}
                data-testid="mfa-enable-btn"
              >
                {t('settings.mfa.verifyEnable')}
              </Button>
            </>
          )}
        </Spin>
      </Modal>

      <Modal
        open={recoveryOpen}
        title={t('settings.mfa.recoveryTitle')}
        closable={false}
        footer={null}
        destroyOnHidden
      >
        <div data-testid="mfa-recovery-modal">
          <Alert type="warning" showIcon message={t('settings.mfa.recoveryWarning')} style={{ marginBottom: 16 }} />
          {recoveryCodes.map((rc) => (
            <Typography.Paragraph key={rc} code copyable={{ text: rc }}>
              {rc}
            </Typography.Paragraph>
          ))}
          <Checkbox checked={codesSaved} onChange={(e) => setCodesSaved(e.target.checked)} data-testid="mfa-saved-confirm">
            {t('settings.mfa.savedConfirm')}
          </Checkbox>
          <Button
            type="primary"
            block
            disabled={!codesSaved}
            onClick={handleRecoveryDone}
            style={{ marginTop: 16 }}
            data-testid="mfa-recovery-done"
          >
            {t('settings.mfa.recoveryDone')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={disableOpen}
        title={t('settings.mfa.disableTitle')}
        onCancel={() => setDisableOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Typography.Paragraph>{t('settings.mfa.disableNeedPassword')}</Typography.Paragraph>
        {disableError && (
          <Alert type="error" showIcon message={disableError} style={{ marginBottom: 16 }} data-testid="mfa-disable-error" />
        )}
        <Input.Password
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('settings.mfa.passwordLabel')}
          data-testid="mfa-password-input"
          style={{ marginBottom: 16 }}
        />
        <Button danger type="primary" loading={disabling} disabled={password.length === 0} onClick={() => void handleDisable()} data-testid="mfa-disable-confirm">
          {t('settings.mfa.disableConfirm')}
        </Button>
      </Modal>
    </Card>
  );
}
