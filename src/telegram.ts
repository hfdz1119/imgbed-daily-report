import type { TelegramConfig } from "./types.ts";

interface TelegramResponse {
  ok?: boolean;
  description?: string;
}

interface TelegramSendOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 750;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sanitizeTelegramError(error: unknown, config: TelegramConfig): Error {
  let message = error instanceof Error ? error.message : String(error);
  for (const sensitiveValue of [config.botToken, config.chatId]) {
    if (sensitiveValue) message = message.replaceAll(sensitiveValue, "[REDACTED_SECRET]");
  }
  return new Error(message);
}

async function sendOnce(
  config: TelegramConfig,
  text: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      },
    );

    const result = (await response.json().catch(() => ({}))) as TelegramResponse;
    if (!response.ok) {
      throw new Error(result.description || `Telegram sendMessage returned HTTP ${response.status}`);
    }
    if (result.ok !== true) {
      throw new Error(result.description || "Telegram sendMessage returned ok:false");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Telegram sendMessage timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  options: TelegramSendOptions = {},
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await sendOnce(config, text, fetcher, timeoutMs);
      return;
    } catch (error) {
      lastError = sanitizeTelegramError(error, config);
      console.warn(`Telegram send attempt ${attempt} failed:`, lastError);
      if (attempt === 1 && retryDelayMs > 0) await delay(retryDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Telegram sendMessage failed");
}
