import assert from "node:assert/strict";
import test from "node:test";
import { authorizeManualTrigger } from "../src/auth.ts";

test("requires a configured manual trigger token", async () => {
  const request = new Request("https://example.com/report", { method: "POST" });
  assert.equal(await authorizeManualTrigger(request, undefined), "missing-config");
});
test("accepts bearer token and rejects an incorrect token", async () => {
  const accepted = new Request("https://example.com/report", {
    method: "POST",
    headers: { Authorization: "Bearer correct-token" },
  });
  const rejected = new Request("https://example.com/report", {
    method: "POST",
    headers: { "X-Report-Token": "wrong-token" },
  });

  assert.equal(await authorizeManualTrigger(accepted, "correct-token"), "authorized");
  assert.equal(await authorizeManualTrigger(rejected, "correct-token"), "unauthorized");
});
