import type { TelegramConfig } from "./types.ts";

interface TelegramResponse {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

class TelegramApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface TelegramSendOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RATE_LIMIT_RETRY_DELAY_MS = 30_000;

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
    if (!response.ok || result.ok !== true) {
      throw new TelegramApiError(
        result.description || `Telegram sendMessage returned HTTP ${response.status}`,
        response.status,
        result.parameters?.retry_after,
      );
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

  try {
    await sendOnce(config, text, fetcher, timeoutMs);
  } catch (error) {
    const retryAfterSeconds = error instanceof TelegramApiError && error.status === 429
      ? error.retryAfterSeconds
      : undefined;
    const retryDelayMs = options.retryDelayMs ?? (retryAfterSeconds === undefined
      ? Number.POSITIVE_INFINITY
      : retryAfterSeconds * 1000);

    if (
      Number.isSafeInteger(retryAfterSeconds)
      && retryAfterSeconds! > 0
      && retryDelayMs >= 0
      && retryDelayMs <= MAX_RATE_LIMIT_RETRY_DELAY_MS
    ) {
      console.warn(`Telegram rate-limited the report; retrying once after ${retryDelayMs} ms.`);
      await delay(retryDelayMs);
      try {
        await sendOnce(config, text, fetcher, timeoutMs);
        return;
      } catch (retryError) {
        const safeError = sanitizeTelegramError(retryError, config);
        console.warn("Telegram rate-limit retry failed:", safeError);
        throw safeError;
      }
    }

    const safeError = sanitizeTelegramError(error, config);
    console.warn("Telegram send failed without retry:", safeError);
    throw safeError;
  }
}
