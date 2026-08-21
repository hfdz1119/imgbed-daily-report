import type {
  ChannelInstanceSummary,
  ChannelSummary,
  DailyStats,
  SizeSummary,
} from "./types.ts";

interface ChannelRow {
  channel: string | null;
  channel_name: string | null;
  file_count: number;
  known_size_count: number;
  total_bytes: number | null;
}
interface SummaryRow {
  file_count: number;
  known_size_count: number;
  total_bytes: number | null;
}

interface MutableSizeSummary {
  fileCount: number;
  knownSizeCount: number;
  knownBytes: number;
}

interface MutableChannelSummary extends MutableSizeSummary {
  key: string;
  displayName: string;
  instances: Map<string, MutableSizeSummary>;
}

// CloudFlare-ImgBed v2.7.6 stores the exact byte count in metadata JSON.
// Older rows only have file_size, a two-decimal MB string. Invalid or absent
// values remain NULL so the report never converts unknown capacity to zero.
const LEGACY_SIZE_BYTES_SQL = `
  CASE
    WHEN file_size IS NOT NULL
      AND trim(file_size) <> ''
      AND trim(file_size) GLOB '*[0-9]*'
      AND trim(file_size) NOT GLOB '*[^0-9.eE+-]*'
      AND CAST(file_size AS REAL) >= 0
    THEN CAST(file_size AS REAL) * 1048576.0
    ELSE NULL
  END
`;

const SIZE_BYTES_SQL = `
  CASE
    WHEN json_valid(metadata) = 1 THEN
      CASE
        WHEN json_type(metadata, '$.FileSizeBytes') IN ('integer', 'real')
          AND CAST(json_extract(metadata, '$.FileSizeBytes') AS REAL) >= 0
        THEN CAST(json_extract(metadata, '$.FileSizeBytes') AS REAL)
        ELSE ${LEGACY_SIZE_BYTES_SQL}
      END
    ELSE ${LEGACY_SIZE_BYTES_SQL}
  END
`;

const CHANNELS_SQL = `
  WITH valid_files AS (
    SELECT channel, channel_name, timestamp, ${SIZE_BYTES_SQL} AS size_bytes
    FROM files
    WHERE timestamp IS NOT NULL
  )
  SELECT
    channel,
    channel_name,
    COUNT(*) AS file_count,
    COUNT(size_bytes) AS known_size_count,
    SUM(size_bytes) AS total_bytes
  FROM valid_files
  WHERE timestamp >= ? AND timestamp <= ?
  GROUP BY channel, channel_name
  ORDER BY file_count DESC, channel ASC, channel_name ASC
`;

const GALLERY_SQL = `
  WITH valid_files AS (
    SELECT ${SIZE_BYTES_SQL} AS size_bytes
    FROM files
    WHERE timestamp IS NOT NULL
  )
  SELECT
    COUNT(*) AS file_count,
    COUNT(size_bytes) AS known_size_count,
    SUM(size_bytes) AS total_bytes
  FROM valid_files
`;

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  CloudflareR2: "Cloudflare R2",
  HuggingFace: "Hugging Face",
};

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// The only storage compatibility aliases are inherited from upstream itself.
// Unknown future channel values pass through unchanged.
export function normalizeChannel(rawChannel: string | null): string {
  const channel = rawChannel?.trim();
  if (!channel) return "Telegraph";
  if (channel === "TelegramNew") return "Telegram";
  return channel;
}

export function displayChannelName(channel: string): string {
  return DISPLAY_NAMES[channel] ?? channel;
}

function finalizeSizeSummary(summary: MutableSizeSummary): SizeSummary {
  const complete = summary.fileCount > 0 && summary.knownSizeCount === summary.fileCount;
  return {
    fileCount: summary.fileCount,
    knownSizeCount: summary.knownSizeCount,
    totalBytes: complete ? summary.knownBytes : null,
  };
}

function addRow(summary: MutableSizeSummary, row: ChannelRow): void {
  summary.fileCount += numberValue(row.file_count);
  summary.knownSizeCount += numberValue(row.known_size_count);
  summary.knownBytes += numberValue(row.total_bytes);
}

export function buildChannelStats(rows: ChannelRow[]): {
  today: SizeSummary;
  channels: ChannelSummary[];
} {
  const today: MutableSizeSummary = { fileCount: 0, knownSizeCount: 0, knownBytes: 0 };
  const channels = new Map<string, MutableChannelSummary>();

  for (const row of rows) {
    const key = normalizeChannel(row.channel);
    const channel = channels.get(key) ?? {
      key,
      displayName: displayChannelName(key),
      fileCount: 0,
      knownSizeCount: 0,
      knownBytes: 0,
      instances: new Map<string, MutableSizeSummary>(),
    };
    channels.set(key, channel);

    addRow(today, row);
    addRow(channel, row);

    const instanceName = row.channel_name?.trim() || "未命名渠道";
    const instance = channel.instances.get(instanceName) ?? {
      fileCount: 0,
      knownSizeCount: 0,
      knownBytes: 0,
    };
    addRow(instance, row);
    channel.instances.set(instanceName, instance);
  }

  const finalizedChannels = [...channels.values()]
    .map((channel): ChannelSummary => ({
      key: channel.key,
      displayName: channel.displayName,
      ...finalizeSizeSummary(channel),
      instances: [...channel.instances.entries()]
        .map(([name, summary]): ChannelInstanceSummary => ({
          name,
          ...finalizeSizeSummary(summary),
        }))
        .sort((left, right) => right.fileCount - left.fileCount || left.name.localeCompare(right.name)),
    }))
    .sort(
      (left, right) =>
        right.fileCount - left.fileCount || left.displayName.localeCompare(right.displayName),
    );

  return { today: finalizeSizeSummary(today), channels: finalizedChannels };
}

function buildGallerySummary(row: SummaryRow | null): SizeSummary {
  const fileCount = numberValue(row?.file_count);
  const knownSizeCount = numberValue(row?.known_size_count);
  const knownBytes = numberValue(row?.total_bytes);
  return finalizeSizeSummary({ fileCount, knownSizeCount, knownBytes });
}

export async function collectDailyStats(
  db: D1Database,
  startTime: Date,
  endTime: Date,
): Promise<DailyStats> {
  const channelResult = await db
    .prepare(CHANNELS_SQL)
    .bind(startTime.getTime(), endTime.getTime())
    .all<ChannelRow>();

  const channelStats = buildChannelStats(channelResult.results ?? []);

  let gallery: SizeSummary | null = null;
  try {
    const galleryRow = await db.prepare(GALLERY_SQL).first<SummaryRow>();
    gallery = buildGallerySummary(galleryRow);
  } catch (error) {
    console.warn("ImgBed gallery summary is unavailable; daily channel report will still be sent:", error);
  }

  return { ...channelStats, gallery };
}
