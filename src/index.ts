import { authorizeManualTrigger } from "./auth.ts";
import { getReportConfig, getTelegramConfig, hasTelegramConfig } from "./config.ts";
import { buildDailyReport } from "./report.ts";
import { collectDailyStats } from "./stats.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { getLocalDayStart } from "./time.ts";
import { parseAllowedTelegramUserIds, verifyTelegramInitData } from "./miniapp-auth.ts";
import { TELEGRAM_MINI_APP_HTML } from "./miniapp.ts";
import type { Env } from "./types.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function generateAndSendReport(env: Env, generatedAt = new Date()): Promise<void> {
  const reportConfig = getReportConfig(env);
  const telegramConfig = getTelegramConfig(env);
  const dayStart = getLocalDayStart(generatedAt, reportConfig.timezone);
  const stats = await collectDailyStats(env.DB, dayStart, generatedAt);
  const report = buildDailyReport(reportConfig, stats, generatedAt);
  await sendTelegramMessage(telegramConfig, report);
}

function miniAppPageResponse(): Response {
  return new Response(TELEGRAM_MINI_APP_HTML, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org https://t.me",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handleMiniAppStats(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const botToken = env.REPORT_TELEGRAM_BOT_TOKEN?.trim();
  const explicitAllowlist = env.REPORT_TELEGRAM_ALLOWED_USER_IDS?.trim();
  const allowedUserIds = explicitAllowlist
    ? parseAllowedTelegramUserIds(explicitAllowlist)
    : parseAllowedTelegramUserIds(env.REPORT_TELEGRAM_CHAT_ID);
  if (!botToken || !env.DB || allowedUserIds.size === 0) {
    return jsonResponse({ ok: false, error: "Mini App is not configured" }, 503);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("tma ")) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }
  const userId = await verifyTelegramInitData(authorization.slice(4), botToken);
  if (userId === null) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }
  if (!allowedUserIds.has(userId)) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403);
  }

  try {
    const config = getReportConfig(env);
    const generatedAt = new Date();
    const today = await collectDailyStats(
      env.DB,
      getLocalDayStart(generatedAt, config.timezone),
      generatedAt,
    );
    return jsonResponse({
      ok: true,
      siteName: config.siteName,
      timezone: config.timezone,
      generatedAt: generatedAt.toISOString(),
      today: today.today,
      gallery: today.gallery,
      channels: today.channels.map(({ displayName, fileCount, knownSizeCount, totalBytes }) => ({
        displayName,
        fileCount,
        knownSizeCount,
        totalBytes,
      })),
    });
  } catch (error) {
    console.error("Telegram Mini App stats request failed:", error);
    return jsonResponse({ ok: false, error: "Stats are temporarily unavailable" }, 503);
  }
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/miniapp") {
    if (request.method !== "GET") {
      return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
    }
    return miniAppPageResponse();
  }

  if (url.pathname === "/api/miniapp/stats") {
    return handleMiniAppStats(request, env);
  }

  if (url.pathname === "/health") {
    if (request.method !== "GET") return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
    try {
      const config = getReportConfig(env);
      return jsonResponse({
        ok: true,
        service: "imgbed-daily-report",
        siteName: config.siteName,
        timezone: config.timezone,
        channelDetails: config.showChannelDetails,
        databaseConfigured: Boolean(env.DB),
        telegramConfigured: hasTelegramConfig(env),
        manualTriggerConfigured: Boolean(env.REPORT_TRIGGER_TOKEN?.trim()),
      });
    } catch (error) {
      console.error("Health configuration check failed:", error);
      return jsonResponse({ ok: false, error: "Invalid Worker configuration" }, 500);
    }
  }

  if (url.pathname === "/report") {
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);

    const authorization = await authorizeManualTrigger(request, env.REPORT_TRIGGER_TOKEN);
    if (authorization === "missing-config") {
      console.error("Manual report trigger is disabled because REPORT_TRIGGER_TOKEN is not configured.");
      return jsonResponse({ ok: false, error: "Manual trigger is not configured" }, 503);
    }
    if (authorization !== "authorized") {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    try {
      await generateAndSendReport(env);
      return jsonResponse({ ok: true, delivered: true });
    } catch (error) {
      console.error("Manual daily report failed:", error);
      return jsonResponse({ ok: false, error: "Daily report failed; check Worker logs" }, 500);
    }
  }

  return jsonResponse({ ok: false, error: "Not Found" }, 404);
}

export default {
  fetch: handleFetch,

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await generateAndSendReport(env);
      console.log("Scheduled ImgBed daily report delivered successfully.");
    } catch (error) {
      console.error("Scheduled ImgBed daily report failed:", error);
    }
  },
} satisfies ExportedHandler<Env>;
