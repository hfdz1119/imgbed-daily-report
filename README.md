# ImgBed Daily Report

ImgBed Daily Report 是一个为 [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 开发的独立 Telegram 日报扩展。

它以独立 Cloudflare Worker 运行，通过只读 SQL 查询用户现有的 ImgBed D1 数据库，按配置时区统计当天新增且仍保留在库中的文件，并生成当前文件库概览，再通过 Telegram Bot 发送。

> 本项目是 CloudFlare-ImgBed 的社区生态扩展，不是 CloudFlare-ImgBed 官方核心组件，也不会修改其主项目代码。

## 功能

- 当地自然日 `00:00 → 报告生成时刻` 的新增文件数与元数据容量；统计仅包括报告时仍有 D1 记录的文件
- 当前文件库的文件总数与元数据容量
- 从 `files.channel` 动态识别实际存在的存储渠道
- 可选的 `channel_name` 多实例明细
- Telegram 定时日报，仅对明确返回的 `429` 限流按 `retry_after` 重试一次；网络超时、断连和其他不确定失败不自动重发，避免重复日报
- 长报文优先保留今日合计和当前文件库总览，必要时省略渠道或实例明细
- 自定义站点名称和 IANA 时区
- 受 Token 保护的手动测试接口
- Telegram 只读小程序：查看今日新增、当前图库总量与存储渠道汇总
- 独立 Worker，不修改 CloudFlare-ImgBed
- 运行时代码仅执行预定义 `SELECT`，不写入 ImgBed 数据库
- 容量缺失时省略容量，不把未知数据伪装为 `0 B`

当前已确认的 CloudFlare-ImgBed 渠道包括 Telegram、Cloudflare R2、S3 Compatible、Discord、Hugging Face、WebDAV 和 External。日报不会使用固定渠道列表过滤数据；未来新渠道只要继续写入统一的 `files.channel` 字段，就会自动显示。

## 日报示例

```text
📊 ImgBed 每日汇报
2026-08-21 20:00

📤 今日上传
文件：31 个
容量：486.3 MB

💾 存储分布
Telegram：12 个 / 183.5 MB
Cloudflare R2：9 个 / 142.8 MB
S3：5 个 / 81.2 MB
WebDAV：5 个 / 78.8 MB

📚 当前图库
文件总数：1,286
总容量：18.42 GB

✅ 日报生成正常
```

日报的时间戳是生成时刻。默认 Cron 在北京时间 20:00 运行，因此“今日”统计是当天 `00:00` 到 20:00 的范围，不代表完整自然日。由于上游 D1 保存的是当前文件记录，日内上传后又删除的文件不会留在此统计中；容量来自文件元数据，不等于 R2、S3 等存储服务的计费容量。

启用渠道明细后：

```text
Telegram：50 个 / 800 MB
  ├─ TG-A：20 个 / 320 MB
  └─ TG-B：30 个 / 480 MB
```

## 前置条件

- 已部署 CloudFlare-ImgBed，并使用 D1 保存文件元数据
- Cloudflare 账号能够为新 Worker 绑定该 D1 数据库
- Node.js 22 或更高版本
- 一个 Telegram Bot，以及目标私聊、群组或频道的 Chat ID

如果 ImgBed 当前使用 KV 而不是 D1 保存元数据，首版 ImgBed Daily Report 不能直接读取该实例。

## 部署教程

### 1. Fork 或 Clone

```bash
git clone https://github.com/hfdz1119/imgbed-daily-report.git
cd imgbed-daily-report
npm install
```

Fork 后请把 Clone 地址换成自己的仓库地址。

### 2. 确认 ImgBed D1

在 Cloudflare Dashboard 的 **Storage & Databases → D1 SQL database** 中找到 CloudFlare-ImgBed 使用的数据库，记录：

- Database name
- Database ID

也可以查看 CloudFlare-ImgBed 自己的 Wrangler 配置。上游通常把该数据库绑定为 `img_d1`，而本项目在自己的 Worker 内统一使用绑定名 `DB`；两个绑定名可以不同，但必须指向同一个 D1 数据库。

### 3. 配置 D1 Binding

编辑 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "你的 ImgBed D1 名称"
database_id = "你的 ImgBed D1 ID"
```

日报 Worker 不需要 ImgBed 的 R2、Telegram、Discord、S3、Hugging Face 或 WebDAV 凭据。它只读取统一的 D1 文件记录。

### 4. 创建 Telegram Bot

1. 在 Telegram 中打开 [@BotFather](https://t.me/BotFather)。
2. 发送 `/newbot`，按提示设置名称和用户名。
3. 保存 BotFather 返回的 Bot Token，不要提交到 Git。
4. 根据下方“Telegram Chat ID 教程”取得目标 Chat ID。

### 5. 创建 Worker 并配置 Secrets

登录 Cloudflare：

```bash
npx wrangler login
```

完成 D1 配置后先创建 Worker：

```bash
npm run deploy
```

此时 Telegram 尚未配置，Worker 会明确记录配置缺失，但不会写入 ImgBed，也不会影响主项目。

依次添加三个 Secret：

```bash
npx wrangler secret put REPORT_TELEGRAM_BOT_TOKEN
npx wrangler secret put REPORT_TELEGRAM_CHAT_ID
npx wrangler secret put REPORT_TRIGGER_TOKEN
```

`wrangler secret put` 会为 Worker 发布包含新 Secret 的版本。`REPORT_TRIGGER_TOKEN` 应使用足够长的随机字符串，仅用于保护手动 `/report` 接口。不要把这些值写进 `wrangler.toml`、README 或源码。详见 [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

### 6. 设置普通变量

默认配置已经写在 `wrangler.toml`：

```toml
[vars]
REPORT_SITE_NAME = "ImgBed"
REPORT_TIMEZONE = "Asia/Shanghai"
REPORT_SHOW_CHANNEL_DETAILS = "false"
```

例如，把标题改为 `My Images`：

```toml
REPORT_SITE_NAME = "My Images"
```

### 7. 设置 Cron

默认配置：

```toml
[triggers]
crons = ["0 12 * * *"]
```

Cloudflare Cron 使用 UTC。`0 12 * * *` 是 UTC 12:00，对应北京时间每天 20:00。

`REPORT_TIMEZONE` 只决定“自然日边界”和日报显示时间，不会自动改变 Cron。如果修改发送时间，必须同时修改 `crons`。

### 8. 检查并部署

```bash
npm run lint
npm test
npm run deploy -- --dry-run
npm run deploy
```

首次部署会创建名为 `imgbed-daily-report` 的 Worker，并按 `wrangler.toml` 设置 Cron Trigger。

### 9. 手动发送测试日报

不需要等待 Cron。部署后运行：

```bash
curl -X POST "https://imgbed-daily-report.<你的-subdomain>.workers.dev/report" \
  -H "Authorization: Bearer <你的-REPORT_TRIGGER_TOKEN>"
```

也支持：

```bash
curl -X POST "https://imgbed-daily-report.<你的-subdomain>.workers.dev/report" \
  -H "X-Report-Token: <你的-REPORT_TRIGGER_TOKEN>"
```

未配置 `REPORT_TRIGGER_TOKEN` 时，手动接口保持关闭并返回 `503`。错误 Token 返回 `401`。Cron 不需要该 Token。

### 10. 查看健康状态和日志

```bash
curl "https://imgbed-daily-report.<你的-subdomain>.workers.dev/health"
npx wrangler tail
```

`/health` 只返回配置状态，不返回 Bot Token、Chat ID 或触发 Token；上次日报成功时间目前仍需从 Worker 日志确认。若要在接口中显示最近成功时间，建议后续用独立 KV 保存运行状态，不要写入上游 ImgBed D1。

## 在 Telegram 里打开只读图床概览

部署包含小程序的版本后，Telegram Web App 页面使用 Worker 的 HTTPS 地址 `/miniapp`，统计接口只返回今日上传数、当前图库汇总和按存储渠道聚合的数据；不会返回图片 URL、文件名或渠道实例明细，也不提供修改操作。

访问权限会先验证 Telegram 签名的启动数据，再检查用户 ID。若 `REPORT_TELEGRAM_ALLOWED_USER_IDS` 配了逗号分隔的数字 ID，就只允许名单中的账号；若未配置，只有在 `REPORT_TELEGRAM_CHAT_ID` 是正数的私聊 ID 时，才默认允许那个私聊用户。群组或频道不会自动获得查看权限，需要显式配置允许的个人 Telegram 用户 ID。没有有效允许名单时，数据接口默认关闭。

要把入口加到机器人私聊菜单：在 Telegram 打开 [@BotFather](https://t.me/BotFather)，用 `/mybots` 选中机器人，再到 **Bot Settings → Menu Button → Configure Menu Button**，按钮文字填“图床数据”，网址填部署后的 `https://<你的-worker-域名>/miniapp`。Telegram 的菜单 Web App 入口需要 HTTPS，并在和机器人的私聊中使用。

## Telegram Chat ID 教程

### 私聊

1. 打开刚创建的 Bot，点击 Start 或发送一条消息。
2. 在浏览器访问以下地址，并将占位符替换为自己的 Bot Token：

   ```text
   https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
   ```

3. 找到 `message.chat.id`。私聊 ID 通常是正整数。

### 群组

1. 把 Bot 加入群组。
2. 在群里发送一条 Bot 能收到的消息；必要时在 BotFather 调整 Privacy Mode。
3. 从 `getUpdates` 的 `message.chat.id` 取得 ID。群组或超级群组 ID 通常是负数。

### 频道

1. 把 Bot 添加为频道管理员，并授予发送消息权限。
2. 可以使用公开频道用户名，例如 `@channel_name`；私有频道通常使用数值 Chat ID。
3. 若通过 `getUpdates` 获取，查看 `channel_post.chat.id`。

常见问题是 Bot 没有目标会话的发送权限，或 Chat ID 来自错误的私聊、群组或频道。

## 配置表

| 变量 | 类型 | 必填 | 默认值 | 作用 |
|---|---|---:|---|---|
| `REPORT_TELEGRAM_BOT_TOKEN` | Secret | 是 | 无 | Telegram Bot Token |
| `REPORT_TELEGRAM_CHAT_ID` | Secret | 是 | 无 | 接收日报的私聊、群组或频道 ID |
| `REPORT_TRIGGER_TOKEN` | Secret | 手动接口必填 | 无 | 保护 `POST /report` |
| `REPORT_TELEGRAM_ALLOWED_USER_IDS` | Variable | 否 | 私聊时回退到 `REPORT_TELEGRAM_CHAT_ID` | 允许打开图床小程序的 Telegram 用户 ID，逗号分隔 |
| `REPORT_SITE_NAME` | Variable | 否 | `ImgBed` | 日报标题中的站点名称 |
| `REPORT_TIMEZONE` | Variable | 否 | `Asia/Shanghai` | IANA 时区，决定自然日边界与显示时间 |
| `REPORT_SHOW_CHANNEL_DETAILS` | Variable | 否 | `false` | 是否显示 `channel_name` 实例明细 |

| Binding | 必填 | 作用 |
|---|---:|---|
| `DB` | 是 | 绑定用户现有的 CloudFlare-ImgBed D1 数据库 |

## 数据读取与隐私

运行时代码只执行两个预定义查询：

- 今日按 `channel`、`channel_name` 聚合
- 当前图库总体聚合

两个查询都要求 `timestamp IS NOT NULL`，从而排除 ImgBed 分块上传可能遗留的会话、分块和 multipart 临时记录。

容量读取顺序：

1. 优先读取 `metadata.FileSizeBytes` 的精确字节数。
2. 旧记录回退到 `file_size`，它在上游中是 MB 数值字符串。
3. 任一统计范围存在无法解析的容量时，该范围只显示文件数，省略容量并写入 Worker 日志。

日报默认不读取或发送：

- 上传 IP 和地址
- 用户 Token 或身份信息
- Bot Token、Chat ID、触发 Token
- 文件名、文件 URL 或文件列表

Cloudflare D1 binding 当前没有项目内可配置的 SQL 级只读账号。本项目通过代码边界保证只读：`src/` 中没有数据库写入语句，也没有接受外部 SQL 的接口。

## Compatibility

开发和测试基准：

- CloudFlare-ImgBed `v2.7.6`
- 上游提交 `3a87cb469b05e97d4c44607911fdea282c333f12`
- 数据表：`files`
- 关键字段：`metadata`、`file_size`、`timestamp`、`channel`、`channel_name`

渠道识别规则集中在 `src/stats.ts`：

- `TelegramNew` 和旧 `Telegram` 合并显示为 `Telegram`
- 空渠道按上游历史兼容语义显示为 `Telegraph`
- 其他值原样保留，因此新的统一渠道值可自动显示

兼容性成立的条件是：未来 CloudFlare-ImgBed 仍使用 D1 `files` 表，并继续写入上述统一字段。如果上游修改表名、时间字段或容量字段，需要集中调整 `src/stats.ts`。

本项目会关注 CloudFlare-ImgBed 的主要数据结构变化，并尽力保持与当前主流版本兼容，但不承诺对所有未来版本永久无条件兼容。

## 本地开发

复制本地 Secret 示例：

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .dev.vars.example .dev.vars
npm.cmd run dev
```

`.dev.vars` 已被 Git 忽略。不要在示例文件中填入真实 Secret 后提交。

项目提供一个只供本地测试使用的 D1 夹具：

```bash
npx wrangler d1 execute DB --local --file=test/fixtures/imgbed-d1.sql
```

该文件包含本地建表和示例记录，绝对不要带 `--remote` 运行，也不要对生产 ImgBed D1 执行。

本地 Cron 测试：

```bash
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

## 常见问题

### 为什么没有容量统计？

至少有一条相关文件记录缺少可用的 `metadata.FileSizeBytes` 和 `file_size`。为避免报告一个偏小的错误总量，程序会省略该范围容量。使用 `npx wrangler tail` 可以看到容量覆盖率。

### 为什么某个渠道没有显示？

默认只显示“今天存在成功文件记录”的渠道。已删除记录不会显示；`timestamp` 为空的分块临时记录也不会显示。请检查文件是否属于配置时区的当前自然日。

### 为什么出现 `TelegramNew`？

正常情况下不会。程序会把上游当前值 `TelegramNew` 和旧值 `Telegram` 合并显示为 `Telegram`。若上游出现新的不同值，它会原样显示，以避免错误归类。

### 为什么 Telegram 没收到消息？

检查 Worker 日志，并确认：

- 两个 Telegram Secret 均已设置
- Bot Token 有效
- Chat ID 正确
- Bot 已启动或已加入目标群组/频道
- Bot 在频道中有发送权限
- Cloudflare Worker 可以访问 Telegram Bot API

Telegram HTTP 非 2xx、返回 `ok:false` 或请求超时都会记录明确错误，并自动重试一次。

### 渠道明细太多怎么办？

Telegram 单条文本有长度限制。日报会优先保留标题和正常结束状态；内容超过限制时会安全省略尾部的部分渠道或实例明细，并在消息中明确提示。

### Cron 为什么不是北京时间？

Cloudflare Cron 使用 UTC。默认 `0 12 * * *` 才是北京时间 20:00。修改 `REPORT_TIMEZONE` 不会修改 Cron。

### 如何修改站点名称？

修改 `wrangler.toml` 中的 `REPORT_SITE_NAME`，然后重新部署。

### 如何立即发送测试日报？

使用带 `REPORT_TRIGGER_TOKEN` 的 `POST /report`。不要使用 GET，也不要把 Token 放进 URL 查询参数。

### 会影响 CloudFlare-ImgBed 上传吗？

不会。它是独立 Worker，不参与上传和文件访问链路。即使日报 Worker 故障，也不会阻塞 ImgBed 主项目。

## 安全建议

- 所有敏感值都使用 Wrangler Secret
- 不要把 `.dev.vars`、终端历史或截图中的 Secret 提交到 GitHub
- 为 Bot 只授予发送日报所需的最小权限
- 使用长随机 `REPORT_TRIGGER_TOKEN`
- 不要将本地 D1 测试夹具用于远程数据库
- 公开部署前运行 `npm run check`

安全问题请通过仓库的非公开安全报告渠道提交，不要在公开 Issue 中粘贴 Token、Chat ID 或数据库信息。

## 开源与贡献

本项目使用 [MIT License](LICENSE)。欢迎提交 Issue 和 Pull Request，特别是 CloudFlare-ImgBed 数据结构兼容性、不同 D1 历史版本和 Telegram 部署文档方面的改进。

在提交兼容性修改时，请说明测试的 CloudFlare-ImgBed 版本和关键字段变化，不要提交任何真实 Secret 或私人文件数据。

## 致谢与溯源

- 上游项目：[MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)
- Cloudflare Workers：[Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- Telegram Bot API：[sendMessage](https://core.telegram.org/bots/api#sendmessage)

ImgBed Daily Report 只提供独立扩展能力；CloudFlare-ImgBed 的名称、代码和相关权利归其原项目及贡献者所有。
