# Changelog

All notable changes to ImgBed Daily Report will be documented in this file.

## 1.0.0 - 2026-08-23

- Initial independent Cloudflare Worker release.
- Add natural-day ImgBed upload and gallery aggregation from D1.
- Add dynamic storage-channel and optional channel-instance statistics.
- Add Telegram delivery with timeout, response validation, and one retry.
- Add configurable site name, timezone, Cron, and protected manual trigger.
- Add compatibility, privacy, deployment, Telegram, and FAQ documentation.
- Production Cron verified: PASS (2026-08-22). The scheduled
  `Cloudflare Cron → Worker → D1 SELECT → report generation → Telegram`
  production path completed successfully.
