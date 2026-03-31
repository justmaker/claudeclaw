<p align="center">
  <img src="images/claudeclaw-banner.svg" alt="ClaudeClaw Banner" />
</p>
<p align="center">
  <img src="images/claudeclaw-wordmark.png" alt="ClaudeClaw Wordmark" />
</p>

<p align="center">
  <img src="https://awesome.re/badge.svg" alt="Awesome" />
  <a href="https://github.com/moazbuilds/ClaudeClaw/stargazers">
    <img src="https://img.shields.io/github/stars/moazbuilds/ClaudeClaw?style=flat-square&color=f59e0b" alt="GitHub Stars" />
  </a>
  <a href="https://github.com/moazbuilds/ClaudeClaw">
    <img src="https://img.shields.io/badge/downloads-~10k-2da44e?style=flat-square" alt="Downloads ~10k" />
  </a>
  <a href="https://github.com/moazbuilds/ClaudeClaw/commits/master">
    <img src="https://img.shields.io/github/last-commit/moazbuilds/ClaudeClaw?style=flat-square&color=0ea5e9" alt="Last Commit" />
  </a>
  <a href="https://github.com/moazbuilds/ClaudeClaw/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/moazbuilds/ClaudeClaw?style=flat-square&color=a855f7" alt="Contributors" />
  </a>
  <a href="https://x.com/moazbuilds">
    <img src="https://img.shields.io/badge/X-%40moazbuilds-000000?style=flat-square&logo=x" alt="X @moazbuilds" />
  </a>
</p>

<p align="center"><b>A lightweight, open-source OpenClaw version built into your Claude Code.</b></p>

ClaudeClaw turns your Claude Code into a personal assistant that never sleeps. It runs as a background daemon, executing tasks on a schedule, responding to messages on Telegram and Discord, transcribing voice commands, and integrating with any service you need.

> Note: Please don't use ClaudeClaw for hacking any bank system or doing any illegal activities. Thank you.

## Why ClaudeClaw?

| Category | ClaudeClaw | OpenClaw |
| --- | --- | --- |
| Anthropic Will Come After You | No | Yes |
| API Overhead | Directly uses your Claude Code subscription | Nightmare |
| Setup & Installation | ~5 minutes | Nightmare |
| Deployment | Install Claude Code on any device or VPS and run | Nightmare |
| Isolation Model | Folder-based and isolated as needed | Global by default (security nightmare) |
| Reliability | Simple reliable system for agents | Bugs nightmare |
| Feature Scope | Lightweight features you actually use | 600k+ LOC nightmare |
| Security | Average Claude Code usage | Nightmare |
| Cost Efficiency | Efficient usage | Nightmare |
| Memory | Uses Claude internal memory system + `CLAUDE.md` | Nightmare |

## Getting Started in 5 Minutes

```bash
claude plugin marketplace add moazbuilds/claudeclaw
claude plugin install claudeclaw
```
Then open a Claude Code session and run:
```
/claudeclaw:start
```
The setup wizard walks you through model, heartbeat, Telegram, Discord, and security, then your daemon is live with a web dashboard.

## What Would Be Built Next?

> **Mega Post:** Help shape the next ClaudeClaw features.
> Vote, suggest ideas, and discuss priorities in **[this post](https://github.com/moazbuilds/claudeclaw/issues/14)**.

<p align="center">
  <a href="https://github.com/moazbuilds/claudeclaw/issues/14">
    <img src="https://img.shields.io/badge/Roadmap-Mega%20Post-blue?style=for-the-badge&logo=github" alt="Roadmap Mega Post" />
  </a>
</p>

## Features

### Automation
- **Heartbeat:** Periodic check-ins with configurable intervals, quiet hours, dedicated model override, and per-channel forwarding control. Each heartbeat includes model info, session turn count, last heartbeat time, and context usage percentage.
- **Cron Jobs:** Timezone-aware schedules for repeating or one-time tasks with reliable execution.

### Communication
- **Telegram:** Text, image, and voice support.
- **Discord:** DMs, server mentions/replies, slash commands, voice messages, and image attachments.
- **Time Awareness:** Message time prefixes help the agent understand delays and daily patterns.

### Multi-Session Threads (Discord)
- **Independent Thread Sessions:** Each Discord thread gets its own Claude CLI session, fully isolated from the main channel.
- **Parallel Processing:** Thread conversations run concurrently — messages in different threads don't block each other.
- **Auto-Create:** First message in a new thread automatically bootstraps a fresh session. No setup needed.
- **Session Cleanup:** Thread sessions are automatically cleaned up when threads are deleted or archived.
- **Backward Compatible:** DMs and main channel messages continue using the global session.

See [docs/MULTI_SESSION.md](docs/MULTI_SESSION.md) for technical details.

### Reliability and Control
- **GLM Fallback:** Automatically continue with GLM models if your primary limit is reached.
- **Web Dashboard:** Manage jobs, monitor runs, and inspect logs in real time.
- **Security Levels:** Four access levels from read-only to full system access.
- **Model Selection:** Switch models based on your workload.
- **Settings Hot-Reload:** Changes to `settings.json` are detected automatically via `fs.watch()` with 500ms debounce — no restart needed for heartbeat, STT, and token pool changes.

## Structured Logging

ClaudeClaw uses a unified structured logger (`src/logger.ts`). All log output goes to:

1. **stdout** — human-readable format with timestamp and source tag (for `journalctl`)
2. **`/tmp/claudeclaw-structured.log`** — one JSON object per line (NDJSON)

### Log Entry Format

```json
{
  "timestamp": "2026-03-31T13:51:00.000Z",
  "level": "info",
  "source": "discord",
  "message": "Session created: abc123",
  "meta": { "session_id": "abc123", "user": "rex" }
}
```

### jq Query Examples

```bash
# 所有 error level 的 log
cat /tmp/claudeclaw-structured.log | jq 'select(.level == "error")'

# 只看 Discord 來源
cat /tmp/claudeclaw-structured.log | jq 'select(.source == "discord")'

# 最近 10 筆 log
tail -10 /tmp/claudeclaw-structured.log | jq .

# 搜尋特定 session
cat /tmp/claudeclaw-structured.log | jq 'select(.meta.session_id == "abc123")'

# 統計各 level 數量
cat /tmp/claudeclaw-structured.log | jq -s 'group_by(.level) | map({level: .[0].level, count: length})'
```

### Usage in Code

```typescript
import { createLogger } from "./logger";
const logger = createLogger("discord");

logger.info("Bot started");
logger.error("Connection failed", { error: "timeout", retry: 3 });
```

## Token Pool（多帳號輪轉）

團隊有多個 Claude 帳號時，可設定 token pool 自動輪轉和 rate limit 切換。

### Heartbeat 設定

在 `settings.json` 的 `heartbeat` 欄位設定：

```json
{
  "heartbeat": {
    "enabled": true,
    "interval": 60,
    "model": "sonnet",
    "prompt": "",
    "forwardToTelegram": true,
    "forwardToDiscord": false,
    "excludeWindows": [
      { "start": "23:00", "end": "08:00" }
    ]
  }
}
```

| 欄位 | 說明 |
|------|------|
| `model` | Heartbeat 專用 model，空字串時使用全域 `model` |
| `forwardToTelegram` | HEARTBEAT_OK 也轉發到 Telegram（非 OK 訊息一律轉發） |
| `forwardToDiscord` | HEARTBEAT_OK 也轉發到 Discord（非 OK 訊息一律轉發） |
| `excludeWindows` | 深夜靜默時段，支援跨日（如 23:00→08:00）及指定星期幾 |

每次 heartbeat 會自動注入狀態資訊供 Claude 參考：使用的 model、session turn count、上次 heartbeat 時間、context 用量百分比。

### Token Pool

在 `settings.json` 新增 `tokenPool` 和 `tokenStrategy`：

```json
{
  "tokenPool": [
    { "name": "rex", "model": "opus", "api": "sk-ant-xxx1", "priority": 1 },
    { "name": "alice", "model": "opus", "api": "sk-ant-xxx2", "priority": 2 },
    { "name": "bob", "model": "sonnet", "api": "sk-ant-xxx3", "priority": 3 }
  ],
  "tokenStrategy": "fallback-chain"
}
```

### 策略

| 策略 | 說明 |
|------|------|
| `fallback-chain` | 按 `priority` 順序使用，遇到 rate limit 自動切換下一個（預設） |
| `round-robin` | 每次請求輪流使用不同帳號 |
| `least-used` | 追蹤使用次數，每次挑使用最少的帳號 |

### 向後相容

沒有設定 `tokenPool` 時，仍使用原本的 `api` + `fallback` 機制，完全不受影響。

### Rate Limit 偵測

自動檢查 Claude 輸出中的 "you've hit your limit" 或 "out of extra usage" 訊息，觸發切換。

## OAuth 認證（使用 Claude CLI Token）

ClaudeClaw 支援使用 Claude CLI 的 OAuth token 呼叫 Anthropic API，省去額外的 API 費用。

在 `settings.json` 加入 `auth` 設定：

```json
{
  "auth": {
    "mode": "oauth",
    "oauthCredentialsPath": "~/.claude/.credentials.json"
  }
}
```

### 模式

| mode | 行為 |
|------|------|
| `api-key` | 使用 `api` 欄位的 API key（預設，向後相容） |
| `oauth` | 使用 OAuth token，無 token 則報錯 |
| `auto` | 優先使用 OAuth token，失敗則 fallback 到 API key |

### 運作原理

1. 讀取 `~/.claude/.credentials.json`（Claude CLI 登入後自動產生）
2. Token 快過期時自動呼叫 `claude` CLI 觸發 refresh
3. 30 秒 cache TTL 避免重複讀取磁碟

### 前置條件

- 已安裝 Claude CLI 並完成 `claude login`
- `~/.claude/.credentials.json` 存在且包含有效的 OAuth token

### ⚠️ 風險警告

> **此功能使用 Claude CLI 的 OAuth token 透過非官方方式呼叫 API。**
> 這可能違反 Anthropic 的服務條款（Terms of Service）。使用此功能的風險由使用者自行承擔。
> Anthropic 可能隨時變更認證機制，導致此功能失效。

## STT / 語音辨識設定

ClaudeClaw 支援語音訊息轉文字，可透過本機 whisper.cpp 或遠端 API 兩種模式。

在 `settings.json` 的 `stt` 欄位設定：

```json
{
  "stt": {
    "baseUrl": "",
    "model": "",
    "localModel": "large-v3",
    "language": "zh",
    "initialPrompt": "以下是繁體中文的語音內容。QVS QPKG QNAP..."
  }
}
```

| 欄位 | 說明 | 預設值 |
|------|------|--------|
| `baseUrl` | OpenAI 相容 STT API 的 URL。有值時走 API 模式，空值走本機 whisper.cpp | `""` |
| `model` | API 模式使用的 model 名稱 | `"Systran/faster-whisper-large-v3"` |
| `localModel` | 本機 whisper.cpp 使用的 model 名稱 | `"large-v3"` |
| `language` | 語言代碼（如 `zh`、`en`、`ja`），同時適用 API 和本機模式 | `""` |
| `initialPrompt` | 提示詞，幫助模型理解領域術語，提升辨識準確度 | `""` |

**中文使用者建議設定：**
- `localModel`: `"large-v3"`（預設值已適用，避免使用 `base.en`）
- `language`: `"zh"`
- `initialPrompt`: 加入常用專有名詞提升準確度

Model 檔案會在首次使用時自動從 HuggingFace 下載。

## FAQ

<details open>
  <summary><strong>Can ClaudeClaw do &lt;something&gt;?</strong></summary>
  <p>
    If Claude Code can do it, ClaudeClaw can do it too. ClaudeClaw adds cron jobs,
    heartbeats, and Telegram/Discord bridges on top. You can also give your ClaudeClaw new
    skills and teach it custom workflows.
  </p>
</details>

<details open>
  <summary><strong>Is this project breaking Anthropic ToS?</strong></summary>
  <p>
    No. ClaudeClaw is local usage inside the Claude Code ecosystem. It wraps Claude Code
    directly and does not require third-party OAuth outside that flow.
    If you build your own scripts to do the same thing, it would be the same.
  </p>
</details>

<details open>
  <summary><strong>Will Anthropic sue you for building ClaudeClaw?</strong></summary>
  <p>
    I hope not.
  </p>
</details>

<details open>
  <summary><strong>Are you ready to change this project name?</strong></summary>
  <p>
    If it bothers Anthropic, I might rename it to OpenClawd. Not sure yet.
  </p>
</details>

## Screenshots

### Claude Code Folder-Based Status Bar
![Claude Code folder-based status bar](images/bar.png)

### Cool UI to Manage and Check Your ClaudeClaw
![Cool UI to manage and check your ClaudeClaw](images/dashboard.png)

## Contributors

Thanks for helping make ClaudeClaw better.

<a href="https://github.com/moazbuilds/claudeclaw/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=moazbuilds/claudeclaw" />
</a>
