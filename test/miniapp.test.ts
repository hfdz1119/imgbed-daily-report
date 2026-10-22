import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import type { Env } from "../src/types.ts";

const encoder = new TextEncoder();
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function sign(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(encoder.encode(message))));
}
function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function signedInitData(botToken: string, userId: number): Promise<string> {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("user", JSON.stringify({ id: userId }));
  params.set("query_id", "test-query");
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = await sign(encoder.encode("WebAppData"), botToken);
  params.set("hash", hex(await sign(secret, checkString)));
  return params.toString();
}
function testDb(): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              return {
                results: [
                  { channel: "TelegramNew", channel_name: "private name", file_count: 3, known_size_count: 3, total_bytes: 3072 },
                  { channel: "S3", channel_name: "private bucket", file_count: 1, known_size_count: 1, total_bytes: 1024 },
                ],
              };
            },
          };
        },
        async first() {
          return { file_count: 12, known_size_count: 11, total_bytes: 12288 };
        },
      };
    },
  } as unknown as D1Database;
}
function testEnv(allowedIds = "24680"): Env {
  return {
    DB: testDb(),
    REPORT_TELEGRAM_BOT_TOKEN: "123:bot-token",
    REPORT_TELEGRAM_ALLOWED_USER_IDS: allowedIds,
    REPORT_TELEGRAM_CHAT_ID: "24680",
    REPORT_SITE_NAME: "ImgBed test",
    REPORT_TIMEZONE: "Asia/Shanghai",
  };
}

test("GET /miniapp serves a no-store page that passes signed initData to its API", async () => {
  const response = await worker.fetch!(new Request("https://example.com/miniapp"), { DB: testDb() } as Env);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors/);
  assert.match(html, /window\.Telegram && window\.Telegram\.WebApp/);
  assert.match(html, /Authorization: "tma " \+ initData/);
  assert.doesNotMatch(html, /REPORT_TELEGRAM_BOT_TOKEN|REPORT_TELEGRAM_ALLOWED_USER_IDS/);
});

test("the stats API returns only aggregates to a signed allowlisted Telegram user", async () => {
  const env = testEnv();
  const initData = await signedInitData(env.REPORT_TELEGRAM_BOT_TOKEN!, 24680);
  const response = await worker.fetch!(new Request("https://example.com/api/miniapp/stats", {
    headers: { Authorization: "tma " + initData },
  }), env);
  const data = await response.json() as {
    ok: boolean;
    today: { fileCount: number };
    gallery: { fileCount: number; totalBytes: number | null };
    channels: Array<Record<string, unknown>>;
  };
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.today.fileCount, 4);
  assert.equal(data.gallery.fileCount, 12);
  assert.equal(data.gallery.totalBytes, null);
  assert.deepEqual(data.channels.map((channel) => channel.displayName), ["Telegram", "S3"]);
  assert.ok(data.channels.every((channel) => !("instances" in channel)));
  assert.doesNotMatch(JSON.stringify(data), /private name|private bucket/);
});

test("a private report recipient is the default allowed mini app user", async () => {
  const env = testEnv();
  delete env.REPORT_TELEGRAM_ALLOWED_USER_IDS;
  const initData = await signedInitData(env.REPORT_TELEGRAM_BOT_TOKEN!, 24680);
  const response = await worker.fetch!(new Request("https://example.com/api/miniapp/stats", {
    headers: { Authorization: "tma " + initData },
  }), env);
  assert.equal(response.status, 200);
});

test("a group report destination does not grant mini app access to everyone", async () => {
  const env = testEnv();
  delete env.REPORT_TELEGRAM_ALLOWED_USER_IDS;
  env.REPORT_TELEGRAM_CHAT_ID = "-1001234567890";
  const initData = await signedInitData(env.REPORT_TELEGRAM_BOT_TOKEN!, 24680);
  const response = await worker.fetch!(new Request("https://example.com/api/miniapp/stats", {
    headers: { Authorization: "tma " + initData },
  }), env);
  assert.equal(response.status, 503);
});

test("the stats API rejects invalid identities, non-allowlisted users and missing setup", async () => {
  const env = testEnv();
  const invalid = await worker.fetch!(new Request("https://example.com/api/miniapp/stats", {
    headers: { Authorization: "tma user=forged" },
  }), env);
  assert.equal(invalid.status, 401);

  const nonAllowedInitData = await signedInitData(env.REPORT_TELEGRAM_BOT_TOKEN!, 13579);
  const forbidden = await worker.fetch!(new Request("https://example.com/api/miniapp/stats", {
    headers: { Authorization: "tma " + nonAllowedInitData },
  }), env);
  assert.equal(forbidden.status, 403);

  const unconfiguredEnv = testEnv("");
  delete unconfiguredEnv.REPORT_TELEGRAM_CHAT_ID;
  const unconfigured = await worker.fetch!(new Request("https://example.com/api/miniapp/stats", {
    headers: { Authorization: "tma user=anything" },
  }), unconfiguredEnv);
  assert.equal(unconfigured.status, 503);
});
