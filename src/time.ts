const DATE_PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}
function getDateFormatter(timezone: string): Intl.DateTimeFormat {
  const existing = DATE_PARTS_FORMATTERS.get(timezone);
  if (existing) return existing;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  DATE_PARTS_FORMATTERS.set(timezone, formatter);
  return formatter;
}

function getLocalDateParts(date: Date, timezone: string): LocalDateParts {
  const values: Record<string, string> = {};
  for (const part of getDateFormatter(timezone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function dateKey(parts: LocalDateParts): number {
  return parts.year * 10_000 + parts.month * 100 + parts.day;
}

export function assertValidTimezone(timezone: string): void {
  try {
    getDateFormatter(timezone).format(new Date(0));
  } catch {
    throw new Error(`Invalid REPORT_TIMEZONE: ${timezone}`);
  }
}

export function getLocalDayStart(now: Date, timezone: string): Date {
  assertValidTimezone(timezone);
  const targetParts = getLocalDateParts(now, timezone);
  const targetKey = dateKey(targetParts);
  const utcGuess = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);

  // Every IANA timezone is within this window. Binary search finds the first
  // instant belonging to the local date, including days with DST transitions.
  let low = utcGuess - 36 * 60 * 60 * 1000;
  let high = utcGuess + 36 * 60 * 60 * 1000;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateKey(getLocalDateParts(new Date(middle), timezone)) < targetKey) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const result = new Date(low);
  if (dateKey(getLocalDateParts(result, timezone)) !== targetKey) {
    throw new Error(`Unable to resolve the current local day in timezone: ${timezone}`);
  }
  return result;
}

export function formatReportTimestamp(date: Date, timezone: string): string {
  const parts: Record<string, string> = {};
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
