import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { collectDailyStats } from "../src/stats.ts";

function asD1Database(sqlite: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...parameters: number[]) {
          return {
            async all<T>() {
              const results = sqlite.prepare(query).all(...parameters) as unknown as T[];
              return { results };
            },
          };
        },
        async first<T>() {
          const result = sqlite.prepare(query).get() ?? null;
          return result as T | null;
        },
      };
    },
  } as unknown as D1Database;
}

test("collects daily and gallery stats against the upstream ImgBed SQLite schema", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const fixture = readFileSync(new URL("./fixtures/imgbed-d1.sql", import.meta.url), "utf8");
    sqlite.exec(fixture);

    const stats = await collectDailyStats(
      asD1Database(sqlite),
      new Date(1787280000000),
      new Date(1787300000000),
    );

    assert.deepEqual(stats.today, {
      fileCount: 3,
      knownSizeCount: 3,
      totalBytes: 3670016,
    });
    assert.deepEqual(
      stats.channels.map(({ key, fileCount, totalBytes }) => ({ key, fileCount, totalBytes })),
      [
        { key: "Telegram", fileCount: 2, totalBytes: 1572864 },
        { key: "S3", fileCount: 1, totalBytes: 2097152 },
      ],
    );
    assert.deepEqual(stats.gallery, {
      fileCount: 3,
      knownSizeCount: 3,
      totalBytes: 3670016,
    });
  } finally {
    sqlite.close();
  }
});
