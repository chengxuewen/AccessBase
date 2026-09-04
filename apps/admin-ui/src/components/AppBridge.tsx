import { useEffect } from 'react';
import { App as AntdApp } from 'antd';
import { setFeedback } from '../api/feedback';

/**
 * Render inside <AntdApp> to publish the context-bound message/notification
 * instances into api/feedback.ts. See PIT-023.
 */
export default function AppBridge() {
  const { message, notification } = AntdApp.useApp();

  useEffect(() => {
    setFeedback({ message, notification });
  }, [message, notification]);

  return null;
}
