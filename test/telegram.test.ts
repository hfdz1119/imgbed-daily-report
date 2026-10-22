import assert from "node:assert/strict";
import test from "node:test";
import { sendTelegramMessage } from "../src/telegram.ts";

test("retries once after an explicit Telegram 429 rate limit", async () => {
  let attempts = 0;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    attempts += 1;
    assert.match(String(input), /bot\[REDACTED_SECRET\]\/sendMessage$/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.chat_id, "[REDACTED_CHAT_ID]");
    assert.equal(body.text, "report");

    if (attempts === 1) {
      return Response.json(
        { ok: false, description: "Too Many Requests", parameters: { retry_after: 1 } },
        { status: 429 },
      );
    }
    return Response.json({ ok: true, result: { message_id: 1 } });
  };

  await sendTelegramMessage(
    { botToken: "[REDACTED_SECRET]", chatId: "[REDACTED_CHAT_ID]" },
    "report",
    { fetcher: fetcher as typeof fetch, retryDelayMs: 0 },
  );
  assert.equal(attempts, 2);
});

test("does not retry an ambiguous server error", async () => {
  let attempts = 0;
  const fetcher = async (): Promise<Response> => {
    attempts += 1;
    return Response.json({ ok: false, description: "temporary failure" }, { status: 500 });
  };

  await assert.rejects(
    sendTelegramMessage(
      { botToken: "[REDACTED_SECRET]", chatId: "[REDACTED_CHAT_ID]" },
      "report",
      { fetcher: fetcher as typeof fetch },
    ),
    /temporary failure/,
  );
  assert.equal(attempts, 1);
});

test("does not retry an explicit non-rate-limit Telegram rejection", async () => {
  let attempts = 0;
  const fetcher = async (): Promise<Response> => {
    attempts += 1;
    return Response.json({ ok: false, description: "bad chat" });
  };

  await assert.rejects(
    sendTelegramMessage(
      { botToken: "[REDACTED_SECRET]", chatId: "[REDACTED_CHAT_ID]" },
      "report",
      { fetcher: fetcher as typeof fetch },
    ),
    /bad chat/,
  );
  assert.equal(attempts, 1);
});

test("redacts Telegram configuration from transport errors", async () => {
  const botToken = "sensitive-bot-token";
  const chatId = "sensitive-chat-id";
  const fetcher = async (): Promise<Response> => {
    throw new Error(`request failed for ${botToken} and ${chatId}`);
  };

  await assert.rejects(
    sendTelegramMessage(
      { botToken, chatId },
      "report",
      { fetcher: fetcher as typeof fetch },
    ),
    (error: Error) => {
      assert.doesNotMatch(error.message, /sensitive-bot-token|sensitive-chat-id/);
      assert.match(error.message, /\[REDACTED_SECRET\]/);
      return true;
    },
  );
});
