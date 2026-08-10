import { env } from '../../config/env.js';

export interface ChannelMessage { recipient: string; subject: string; message: string; attachment?: { filename: string; content: Buffer } }
export interface NotificationChannel { readonly name: 'LINE' | 'EMAIL'; configured(): boolean; send(message: ChannelMessage): Promise<{ sent: boolean; reason?: string }> }

export class LineChannel implements NotificationChannel {
  readonly name = 'LINE' as const;
  configured() { return env.LINE_MESSAGING_ENABLED && Boolean(env.LINE_CHANNEL_ACCESS_TOKEN); }
  async send(_message: ChannelMessage) { if (!this.configured()) return { sent: false, reason: 'LINE_NOT_CONFIGURED' }; return { sent: false, reason: 'LINE_TRANSPORT_NOT_ENABLED' }; }
}

export class EmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;
  configured() { return Boolean(env.MAIL_HOST && env.MAIL_USER && env.MAIL_APP_PASSWORD && env.MAIL_FROM_EMAIL); }
  async send(_message: ChannelMessage) { if (!this.configured()) return { sent: false, reason: 'EMAIL_NOT_CONFIGURED' }; return { sent: false, reason: 'EMAIL_TRANSPORT_NOT_ENABLED' }; }
}

export const notificationChannels = { line: new LineChannel(), email: new EmailChannel() };
