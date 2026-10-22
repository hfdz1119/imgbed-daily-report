import type { ChannelInstanceSummary, DailyStats, ReportConfig, SizeSummary } from "./types.ts";
import { formatReportTimestamp } from "./time.ts";

const COUNT_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const TELEGRAM_MESSAGE_LIMIT = 4096;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error("Capacity must be a non-negative finite number");
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = unitIndex === 0 ? 0 : unitIndex >= 3 ? 2 : 1;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value)} ${SIZE_UNITS[unitIndex]}`;
}

function countText(value: number): string {
  return COUNT_FORMATTER.format(value);
}

function summaryLine(label: string, summary: SizeSummary): string {
  const capacity = summary.totalBytes === null ? "" : ` / ${formatBytes(summary.totalBytes)}`;
  const safeLabel = [...label.replace(/\s+/g, " ")].slice(0, 80).join("");
  return `${safeLabel}：${countText(summary.fileCount)} 个${capacity}`;
}

function detailLines(instances: ChannelInstanceSummary[]): string[] {
  return instances.map((instance, index) => {
    const branch = index === instances.length - 1 ? "└─" : "├─";
    return `  ${branch} ${summaryLine(instance.name, instance)}`;
  });
}

function logUnknownCapacity(scope: string, summary: SizeSummary): void {
  if (summary.fileCount > 0 && summary.totalBytes === null) {
    console.warn(
      `${scope} capacity omitted: ${summary.knownSizeCount}/${summary.fileCount} files have a usable size.`,
    );
  }
}

function fitTelegramMessage(
  prefix: string[],
  channelBlocks: string[][],
  gallery: string[],
): string {
  const footer = ["", "✅ 日报生成正常"];
  const channelLines = channelBlocks.flat();
  const complete = [...prefix, ...channelLines, ...gallery, ...footer].join("\n");
  if (complete.length <= TELEGRAM_MESSAGE_LIMIT) return complete;

  const omission = "ℹ️ 内容过长，部分渠道或明细已省略";
  const kept: string[] = [];
  for (const [summary, ...details] of channelBlocks) {
    const summaryCandidate = [...prefix, ...kept, summary, omission, ...gallery, ...footer].join("\n");
    if (summaryCandidate.length > TELEGRAM_MESSAGE_LIMIT) continue;
    kept.push(summary);

    const detailCandidate = [...prefix, ...kept, ...details, omission, ...gallery, ...footer].join("\n");
    if (detailCandidate.length <= TELEGRAM_MESSAGE_LIMIT) kept.push(...details);
  }

  return [...prefix, ...kept, omission, ...gallery, ...footer].join("\n");
}

export function buildDailyReport(
  config: ReportConfig,
  stats: DailyStats,
  generatedAt: Date,
): string {
  logUnknownCapacity("Today", stats.today);
  if (stats.gallery) logUnknownCapacity("Gallery", stats.gallery);
  for (const channel of stats.channels) logUnknownCapacity(`Channel ${channel.key}`, channel);

  const prefix = [
    `📊 ${config.siteName} 每日汇报`,
    formatReportTimestamp(generatedAt, config.timezone),
    "",
    "📤 今日新增文件（截至报告时间，仍在库）",
    `文件：${countText(stats.today.fileCount)} 个`,
  ];

  if (stats.today.totalBytes !== null) {
    prefix.push(`容量：${formatBytes(stats.today.totalBytes)}`);
  }

  prefix.push("", "💾 存储分布");
  const channelBlocks = stats.channels.length === 0
    ? [["今日暂无上传"]]
    : stats.channels.map((channel) => [
      summaryLine(channel.displayName, channel),
      ...(config.showChannelDetails ? detailLines(channel.instances) : []),
    ]);

  const gallery = ["", "📚 当前文件库"];
  if (!stats.gallery) {
    gallery.push("统计暂不可用");
  } else {
    gallery.push(`文件总数：${countText(stats.gallery.fileCount)}`);
    if (stats.gallery.totalBytes !== null) {
      gallery.push(`总容量：${formatBytes(stats.gallery.totalBytes)}`);
    }
  }

  return fitTelegramMessage(prefix, channelBlocks, gallery);
}
