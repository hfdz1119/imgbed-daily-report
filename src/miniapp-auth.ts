const encoder = new TextEncoder();
const MAX_INIT_DATA_BYTES = 8_192;
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
const MAX_FUTURE_SKEW_SECONDS = 60;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(encoder.encode(message)));
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** Verify Telegram's signed Web App initData and return the authenticated numeric user id. */
export async function verifyTelegramInitData(
  rawInitData: string,
  botToken: string,
  nowMs = Date.now(),
): Promise<number | null> {
  if (!rawInitData || !botToken || encoder.encode(rawInitData).byteLength > MAX_INIT_DATA_BYTES) {
    return null;
  }

  try {
    const params = new URLSearchParams(rawInitData);
    const entries = [...params.entries()];
    if (entries.length === 0 || new Set(entries.map(([key]) => key)).size !== entries.length) {
      return null;
    }

    const suppliedHash = params.get("hash");
    const authDateText = params.get("auth_date");
    const userText = params.get("user");
    if (!suppliedHash || !authDateText || !userText) return null;

    const authDateSeconds = /^\d+$/.test(authDateText) ? Number(authDateText) : Number.NaN;
    const nowSeconds = Math.floor(nowMs / 1000);
    if (!Number.isSafeInteger(authDateSeconds)
      || authDateSeconds > nowSeconds + MAX_FUTURE_SKEW_SECONDS
      || nowSeconds - authDateSeconds > MAX_AUTH_AGE_SECONDS) {
      return null;
    }

    const user = JSON.parse(userText) as { id?: unknown };
    if (!Number.isSafeInteger(user.id) || typeof user.id !== "number" || user.id <= 0) {
      return null;
    }

    const dataCheckString = entries
      .filter(([key]) => key !== "hash")
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secretKey = await hmacSha256(encoder.encode("WebAppData"), botToken);
    const expectedHash = toHex(await hmacSha256(secretKey, dataCheckString));
    if (!safeHexEqual(suppliedHash, expectedHash)) return null;

    return user.id;
  } catch {
    return null;
  }
}

export function parseAllowedTelegramUserIds(value: string | undefined): Set<number> {
  const ids = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return new Set(ids);
}
