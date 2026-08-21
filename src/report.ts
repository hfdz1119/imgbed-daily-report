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

function fitTelegramMessage(lines: string[]): string {
  const footer = ["", "✅ 日报生成正常"];
  const complete = [...lines, ...footer].join("\n");
  if (complete.length <= TELEGRAM_MESSAGE_LIMIT) return complete;

  const suffix = ["", "ℹ️ 内容过长，部分渠道或明细已省略", ...footer];
  const kept: string[] = [];
  for (const line of lines) {
    if ([...kept, line, ...suffix].join("\n").length > TELEGRAM_MESSAGE_LIMIT) break;
    kept.push(line);
  }
  return [...kept, ...suffix].join("\n");
}

export function buildDailyReport(
  config: ReportConfig,
  stats: DailyStats,
  generatedAt: Date,
): string {
  logUnknownCapacity("Today", stats.today);
  if (stats.gallery) logUnknownCapacity("Gallery", stats.gallery);
  for (const channel of stats.channels) logUnknownCapacity(`Channel ${channel.key}`, channel);

  const lines = [
    `📊 ${config.siteName} 每日汇报`,
    formatReportTimestamp(generatedAt, config.timezone),
    "",
    "📤 今日上传",
    `文件：${countText(stats.today.fileCount)} 个`,
  ];

  if (stats.today.totalBytes !== null) {
    lines.push(`容量：${formatBytes(stats.today.totalBytes)}`);
  }

  lines.push("", "💾 存储分布");
  if (stats.channels.length === 0) {
    lines.push("今日暂无上传");
  } else {
    for (const channel of stats.channels) {
      lines.push(summaryLine(channel.displayName, channel));
      if (config.showChannelDetails) lines.push(...detailLines(channel.instances));
    }
  }

  lines.push("", "📚 当前图库");
  if (!stats.gallery) {
    lines.push("统计暂不可用");
  } else {
    lines.push(`文件总数：${countText(stats.gallery.fileCount)}`);
    if (stats.gallery.totalBytes !== null) {
      lines.push(`总容量：${formatBytes(stats.gallery.totalBytes)}`);
    }
  }

  return fitTelegramMessage(lines);
}
