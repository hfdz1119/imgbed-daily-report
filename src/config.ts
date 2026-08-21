import type { Env, ReportConfig, TelegramConfig } from "./types.ts";
import { assertValidTimezone } from "./time.ts";

const DEFAULT_SITE_NAME = "ImgBed";
const DEFAULT_TIMEZONE = "Asia/Shanghai";

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function getReportConfig(env: Env): ReportConfig {
  const siteName = (optionalText(env.REPORT_SITE_NAME) ?? DEFAULT_SITE_NAME)
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const timezone = optionalText(env.REPORT_TIMEZONE) ?? DEFAULT_TIMEZONE;
  assertValidTimezone(timezone);

  return {
    siteName,
    timezone,
    showChannelDetails: optionalText(env.REPORT_SHOW_CHANNEL_DETAILS)?.toLowerCase() === "true",
  };
}

export function getTelegramConfig(env: Env): TelegramConfig {
  const botToken = optionalText(env.REPORT_TELEGRAM_BOT_TOKEN);
  const chatId = optionalText(env.REPORT_TELEGRAM_CHAT_ID);

  if (!botToken || !chatId) {
    throw new Error(
      "Telegram is not configured. Set REPORT_TELEGRAM_BOT_TOKEN and REPORT_TELEGRAM_CHAT_ID as Worker secrets.",
    );
  }

  return { botToken, chatId };
}

export function hasTelegramConfig(env: Env): boolean {
  return Boolean(
    optionalText(env.REPORT_TELEGRAM_BOT_TOKEN) && optionalText(env.REPORT_TELEGRAM_CHAT_ID),
  );
}
