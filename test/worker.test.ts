import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import type { Env } from "../src/types.ts";

function makeStatusKv(values = new Map<string, string>()): KVNamespace {
  return {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
  } as unknown as KVNamespace;
}

test("authorized POST /report runs the read-only flow and delivers Telegram text", async () => {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      if (statements.length === 1) {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [
                    {
                      channel: "TelegramNew",
                      channel_name: "TG-A",
                      file_count: 1,
                      known_size_count: 1,
                      total_bytes: 1048576,
                    },
                  ],
                };
              },
            };
          },
        };
      }
      return {
        async first() {
          return { file_count: 10, known_size_count: 10, total_bytes: 10 * 1048576 };
        },
      };
    },
  } as unknown as D1Database;

  const statusValues = new Map<string, string>();
  const env: Env = {
    DB: db,
    REPORT_STATUS: makeStatusKv(statusValues),
    REPORT_TELEGRAM_BOT_TOKEN: "[REDACTED_SECRET]",
    REPORT_TELEGRAM_CHAT_ID: "[REDACTED_CHAT_ID]",
    REPORT_TRIGGER_TOKEN: "manual-secret",
    REPORT_SITE_NAME: "ImgBed",
    REPORT_TIMEZONE: "Asia/Shanghai",
  };

  const originalFetch = globalThis.fetch;
  let telegramText = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    telegramText = JSON.parse(String(init?.body)).text;
    return Response.json({ ok: true, result: { message_id: 1 } });
  }) as typeof fetch;

  try {
    const response = await worker.fetch!(
      new Request("https://example.com/report", {
        method: "POST",
        headers: { Authorization: "Bearer manual-secret" },
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, delivered: true });
    assert.match(telegramText, /📊 ImgBed 每日汇报/);
    assert.match(telegramText, /Telegram：1 个 \/ 1 MB/);
    assert.equal(statements.length, 2);
    assert.ok(statements.every((sql) => /^\s*WITH\s/i.test(sql)));
    assert.ok(statusValues.has("daily-report:manual:last-attempt"));
    assert.ok(statusValues.has("daily-report:manual:last-success"));
    assert.equal(statusValues.has("daily-report:manual:last-failure"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("GET /health reports a fresh successful delivery", async () => {
  const now = Date.now();
  const statusValues = new Map<string, string>([
    ["daily-report:scheduled:last-attempt", new Date(now - 60 * 60 * 1000).toISOString()],
    ["daily-report:scheduled:last-success", new Date(now - 60 * 60 * 1000).toISOString()],
  ]);
  const env: Env = {
    DB: {} as D1Database,
    REPORT_STATUS: makeStatusKv(statusValues),
    REPORT_TELEGRAM_BOT_TOKEN: "token",
    REPORT_TELEGRAM_CHAT_ID: "chat",
  };

  const response = await worker.fetch!(new Request("https://example.com/health"), env);
  const body = await response.json() as {
    ok: boolean;
    delivery: { status: string; lastSuccessAt: string | null };
  };
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.delivery.status, "healthy");
  assert.equal(body.delivery.lastSuccessAt, statusValues.get("daily-report:scheduled:last-success"));
});

test("GET /health returns 503 when no successful report is recorded", async () => {
  const env: Env = {
    DB: {} as D1Database,
    REPORT_STATUS: makeStatusKv(),
    REPORT_TELEGRAM_BOT_TOKEN: "token",
    REPORT_TELEGRAM_CHAT_ID: "chat",
  };

  const response = await worker.fetch!(new Request("https://example.com/health"), env);
  const body = await response.json() as { ok: boolean; delivery: { status: string } };
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.delivery.status, "no_scheduled_success_yet");
});

test("GET /health returns 503 when the last successful report is stale", async () => {
  const statusValues = new Map<string, string>([
    ["daily-report:scheduled:last-success", new Date(Date.now() - 37 * 60 * 60 * 1000).toISOString()],
  ]);
  const env: Env = {
    DB: {} as D1Database,
    REPORT_STATUS: makeStatusKv(statusValues),
    REPORT_TELEGRAM_BOT_TOKEN: "token",
    REPORT_TELEGRAM_CHAT_ID: "chat",
  };

  const response = await worker.fetch!(new Request("https://example.com/health"), env);
  const body = await response.json() as { ok: boolean; delivery: { status: string } };
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.delivery.status, "stale");
});


test("GET /health does not count a manual report as a scheduled delivery", async () => {
  const statusValues = new Map<string, string>([
    ["daily-report:manual:last-success", new Date().toISOString()],
  ]);
  const env: Env = {
    DB: {} as D1Database,
    REPORT_STATUS: makeStatusKv(statusValues),
    REPORT_TELEGRAM_BOT_TOKEN: "token",
    REPORT_TELEGRAM_CHAT_ID: "chat",
  };

  const response = await worker.fetch!(new Request("https://example.com/health"), env);
  const body = await response.json() as { delivery: { status: string } };
  assert.equal(response.status, 503);
  assert.equal(body.delivery.status, "no_scheduled_success_yet");
});
