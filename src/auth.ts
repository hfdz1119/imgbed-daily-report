const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function safeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

function requestToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return request.headers.get("X-Report-Token")?.trim() ?? "";
}

export async function authorizeManualTrigger(
  request: Request,
  configuredToken: string | undefined,
): Promise<"authorized" | "missing-config" | "unauthorized"> {
  const expected = configuredToken?.trim();
  if (!expected) return "missing-config";
  const provided = requestToken(request);
  if (!provided) return "unauthorized";
  return (await safeEqual(provided, expected)) ? "authorized" : "unauthorized";
}
