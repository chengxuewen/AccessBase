import type { MessageInstance } from 'antd/es/message/interface';
import type { NotificationInstance } from 'antd/es/notification/interface';

/**
 * Feedback bridge (PIT-023): antd v5 static `message`/`notification` imports
 * never render under this app's React 19 renderer. <AppBridge> captures the
 * context-bound instances from App.useApp() here; pages import { message } /
 * { notification } from this module instead of 'antd' — call sites unchanged.
 */
interface FeedbackBridge {
  message: MessageInstance;
  notification: NotificationInstance;
}

let bridge: FeedbackBridge | null = null;

export function setFeedback(next: FeedbackBridge): void {
  bridge = next;
}

function ready(which: 'message' | 'notification'): FeedbackBridge {
  if (!bridge) {
    throw new Error(`feedback.${which} used before <AppBridge> mounted`);
  }
  return bridge;
}

export const message: MessageInstance = {
  info: (content, duration, onClose) => ready('message').message.info(content, duration, onClose),
  success: (content, duration, onClose) => ready('message').message.success(content, duration, onClose),
  error: (content, duration, onClose) => ready('message').message.error(content, duration, onClose),
  warning: (content, duration, onClose) => ready('message').message.warning(content, duration, onClose),
  loading: (content, duration, onClose) => ready('message').message.loading(content, duration, onClose),
  open: (args) => ready('message').message.open(args),
  destroy: (key) => ready('message').message.destroy(key),
};

export const notification: NotificationInstance = {
  open: (args) => ready('notification').notification.open(args),
  success: (args) => ready('notification').notification.success(args),
  error: (args) => ready('notification').notification.error(args),
  info: (args) => ready('notification').notification.info(args),
  warning: (args) => ready('notification').notification.warning(args),
  destroy: (key) => ready('notification').notification.destroy(key),
};
