import { authorizeManualTrigger } from "./auth.ts";
import { getReportConfig, getTelegramConfig, hasTelegramConfig } from "./config.ts";
import { buildDailyReport } from "./report.ts";
import { collectDailyStats } from "./stats.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { getLocalDayStart } from "./time.ts";
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

type ReportSource = "scheduled" | "manual";
type DeliveryEvent = "last-attempt" | "last-success" | "last-failure";
const DELIVERY_STATUS_TTL_SECONDS = 90 * 24 * 60 * 60;
const DELIVERY_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

function deliveryStatusKey(source: ReportSource, event: DeliveryEvent): string {
  return `daily-report:${source}:${event}`;
}

async function writeDeliveryStatus(
  env: Env,
  source: ReportSource,
  event: DeliveryEvent,
  at: Date,
): Promise<void> {
  if (!env.REPORT_STATUS) return;
  try {
    await env.REPORT_STATUS.put(deliveryStatusKey(source, event), at.toISOString(), {
      expirationTtl: DELIVERY_STATUS_TTL_SECONDS,
    });
  } catch {
    // Monitoring must never prevent a report from being sent.
    console.error("Could not save daily report delivery status to KV.");
  }
}

async function generateAndSendReport(env: Env, generatedAt = new Date()): Promise<void> {
  const reportConfig = getReportConfig(env);
  const telegramConfig = getTelegramConfig(env);
  const dayStart = getLocalDayStart(generatedAt, reportConfig.timezone);
  const stats = await collectDailyStats(env.DB, dayStart, generatedAt);
  const report = buildDailyReport(reportConfig, stats, generatedAt);
  await sendTelegramMessage(telegramConfig, report);
}

async function runReport(env: Env, source: ReportSource): Promise<void> {
  const attemptedAt = new Date();
  await writeDeliveryStatus(env, source, "last-attempt", attemptedAt);
  try {
    await generateAndSendReport(env, attemptedAt);
    await writeDeliveryStatus(env, source, "last-success", new Date());
    console.log(`Daily report delivered successfully (${source}).`);
  } catch (error) {
    await writeDeliveryStatus(env, source, "last-failure", new Date());
    throw error;
  }
}

function parseStatusTimestamp(value: string | null): number | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function getDeliveryHealth(env: Env): Promise<{
  ok: boolean;
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastManualAttemptAt: string | null;
  lastManualSuccessAt: string | null;
  lastManualFailureAt: string | null;
  staleAfterSeconds: number;
}> {
  const staleAfterSeconds = DELIVERY_STALE_AFTER_MS / 1000;
  if (!env.REPORT_STATUS) {
    return {
      ok: false,
      status: "not_configured",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastManualAttemptAt: null,
      lastManualSuccessAt: null,
      lastManualFailureAt: null,
      staleAfterSeconds,
    };
  }

  try {
    const [scheduledAttemptAt, scheduledSuccessAt, scheduledFailureAt,
      manualAttemptAt, manualSuccessAt, manualFailureAt] = await Promise.all([
      env.REPORT_STATUS.get(deliveryStatusKey("scheduled", "last-attempt")),
      env.REPORT_STATUS.get(deliveryStatusKey("scheduled", "last-success")),
      env.REPORT_STATUS.get(deliveryStatusKey("scheduled", "last-failure")),
      env.REPORT_STATUS.get(deliveryStatusKey("manual", "last-attempt")),
      env.REPORT_STATUS.get(deliveryStatusKey("manual", "last-success")),
      env.REPORT_STATUS.get(deliveryStatusKey("manual", "last-failure")),
    ]);
    const scheduledAttemptMs = parseStatusTimestamp(scheduledAttemptAt);
    const scheduledSuccessMs = parseStatusTimestamp(scheduledSuccessAt);
    const scheduledFailureMs = parseStatusTimestamp(scheduledFailureAt);
    const manualAttemptMs = parseStatusTimestamp(manualAttemptAt);
    const manualSuccessMs = parseStatusTimestamp(manualSuccessAt);
    const manualFailureMs = parseStatusTimestamp(manualFailureAt);
    const now = Date.now();
    const timestamps = [
      [scheduledAttemptAt, scheduledAttemptMs],
      [scheduledSuccessAt, scheduledSuccessMs],
      [scheduledFailureAt, scheduledFailureMs],
      [manualAttemptAt, manualAttemptMs],
      [manualSuccessAt, manualSuccessMs],
      [manualFailureAt, manualFailureMs],
    ] as const;
    if (timestamps.some(([value, parsed]) => value !== null && parsed === null)) {
      return {
        ok: false,
        status: "unavailable",
        lastAttemptAt: scheduledAttemptAt,
        lastSuccessAt: scheduledSuccessAt,
        lastFailureAt: scheduledFailureAt,
        lastManualAttemptAt: manualAttemptAt,
        lastManualSuccessAt: manualSuccessAt,
        lastManualFailureAt: manualFailureAt,
        staleAfterSeconds,
      };
    }

    const successIsFresh = scheduledSuccessMs !== null
      && scheduledSuccessMs <= now
      && now - scheduledSuccessMs <= DELIVERY_STALE_AFTER_MS;
    const failureIsNewer = scheduledFailureMs !== null
      && (scheduledSuccessMs === null || scheduledFailureMs > scheduledSuccessMs);
    const status = !scheduledSuccessMs
      ? "no_scheduled_success_yet"
      : !successIsFresh
      ? "stale"
      : failureIsNewer
      ? "last_scheduled_attempt_failed"
      : "healthy";
    return {
      ok: status === "healthy" && Boolean(env.DB) && hasTelegramConfig(env),
      status: status === "healthy" && (!env.DB || !hasTelegramConfig(env))
        ? "configuration_incomplete"
        : status,
      lastAttemptAt: scheduledAttemptAt,
      lastSuccessAt: scheduledSuccessAt,
      lastFailureAt: scheduledFailureAt,
      lastManualAttemptAt: manualAttemptAt,
      lastManualSuccessAt: manualSuccessAt,
      lastManualFailureAt: manualFailureAt,
      staleAfterSeconds,
    };
  } catch {
    return {
      ok: false,
      status: "unavailable",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastManualAttemptAt: null,
      lastManualSuccessAt: null,
      lastManualFailureAt: null,
      staleAfterSeconds,
    };
  }
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    if (request.method !== "GET") return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
    try {
      const config = getReportConfig(env);
      const delivery = await getDeliveryHealth(env);
      const body = {
        ok: delivery.ok,
        service: "imgbed-daily-report",
        siteName: config.siteName,
        timezone: config.timezone,
        channelDetails: config.showChannelDetails,
        databaseConfigured: Boolean(env.DB),
        telegramConfigured: hasTelegramConfig(env),
        manualTriggerConfigured: Boolean(env.REPORT_TRIGGER_TOKEN?.trim()),
        delivery,
      };
      return jsonResponse(body, delivery.ok ? 200 : 503);
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
      await runReport(env, "manual");
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
      await runReport(env, "scheduled");
    } catch (error) {
      console.error("Scheduled ImgBed daily report failed:", error);
    }
  },
} satisfies ExportedHandler<Env>;
