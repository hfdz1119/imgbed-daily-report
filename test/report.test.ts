import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyReport, formatBytes } from "../src/report.ts";
import type { DailyStats, ReportConfig } from "../src/types.ts";

test("formats binary capacity units", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(486.3 * 1024 * 1024), "486.3 MB");
  assert.equal(formatBytes(18.42 * 1024 * 1024 * 1024), "18.42 GB");
});

test("builds the Chinese report and omits unknown capacity", () => {
  const config: ReportConfig = {
    siteName: "ABC ImgBed",
    timezone: "Asia/Shanghai",
    showChannelDetails: true,
  };
  const stats: DailyStats = {
    today: { fileCount: 3, knownSizeCount: 2, totalBytes: null },
    channels: [
      {
        key: "S3",
        displayName: "S3",
        fileCount: 3,
        knownSizeCount: 2,
        totalBytes: null,
        instances: [
          { name: "AWS", fileCount: 2, knownSizeCount: 2, totalBytes: 3 * 1024 * 1024 },
          { name: "MinIO", fileCount: 1, knownSizeCount: 0, totalBytes: null },
        ],
      },
    ],
    gallery: { fileCount: 1286, knownSizeCount: 1286, totalBytes: 18.42 * 1024 ** 3 },
  };

  const report = buildDailyReport(config, stats, new Date("2026-08-21T12:00:00.000Z"));
  assert.match(report, /^📊 ABC ImgBed 每日汇报\n2026-08-21 20:00/);
  assert.match(report, /文件：3 个/);
  assert.match(report, /📤 今日新增文件（截至报告时间，仍在库）\n文件：3 个/);
  assert.doesNotMatch(report, /📤 今日新增文件（截至报告时间，仍在库）\n文件：3 个\n容量：/);
  assert.match(report, /S3：3 个\n  ├─ AWS：2 个 \/ 3 MB\n  └─ MinIO：1 个/);
  assert.match(report, /文件总数：1,286\n总容量：18.42 GB/);
  assert.match(report, /✅ 日报生成正常$/);
});

test("keeps dynamic detail reports within Telegram's message limit", () => {
  const longInstances = Array.from({ length: 100 }, (_, index) => ({
    name: `Instance-${index}-${"x".repeat(100)}`,
    fileCount: 1,
    knownSizeCount: 1,
    totalBytes: 1024,
  }));
  const report = buildDailyReport(
    { siteName: "ImgBed", timezone: "Asia/Shanghai", showChannelDetails: true },
    {
      today: { fileCount: 100, knownSizeCount: 100, totalBytes: 102400 },
      channels: [
        {
          key: "FutureStorage",
          displayName: "FutureStorage",
          fileCount: 100,
          knownSizeCount: 100,
          totalBytes: 102400,
          instances: longInstances,
        },
      ],
      gallery: { fileCount: 100, knownSizeCount: 100, totalBytes: 102400 },
    },
    new Date("2026-08-21T12:00:00.000Z"),
  );

  assert.ok(report.length <= 4096);
  assert.match(report, /部分渠道或明细已省略/);
  assert.match(report, /📚 当前文件库\n文件总数：100\n总容量：100 KB/);
  assert.match(report, /✅ 日报生成正常$/);
});
