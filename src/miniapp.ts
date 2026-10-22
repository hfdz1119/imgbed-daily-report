export const TELEGRAM_MINI_APP_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#eef4f2">
  <meta name="referrer" content="no-referrer">
  <title>ImgBed 图床概览</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      color-scheme: light dark;
      --page: var(--tg-theme-bg-color, #eef4f2);
      --card: var(--tg-theme-secondary-bg-color, #ffffff);
      --text: var(--tg-theme-text-color, #182522);
      --muted: var(--tg-theme-hint-color, #77837f);
      --accent: var(--tg-theme-button-color, #367c68);
      --accent-text: var(--tg-theme-button-text-color, #ffffff);
      --line: color-mix(in srgb, var(--text) 10%, transparent);
      --soft: color-mix(in srgb, var(--accent) 10%, var(--card));
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
      background: var(--page);
      color: var(--text);
      font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    main { width: min(100%, 560px); margin: 0 auto; }
    .hero {
      position: relative;
      overflow: hidden;
      padding: 24px 22px 21px;
      border-radius: 26px;
      color: #fff;
      background: radial-gradient(circle at 88% 12%, rgba(255,255,255,.22), transparent 30%), linear-gradient(135deg, #285d50, #448a73 62%, #91b795);
      box-shadow: 0 12px 32px rgba(35, 85, 70, .17);
    }
    .eyebrow { font-size: 12px; letter-spacing: .12em; opacity: .78; text-transform: uppercase; }
    h1 { margin: 6px 0 3px; font-size: 24px; letter-spacing: -.03em; }
    .hero-note { margin: 0; font-size: 13px; opacity: .82; }
    .refresh {
      position: absolute; top: 19px; right: 18px; width: 38px; height: 38px;
      border: 1px solid rgba(255,255,255,.28); border-radius: 50%; color: #fff;
      background: rgba(255,255,255,.13); font-size: 19px; cursor: pointer;
    }
    .refresh:disabled { opacity: .5; }
    .section-title { margin: 23px 3px 10px; font-size: 13px; color: var(--muted); font-weight: 650; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .card { min-width: 0; padding: 17px; border: 1px solid var(--line); border-radius: 21px; background: var(--card); }
    .card-label { color: var(--muted); font-size: 12px; font-weight: 550; }
    .value { margin-top: 8px; font-size: clamp(23px, 7vw, 30px); line-height: 1.1; font-weight: 740; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
    .detail { min-height: 18px; margin-top: 7px; color: var(--muted); font-size: 12px; }
    .wide { grid-column: 1 / -1; }
    .library-row { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
    .library-row .value { margin-top: 7px; }
    .library-side { text-align: right; }
    .library-side .value { font-size: 19px; letter-spacing: -.02em; }
    .channels { padding: 5px 16px; }
    .channel { padding: 13px 0; }
    .channel + .channel { border-top: 1px solid var(--line); }
    .channel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .channel-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 620; }
    .channel-count { flex: none; font-variant-numeric: tabular-nums; font-size: 13px; }
    .track { height: 6px; margin-top: 9px; border-radius: 99px; background: var(--soft); overflow: hidden; }
    .bar { height: 100%; min-width: 3px; border-radius: inherit; background: var(--accent); }
    .channel-size { margin-top: 5px; color: var(--muted); font-size: 11px; }
    .notice { display: none; margin: 15px 2px 0; padding: 13px 14px; border-radius: 16px; color: var(--muted); background: var(--card); font-size: 13px; }
    .notice.show { display: block; }
    .notice.error { color: #b44444; }
    .footer { margin: 18px 5px 0; color: var(--muted); font-size: 11px; text-align: center; }
    @media (prefers-reduced-motion: no-preference) {
      .bar { transition: width .35s ease; }
      .refresh:active { transform: scale(.95); }
    }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <div class="eyebrow">IMGBED · STORAGE</div>
      <h1 id="site-name">图床概览</h1>
      <p class="hero-note" id="updated-at">正在读取安全汇总…</p>
      <button class="refresh" id="refresh" type="button" aria-label="刷新数据">↻</button>
    </header>

    <div class="section-title">今天</div>
    <section class="stats" aria-label="今日统计">
      <article class="card">
        <div class="card-label">新增文件</div>
        <div class="value" id="today-count">—</div>
        <div class="detail" id="today-count-note">按图床时区统计</div>
      </article>
      <article class="card">
        <div class="card-label">新增容量</div>
        <div class="value" id="today-size">—</div>
        <div class="detail" id="today-size-note">来自文件元数据</div>
      </article>
    </section>

    <div class="section-title">当前图库</div>
    <section class="card wide" aria-label="当前图库总量">
      <div class="library-row">
        <div>
          <div class="card-label">文件总数</div>
          <div class="value" id="library-count">—</div>
        </div>
        <div class="library-side">
          <div class="card-label">元数据容量</div>
          <div class="value" id="library-size">—</div>
        </div>
      </div>
      <div class="detail" id="library-note">仅汇总数据库里当前保留的记录</div>
    </section>

    <div class="section-title">存储渠道</div>
    <section class="card channels" id="channels" aria-label="按存储渠道汇总"></section>
    <div class="notice" id="notice" role="status"></div>
    <p class="footer">只显示统计汇总，不返回图片链接或文件明细。</p>
  </main>
  <script>
    (function () {
      const tg = window.Telegram && window.Telegram.WebApp;
      const initData = tg && tg.initData ? tg.initData : "";
      if (tg) { tg.ready(); tg.expand(); }
      const refreshButton = document.getElementById("refresh");
      const notice = document.getElementById("notice");
      const countFormat = new Intl.NumberFormat("zh-CN");
      function setText(id, value) { document.getElementById(id).textContent = value; }
      function formatBytes(value) {
        if (value === null || !Number.isFinite(value)) return "暂不可用";
        if (value < 1024) return countFormat.format(Math.round(value)) + " B";
        const units = ["KB", "MB", "GB", "TB", "PB"];
        let amount = value;
        let unit = -1;
        do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
        return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: amount < 10 ? 2 : 1 }).format(amount) + " " + units[unit];
      }
      function setSummary(prefix, summary) {
        setText(prefix + "-count", countFormat.format(summary.fileCount));
        setText(prefix + "-size", formatBytes(summary.totalBytes));
        const sizeNoteId = prefix + "-size-note";
        const sizeNote = document.getElementById(sizeNoteId);
        if (sizeNote && summary.totalBytes === null && summary.fileCount > 0) {
          sizeNote.textContent = "部分记录缺少可用容量";
        }
      }
      function showNotice(message, isError) {
        notice.textContent = message;
        notice.className = "notice show" + (isError ? " error" : "");
      }
      function renderChannels(channels) {
        const container = document.getElementById("channels");
        container.replaceChildren();
        if (!channels.length) {
          const empty = document.createElement("div");
          empty.className = "detail";
          empty.textContent = "今天还没有统计到新增文件";
          container.appendChild(empty);
          return;
        }
        const total = channels.reduce(function (sum, item) { return sum + item.fileCount; }, 0);
        channels.forEach(function (item) {
          const row = document.createElement("div");
          row.className = "channel";
          const head = document.createElement("div");
          head.className = "channel-head";
          const name = document.createElement("div");
          name.className = "channel-name";
          name.textContent = item.displayName;
          const count = document.createElement("div");
          count.className = "channel-count";
          count.textContent = countFormat.format(item.fileCount) + " 个";
          head.append(name, count);
          const track = document.createElement("div");
          track.className = "track";
          const bar = document.createElement("div");
          bar.className = "bar";
          bar.style.width = (total ? Math.max(2, item.fileCount / total * 100) : 0) + "%";
          track.appendChild(bar);
          const size = document.createElement("div");
          size.className = "channel-size";
          size.textContent = formatBytes(item.totalBytes);
          row.append(head, track, size);
          container.appendChild(row);
        });
      }
      async function loadStats() {
        if (!initData) {
          showNotice("请从 Telegram 机器人里的「图床数据」菜单打开。", true);
          return;
        }
        refreshButton.disabled = true;
        notice.className = "notice";
        try {
          const response = await fetch("/api/miniapp/stats", {
            method: "GET",
            headers: { Authorization: "tma " + initData },
            cache: "no-store",
          });
          if (response.status === 401) throw new Error("Telegram 身份验证未通过，请关闭后从机器人菜单重新打开。");
          if (response.status === 403) throw new Error("这个 Telegram 账号还没有查看权限。");
          if (response.status === 503) throw new Error("小程序还未完成安全配置，暂时不能读取图床数据。");
          if (!response.ok) throw new Error("暂时读取失败，请稍后再试。");
          const data = await response.json();
          setText("site-name", data.siteName || "图床概览");
          const generated = new Date(data.generatedAt);
          let timeText = generated.toLocaleString("zh-CN", { timeZone: data.timezone });
          setText("updated-at", "统计范围按 " + data.timezone + " · 更新于 " + timeText);
          setSummary("today", data.today);
          if (data.gallery) {
            setText("library-count", countFormat.format(data.gallery.fileCount));
            setText("library-size", formatBytes(data.gallery.totalBytes));
            setText("library-note", data.gallery.totalBytes === null && data.gallery.fileCount > 0
              ? "当前保留记录 · 部分文件缺少可用容量"
              : "仅汇总数据库里当前保留的记录");
          } else {
            setText("library-count", "暂不可用");
            setText("library-size", "暂不可用");
            setText("library-note", "图库总量暂时无法读取，今日统计仍可查看");
          }
          renderChannels(data.channels || []);
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "暂时读取失败，请稍后再试。", true);
        } finally {
          refreshButton.disabled = false;
        }
      }
      refreshButton.addEventListener("click", loadStats);
      loadStats();
    }());
  </script>
</body>
</html>`;
