import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelStats, collectDailyStats, normalizeChannel } from "../src/stats.ts";

test("normalizes only upstream legacy channel variants", () => {
  assert.equal(normalizeChannel("TelegramNew"), "Telegram");
  assert.equal(normalizeChannel("Telegram"), "Telegram");
  assert.equal(normalizeChannel(null), "Telegraph");
  assert.equal(normalizeChannel("NewStorage"), "NewStorage");
});
test("dynamically groups channel types and channel instances", () => {
  const result = buildChannelStats([
    {
      channel: "TelegramNew",
      channel_name: "TG-A",
      file_count: 2,
      known_size_count: 2,
      total_bytes: 3 * 1024 * 1024,
    },
    {
      channel: "Telegram",
      channel_name: "TG-B",
      file_count: 1,
      known_size_count: 0,
      total_bytes: null,
    },
    {
      channel: "CloudflareR2",
      channel_name: "R2_env",
      file_count: 1,
      known_size_count: 1,
      total_bytes: 2 * 1024 * 1024,
    },
    {
      channel: "NewStorage",
      channel_name: "Future-A",
      file_count: 4,
      known_size_count: 4,
      total_bytes: 8 * 1024 * 1024,
    },
  ]);

  assert.equal(result.today.fileCount, 8);
  assert.equal(result.today.totalBytes, null, "partial size coverage must not be reported as a total");

  const telegram = result.channels.find((channel) => channel.key === "Telegram");
  assert.equal(telegram?.fileCount, 3);
  assert.equal(telegram?.totalBytes, null);
  assert.deepEqual(telegram?.instances.map((instance) => instance.name), ["TG-A", "TG-B"]);

  const future = result.channels.find((channel) => channel.key === "NewStorage");
  assert.equal(future?.displayName, "NewStorage");
  assert.equal(future?.totalBytes, 8 * 1024 * 1024);
});

test("uses SELECT-only aggregation and keeps the report when gallery stats fail", async () => {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      if (statements.length === 1) {
        return {
          bind(start: number, end: number) {
            assert.ok(start < end);
            return {
              async all() {
                return {
                  results: [
                    {
                      channel: "S3",
                      channel_name: "MinIO",
                      file_count: 2,
                      known_size_count: 2,
                      total_bytes: 2048,
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
          throw new Error("simulated optional gallery failure");
        },
      };
    },
  } as unknown as D1Database;

  const stats = await collectDailyStats(
    db,
    new Date("2026-08-20T16:00:00.000Z"),
    new Date("2026-08-21T12:00:00.000Z"),
  );

  assert.equal(stats.today.fileCount, 2);
  assert.equal(stats.gallery, null);
  assert.equal(statements.length, 2);
  for (const sql of statements) {
    assert.match(sql.trim(), /^WITH\s/i);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i);
    assert.match(sql, /timestamp IS NOT NULL/i);
  }
});
