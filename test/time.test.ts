import assert from "node:assert/strict";
import test from "node:test";
import { assertValidTimezone, formatReportTimestamp, getLocalDayStart } from "../src/time.ts";

test("resolves Asia/Shanghai natural-day midnight", () => {
  const now = new Date("2026-08-21T12:34:56.000Z");
  assert.equal(getLocalDayStart(now, "Asia/Shanghai").toISOString(), "2026-08-20T16:00:00.000Z");
  assert.equal(formatReportTimestamp(now, "Asia/Shanghai"), "2026-08-21 20:34");
});
test("resolves midnight on a daylight-saving transition day", () => {
  const now = new Date("2026-03-08T16:00:00.000Z");
  assert.equal(getLocalDayStart(now, "America/New_York").toISOString(), "2026-03-08T05:00:00.000Z");
});

test("rejects an invalid IANA timezone", () => {
  assert.throws(() => assertValidTimezone("Mars/Olympus_Mons"), /Invalid REPORT_TIMEZONE/);
});
