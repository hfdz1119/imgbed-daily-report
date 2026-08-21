import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import type { Env } from "../src/types.ts";

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

  const env: Env = {
    DB: db,
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
