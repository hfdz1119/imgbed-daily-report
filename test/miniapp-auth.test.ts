import assert from "node:assert/strict";
import test from "node:test";
import { parseAllowedTelegramUserIds, verifyTelegramInitData } from "../src/miniapp-auth.ts";

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

async function createSignedInitData(botToken: string, userId: number, authDate: number): Promise<string> {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("user", JSON.stringify({ id: userId, first_name: "Test" }));
  params.set("query_id", "sample-query");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = await sign(encoder.encode("WebAppData"), botToken);
  params.set("hash", hex(await sign(secretKey, dataCheckString)));
  return params.toString();
}

test("validates authentic Telegram initData and returns the signed user id", async () => {
  const now = 1_800_000_000_000;
  const initData = await createSignedInitData("123:bot-token", 24680, Math.floor(now / 1000));
  assert.equal(await verifyTelegramInitData(initData, "123:bot-token", now), 24680);
});

test("rejects changed, duplicate, expired and future Telegram initData", async () => {
  const now = 1_800_000_000_000;
  const recent = Math.floor(now / 1000);
  const valid = await createSignedInitData("123:bot-token", 24680, recent);
  const tampered = new URLSearchParams(valid);
  tampered.set("user", JSON.stringify({ id: 13579, first_name: "Test" }));
  const duplicate = valid + "&auth_date=" + recent;
  const expired = await createSignedInitData("123:bot-token", 24680, recent - 86_401);
  const future = await createSignedInitData("123:bot-token", 24680, recent + 61);

  assert.equal(await verifyTelegramInitData(tampered.toString(), "123:bot-token", now), null);
  assert.equal(await verifyTelegramInitData(duplicate, "123:bot-token", now), null);
  assert.equal(await verifyTelegramInitData(expired, "123:bot-token", now), null);
  assert.equal(await verifyTelegramInitData(future, "123:bot-token", now), null);
});

test("rejects malformed initData and missing bot token", async () => {
  assert.equal(await verifyTelegramInitData("", "123:bot-token"), null);
  assert.equal(await verifyTelegramInitData("user=not-json&auth_date=1&hash=bad", "123:bot-token"), null);
  assert.equal(await verifyTelegramInitData("auth_date=1&user=%7B%7D&hash=bad", ""), null);
});

test("parses only positive safe integer ids from the allowlist", () => {
  assert.deepEqual(
    [...parseAllowedTelegramUserIds("24680, 13579, -1, abc, 9007199254740992, 24680")],
    [24680, 13579],
  );
  assert.equal(parseAllowedTelegramUserIds(undefined).size, 0);
});
