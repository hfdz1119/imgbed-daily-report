export interface Env {
  DB: D1Database;
  REPORT_TELEGRAM_BOT_TOKEN?: string;
  REPORT_TELEGRAM_CHAT_ID?: string;
  REPORT_TRIGGER_TOKEN?: string;
  REPORT_SITE_NAME?: string;
  REPORT_TIMEZONE?: string;
  REPORT_SHOW_CHANNEL_DETAILS?: string;
}
export interface ReportConfig {
  siteName: string;
  timezone: string;
  showChannelDetails: boolean;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface SizeSummary {
  fileCount: number;
  knownSizeCount: number;
  totalBytes: number | null;
}

export interface ChannelInstanceSummary extends SizeSummary {
  name: string;
}

export interface ChannelSummary extends SizeSummary {
  key: string;
  displayName: string;
  instances: ChannelInstanceSummary[];
}

export interface DailyStats {
  today: SizeSummary;
  channels: ChannelSummary[];
  gallery: SizeSummary | null;
}
