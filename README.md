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
</p>

<p align="center"><b>A lightweight, open-source OpenClaw alternative built on Claude Code.</b></p>

ClaudeClaw 把你的 Claude Code 變成一個永不停歇的個人助理。它以背景 daemon 運行，支援排程任務、Telegram / Discord / Signal / Slack / WhatsApp 訊息互動、語音辨識、多帳號輪轉，以及各種自動化整合。

> ⚠️ 請勿將 ClaudeClaw 用於任何非法活動。

---

## 目錄

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
  - [完整 settings.json 範例](#完整-settingsjson-範例)
  - [欄位說明](#欄位說明)
- [Features](#features)
  - [Multi-Token Pool](#multi-token-pool)
  - [Claude OAuth](#claude-oauth)
  - [STT 語音辨識](#stt-語音辨識)
  - [TTS 語音合成](#tts-語音合成)
  - [Session Auto-Compact](#session-auto-compact)
  - [Heartbeat](#heartbeat)
  - [Cron Scheduler](#cron-scheduler)
  - [Discord Thread Hire/Fire](#discord-thread-hirefire)
  - [Session Metrics](#session-metrics)
  - [Concurrent Processing](#concurrent-processing)
  - [Skill System](#skill-system)
  - [Graceful Shutdown](#graceful-shutdown)
  - [Structured Logging](#structured-logging)
  - [Settings Hot-Reload](#settings-hot-reload)
  - [Node Pairing — 遠端裝置配對](#node-pairing--遠端裝置配對)
- [Troubleshooting](#troubleshooting)
- [Testing](#testing)
- [Development](#development)
- [Screenshots](#screenshots)
- [Contributors](#contributors)

---

## Overview

| Category | ClaudeClaw | OpenClaw |
| --- | --- | --- |
| API Overhead | 直接使用 Claude Code 訂閱 | 需要獨立 API key |
| Setup | ~5 分鐘 | 複雜 |
| Deployment | 任意裝有 Claude Code 的裝置 | 需要完整基礎設施 |
| Isolation | 資料夾層級隔離 | 全域共享 |
| Feature Scope | 輕量精實 | 600k+ LOC |

## Getting Started

```bash
claude plugin marketplace add moazbuilds/claudeclaw
claude plugin install claudeclaw
```

在 Claude Code 中執行：

```
/claudeclaw:start
```

Setup wizard 會引導你設定 model、heartbeat、Telegram、Discord 等，完成後 daemon 即上線。

---

## Configuration

所有設定存放在 `~/.claude/claudeclaw/settings.json`。

### 完整 settings.json 範例

```jsonc
{
  // ─── 核心 ───
  "model": "sonnet",                    // 預設 Claude model
  "api": "sk-ant-xxx",                  // Anthropic API key（api-key 模式用）

  // ─── 認證 ───
  "auth": {
    "mode": "api-key",                  // "api-key" | "oauth" | "auto"
    "oauthCredentialsPath": "~/.claude/.credentials.json"
  },

  // ─── Fallback model ───
  "fallback": {
    "model": "haiku",
    "api": "sk-ant-yyy"
  },

  // ─── Token Pool（多帳號輪轉）───
  "tokenPool": [
    { "name": "rex", "model": "opus", "api": "sk-ant-xxx1", "priority": 1 },
    { "name": "alice", "model": "sonnet", "api": "sk-ant-xxx2", "priority": 2 }
  ],
  "tokenStrategy": "fallback-chain",    // "fallback-chain" | "round-robin" | "least-used"

  // ─── Multi-Provider（OpenAI / Anthropic / Google / Bedrock / Ollama 等）───
  // ─── Multi-Provider ───
  "providers": {
    "openai": { "apiKey": "sk-..." },
    "anthropic": { "apiKey": "sk-ant-..." },
    "google": { "apiKey": "AIza..." },
    "bedrock": { "region": "us-east-1", "accessKeyId": "...", "secretAccessKey": "..." },
    "ollama": { "baseUrl": "http://localhost:11434" },
    "workers-ai": { "accountId": "...", "apiToken": "..." },
    "groq": { "apiKey": "gsk_..." },
    "deepseek": { "apiKey": "sk-..." },
    "copilot": { "apiKey": "..." }
  },

  // ─── 時區 ───
  "timezone": "Asia/Taipei",
  "timezoneOffsetMinutes": 480,

  // ─── Heartbeat ───
  "heartbeat": {
    "enabled": true,
    "interval": 15,                     // 分鐘
    "prompt": "",                       // 自訂 heartbeat prompt
    "forwardToTelegram": true,          // HEARTBEAT_OK 也轉發
    "excludeWindows": [
      { "start": "23:00", "end": "08:00" },
      { "days": [0, 6], "start": "00:00", "end": "23:59" }
    ]
  },

  // ─── Telegram ───
  "telegram": {
    "token": "123456:ABC-DEF",
    "allowedUserIds": [123456789]
  },

  // ─── Discord ───
  "discord": {
    "token": "Bot xxx",
    "allowedUserIds": ["123456789012345678"],
    "listenChannels": ["987654321098765432"]
  },

  // ─── Signal ───
  "signal": {
    "enabled": false,
    "phone": "+886912345678",
    "apiUrl": "http://localhost:8080",
    "allowedNumbers": ["+886912345678"]
  },

  // ─── Slack ───
  "slack": {
    "enabled": false,
    "botToken": "xoxb-...",
    "appToken": "xapp-...",
    "signingSecret": "...",
    "allowedUsers": ["U123456"],
    "listenChannels": ["C123456"]
  },

  // ─── WhatsApp ───
  "whatsapp": {
    "enabled": false,
    "allowedNumbers": ["+886912345678"],
    "sessionPath": "~/.claude/claudeclaw/whatsapp-session"
  },

  // ─── 安全 ───
  "security": {
    "level": "moderate",                // "locked" | "strict" | "moderate" | "unrestricted"
    "allowedTools": [],
    "disallowedTools": []
  },

  // ─── Web Dashboard ───
  "web": {
    "enabled": false,
    "host": "127.0.0.1",
    "port": 4632
  },

  // ─── STT 語音辨識 ───
  "stt": {
    "baseUrl": "",                      // 有值走 API，空值走本機 whisper.cpp
    "model": "",                        // API model 名稱
    "localModel": "large-v3",           // 本機 whisper.cpp model
    "language": "zh",                   // 語言代碼
    "initialPrompt": "以下是繁體中文的語音內容。QVS QPKG QNAP..."
  },

  // ─── Workspace ───
  "workspace": {
    "path": ""                          // 共用 prompt / skills 目錄
  },

  // ─── 並行處理 ───
  "maxConcurrent": 3,                   // 最大同時處理訊息數

  // ─── MCP（Model Context Protocol）───
  "mcp": {
    "servers": {
      "mcp-sauron": {
        "command": "npx",
        "args": ["-y", "efficient-gitlab-mcp-server"],
        "env": { "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-xxx" }
      },
      "mcp-atlassian": {
        "command": "uvx",
        "args": ["mcp-atlassian"],
        "env": { "CONFLUENCE_URL": "https://confluence.example.com" }
      }
    }
  },

  // ─── Agentic Mode（實驗性）───
  "agentic": {
    "enabled": false,
    "defaultMode": "implementation",
    "modes": [
      {
        "name": "planning",
        "model": "opus",
        "keywords": ["plan", "design", "architect"],
        "phrases": ["how to implement", "what's the best way to"]
      },
      {
        "name": "implementation",
        "model": "sonnet",
        "keywords": ["implement", "code", "fix", "deploy"]
      }
    ]
  }
}
```

### 欄位說明

| 欄位 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `model` | string | `""` | 預設 Claude model（如 `sonnet`、`opus`） |
| `api` | string | `""` | Anthropic API key |
| `auth.mode` | string | `"api-key"` | 認證模式：`api-key`、`oauth`、`auto` |
| `auth.oauthCredentialsPath` | string | `"~/.claude/.credentials.json"` | OAuth credentials 路徑 |
| `fallback.model` | string | `""` | 主 model 超限時的備用 model |
| `fallback.api` | string | `""` | 備用 API key |
| `tokenPool` | array | `[]` | 多帳號 token 池，見 [Multi-Token Pool](#multi-token-pool) |
| `tokenStrategy` | string | `"fallback-chain"` | Token 選擇策略 |
| `timezone` | string | `"UTC"` | IANA 時區名稱 |
| `heartbeat.enabled` | boolean | `false` | 啟用定期 heartbeat |
| `heartbeat.interval` | number | `15` | Heartbeat 間隔（分鐘） |
| `heartbeat.prompt` | string | `""` | 自訂 heartbeat prompt |
| `heartbeat.forwardToTelegram` | boolean | `true` | HEARTBEAT_OK 是否轉發 Telegram |
| `heartbeat.excludeWindows` | array | `[]` | 靜默時段，支援跨日與星期過濾 |
| `telegram.token` | string | `""` | Telegram Bot token |
| `telegram.allowedUserIds` | number[] | `[]` | 允許的 Telegram user ID |
| `discord.token` | string | `""` | Discord Bot token |
| `discord.allowedUserIds` | string[] | `[]` | 允許的 Discord user ID（snowflake） |
| `discord.listenChannels` | string[] | `[]` | 不用 @ 即回應的頻道 ID |
| `signal.enabled` | boolean | `false` | 啟用 Signal channel |
| `signal.phone` | string | `""` | 註冊在 signal-cli 的手機號碼 |
| `signal.apiUrl` | string | `"http://localhost:8080"` | signal-cli-rest-api 的 URL |
| `signal.allowedNumbers` | string[] | `[]` | 允許的 Signal 手機號碼 |
| `slack.enabled` | boolean | `false` | 啟用 Slack channel |
| `slack.botToken` | string | `""` | Slack Bot Token |
| `slack.appToken` | string | `""` | Slack App Token |
| `slack.signingSecret` | string | `""` | Slack Signing Secret |
| `slack.allowedUsers` | string[] | `[]` | 允許的 Slack User ID |
| `slack.listenChannels` | string[] | `[]` | 監聽的 Slack Channel ID |
| `whatsapp.enabled` | boolean | `false` | 啟用 WhatsApp channel |
| `whatsapp.allowedNumbers` | string[] | `[]` | 允許的手機號碼 |
| `whatsapp.sessionPath` | string | `"~/.claude/claudeclaw/whatsapp-session"` | Session 儲存路徑 |
| `security.level` | string | `"moderate"` | 安全等級 |
| `web.enabled` | boolean | `false` | 啟用 Web Dashboard |
| `web.host` | string | `"127.0.0.1"` | Dashboard 綁定位址 |
| `web.port` | number | `4632` | Dashboard 埠號 |
| `stt.*` | object | — | 語音辨識設定，見 [STT 語音辨識](#stt-語音辨識) |
| `tts.*` | object | — | 語音合成設定，見 [TTS 語音合成](#tts-語音合成) |
| `workspace.path` | string | `""` | Workspace 目錄路徑（含 AGENTS.md、skills/） |
| `maxConcurrent` | number | `3` | 最大同時處理訊息數 |

---

## Features

### 瀏覽器原生控制

ClaudeClaw 內建瀏覽器控制，基於 `playwright-core`，不依賴 Claude Code 的 dev-browser plugin。

- **BrowserManager** singleton — 整個 ClaudeClaw 共用一個 browser instance
- 支援操作：`navigate`、`screenshot`、`snapshot`（accessibility tree）、`click`、`type`、`evaluate`
- AI 可透過 `[browser:screenshot url]`、`[browser:navigate url]` 等語法觸發
- Discord `/browser screenshot <url>` — 截圖並傳回
- Discord `/browser status` — 查看瀏覽器狀態

```json
{
  "browser": {
    "enabled": true,
    "headless": true,
    "executablePath": "/usr/bin/chromium-browser",
    "noSandbox": true,
    "extraArgs": ["--disable-gpu"]
  }
}
```

### MCP（Model Context Protocol）原生支援

ClaudeClaw 內建 MCP client，可直接連接任何 MCP server（透過 stdio transport），不依賴 Claude Code CLI。

- 在 `settings.json` 的 `mcp.servers` 中設定 server
- 啟動時自動連線所有已設定的 MCP server
- 非 Claude model（OpenAI/Google 等）可直接使用 MCP tools
- Claude CLI 模式仍使用自己的 MCP integration（不受影響）
- 使用 `/mcp` 指令查看已連線 server 及可用 tools
### Subagent 系統

讓主 agent spawn 獨立的 Claude CLI 子 agent，真正並行處理任務。

- `spawnSubagent()` — 啟動獨立子 agent
- `listSubagents()` / `killSubagent(id)` / `steerSubagent(id, msg)` — 管理介面
- Discord `/subagents` slash command
- `[spawn:label]prompt[/spawn]` 語法觸發
- IPC：result 檔案 `~/.claude/claudeclaw/subagents/{id}.result.json` + file watcher

```json
{ "subagents": { "maxConcurrent": 5, "defaultModel": "sonnet", "timeoutMs": 600000 } }
```

### ACP — Agent Communication Protocol

讓 ClaudeClaw 能 spawn 和管理外部 coding agent（Claude Code、Codex CLI、Gemini CLI、OpenCode 等）。

#### 支援的 Agent

| Agent ID | CLI 命令 | 說明 |
|----------|---------|------|
| `claude` | `claude --print --output-format text` | Claude Code CLI |
| `codex` | `codex --prompt "..."` | OpenAI Codex CLI |
| `gemini` | `gemini --prompt "..."` | Google Gemini CLI |
| `opencode` | `opencode --prompt "..."` | OpenCode CLI |

#### 使用方式

```typescript
import { spawnAgent, listAgents } from "./src/acp";

// 列出所有 agent（含可用性）
const agents = await listAgents();
// [{ id: 'claude', command: 'claude', available: true }, ...]

// 用指定 agent 執行任務
const result = await spawnAgent("codex", "幫我寫一個 bubble sort");
console.log(result.stdout);
```

#### Discord Slash Commands

- `/agents` — 列出所有可用 agent 及安裝狀態
- `/agent <id> <prompt>` — 用指定 agent 執行任務，結果回傳到 Discord

#### Settings

```json
{
  "acp": {
    "enabled": true,
    "agents": {
      "claude": { "command": "claude", "args": ["--print", "--output-format", "text"] },
      "codex": { "command": "codex", "args": [] },
      "gemini": { "command": "gemini", "args": [] },
      "opencode": { "command": "opencode", "args": [] }
    },
    "defaultAgent": "claude",
    "maxConcurrent": 3,
    "timeoutMs": 600000
  }
}
```

### Multi-Provider 支援

ClaudeClaw 支援多種 AI provider，根據 model 名稱前綴自動路由：

| Model 前綴 | Provider | 實作方式 | 範例 |
|-----------|----------|---------|------|
| `gpt-*`, `o1-*`, `o3-*`, `o4-*` | OpenAI | OpenAI-compat | `gpt-4o`, `o3-mini` |
| `claude-*`（有 apiKey） | Anthropic HTTP | Messages API | `claude-sonnet-4-20250514` |
| `claude-*`（無 apiKey） | Claude CLI | CLI fallback | `claude-sonnet-4-20250514` |
| `gemini-*` | Google Gemini | Generative AI | `gemini-2.0-flash` |
| `bedrock/*` | AWS Bedrock | Converse API + SigV4 | `bedrock/anthropic.claude-3` |
| `ollama/*` | Ollama | `/api/chat` | `ollama/llama3` |
| `cf/*`, `@cf/*` | Cloudflare Workers AI | OpenAI-compat | `cf/meta/llama-3` |
| `copilot/*` | GitHub Copilot | OpenAI-compat | `copilot/gpt-4o` |
| `groq/*` | Groq | OpenAI-compat | `groq/llama-3.3-70b` |
| `deepseek-*` | DeepSeek | OpenAI-compat | `deepseek-chat` |
| 其他 | Claude CLI | 預設 fallback | `sonnet`, `opus` |

**設定方式：** 在 `settings.json` 加入 `providers`（只需設定你要用的）：

```json
{
  "providers": {
    "openai": { "apiKey": "sk-..." },
    "google": { "apiKey": "AIza..." },
    "groq": { "apiKey": "gsk_..." }
  }
}
```

> **向後相容**：沒設 `providers` 時行為完全不變（走 Claude CLI）。
> Groq、DeepSeek、Workers AI、Copilot 共用 OpenAI-compatible HTTP client。

### Multi-Token Pool

團隊有多個 Claude 帳號時，自動輪轉與 rate limit 切換。

```json
{
  "tokenPool": [
    { "name": "rex", "model": "opus", "api": "sk-ant-xxx1", "priority": 1 },
    { "name": "alice", "model": "sonnet", "api": "sk-ant-xxx2", "priority": 2 }
  ],
  "tokenStrategy": "fallback-chain"
}
```

**策略：**

| 策略 | 說明 |
|------|------|
| `fallback-chain` | 按 `priority` 順序使用，遇 rate limit 自動切下一個（預設） |
| `round-robin` | 輪流使用 |
| `least-used` | 使用次數最少的優先 |

自動偵測 Claude 輸出中的 rate limit 訊息（"you've hit your limit" / "out of extra usage"）觸發切換。未設定 `tokenPool` 時使用原有 `api` + `fallback` 機制。

---

### Claude OAuth

使用 Claude CLI 的 OAuth token 呼叫 API，省去額外費用。

```json
{
  "auth": {
    "mode": "oauth",
    "oauthCredentialsPath": "~/.claude/.credentials.json"
  }
}
```

| mode | 行為 |
|------|------|
| `api-key` | 使用 `api` 欄位（預設） |
| `oauth` | 使用 OAuth token，無 token 則報錯 |
| `auto` | 優先 OAuth，失敗 fallback 到 API key |

前置條件：已執行 `claude login`，`~/.claude/.credentials.json` 存在。Token 快過期時自動 refresh，30 秒 cache 避免重複磁碟讀取。

> ⚠️ **風險警告：** 此功能透過非官方方式使用 Claude CLI OAuth token，可能違反 Anthropic ToS。風險由使用者自行承擔。

---

### STT 語音辨識

語音訊息自動轉文字，支援本機 whisper.cpp 或遠端 OpenAI 相容 API。

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
| `baseUrl` | STT API URL，有值走 API，空值走本機 | `""` |
| `model` | API model 名稱 | `"Systran/faster-whisper-large-v3"` |
| `localModel` | 本機 whisper.cpp model | `"large-v3"` |
| `language` | 語言代碼（`zh`、`en`、`ja`） | `""` |
| `initialPrompt` | 提示詞，提升專有名詞辨識 | `""` |

Model 檔案首次使用時自動從 HuggingFace 下載。中文建議：`localModel: "large-v3"`、`language: "zh"`。

---

### TTS 語音合成

讓 AI 可以用語音回覆。支援多個 TTS backend：

- **edge-tts**（免費）：微軟 Edge TTS，支援中文，需安裝 `pip install edge-tts`
- **openai**（付費）：OpenAI TTS API，高品質
- **local**：本地 TTS 引擎（如 piper）

```json
{
  "tts": {
    "enabled": true,
    "provider": "edge-tts",
    "voice": "zh-TW-HsiaoChenNeural",
    "speed": 1.0,
    "triggerPattern": "[voice]",
    "autoVoice": false
  }
}
```

| 設定 | 說明 |
|------|------|
| `tts.enabled` | 啟用 TTS 功能 |
| `tts.provider` | `edge-tts`、`openai`、`local` |
| `tts.voice` | 語音名稱，edge-tts 預設 `zh-TW-HsiaoChenNeural` |
| `tts.speed` | 語速（0.25-4.0） |
| `tts.triggerPattern` | AI 回覆中的觸發標記，預設 `[voice]` |
| `tts.autoVoice` | `true` 時所有回覆都附語音 |

**觸發方式：**

1. AI 回覆中包含 `[voice]` → 該段文字轉語音發送
2. 使用者輸入 `/voice 你好` → 強制語音回覆
3. `tts.autoVoice: true` → 所有回覆都附語音

Discord 以音檔附件發送，Telegram 使用 sendVoice API。

---

### Session Auto-Compact

當 session context 使用率逼近上限時，自動觸發 compact 避免 context overflow。

由 `context-monitor.ts` 持續追蹤 context 用量百分比，達到門檻時自動執行 session compact，壓縮對話歷史釋放空間。無需手動介入。

---

### Heartbeat

定期心跳檢查，讓 agent 保持活躍並主動處理待辦事項。

```json
{
  "heartbeat": {
    "enabled": true,
    "interval": 15,
    "prompt": "",
    "forwardToTelegram": true,
    "excludeWindows": [
      { "start": "23:00", "end": "08:00" }
    ]
  }
}
```

每次 heartbeat 自動注入狀態資訊：使用的 model、session turn count、上次 heartbeat 時間、context 用量百分比。`excludeWindows` 支援跨日時段與 `days` 星期過濾。非 OK 訊息一律轉發至 Telegram/Discord。

---

### Signal 設定

Signal channel 使用 [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) 作為 backend。

#### 1. 啟動 signal-cli-rest-api

```bash
# Docker 方式（推薦）
docker run -d --name signal-api \
  -p 8080:8080 \
  -v ~/.local/share/signal-cli:/home/.local/share/signal-cli \
  bbernhard/signal-cli-rest-api

# 或用 native signal-cli + JSON-RPC
# signal-cli -a +886912345678 jsonRpc --socket 8080
```

#### 2. 註冊/連結手機號碼

```bash
# 註冊新號碼
curl -X POST 'http://localhost:8080/v1/register/+886912345678'

# 或連結到現有 Signal 帳號（掃 QR code）
curl -X GET 'http://localhost:8080/v1/qrcodelink?device_name=claudeclaw' --output qr.png
```

#### 3. 設定 claudeclaw

```json
{
  "signal": {
    "enabled": true,
    "phone": "+886912345678",
    "apiUrl": "http://localhost:8080",
    "allowedNumbers": ["+886900000001"]
  }
}
```

啟動 daemon 後，Signal 會自動開始 polling 接收訊息。支援文字、圖片、語音（自動 Whisper 轉文字）。

### Slack 設定

使用 [Slack Bolt SDK](https://slack.dev/bolt-js/) Socket Mode。設定 `slack.enabled: true` 及 Token 後即可使用。
支援：文字、圖片、語音（Whisper）、Thread Reply、Reaction。

### WhatsApp 設定

使用 [Baileys](https://github.com/WhiskeySockets/Baileys)。首次啟動顯示 QR Code，掃描連結手機。
支援：文字、圖片、語音（Whisper）、文件、Reaction。

### Memory Semantic Search

用本機 embedding 模型（Ollama）或 TF-IDF fallback 建立 memory 語義搜尋，超越 claude-mem plugin 的簡單關鍵字比對。

**設定範例：**
```json
{
  "memory": {
    "enabled": true,
    "dirs": ["~/.claude/claudeclaw/workspace"],
    "embeddingProvider": "ollama",
    "embeddingModel": "nomic-embed-text",
    "ollamaUrl": "http://localhost:11434",
    "autoIndex": true,
    "indexIntervalMs": 3600000
  }
}
```

**Slash Commands（Discord / Telegram）：**

| 命令 | 說明 |
|------|------|
| `/memory search <查詢>` | 語義搜尋 memory，回傳最相關的 chunks |
| `/memory reindex` | 重建全部索引 |
| `/memory status` | 顯示索引狀態（chunk 數、最後索引時間、provider）|

**Embedding Backend：**
- **Ollama**（優先）：使用 `nomic-embed-text` 模型產生高品質向量，需本機執行 Ollama
- **TF-IDF**（fallback）：Ollama 不可用時自動切換，零依賴，即開即用

**自動 Context 注入：** 每次 AI 回答前，自動用使用者問題做 memory search，將相關 chunks 注入 `<memory-context>` block（可透過 `getMemoryContext()` API 呼叫）。

---

### Cron Scheduler

通用 cron 排程系統，支援 cron expression 定時執行 prompt，獨立於 heartbeat 運作。

```json
{
  "cron": [
    {
      "name": "morning-report",
      "cron": "0 9 * * 1-5",
      "prompt": "查看今天的 JIRA 待辦事項，列出優先級最高的 5 個",
      "model": "sonnet",
      "target": "telegram"
    },
    {
      "name": "weekly-metrics",
      "cron": "0 18 * * 5",
      "prompt": "產出本週 ClaudeClaw 使用指標報告",
      "target": "discord"
    }
  ]
}
```

**欄位說明：**

| 欄位 | 必填 | 說明 |
|------|------|------|
| `name` | ✅ | Job 名稱（唯一識別） |
| `cron` | ✅ | 標準 cron expression（分 時 日 月 週） |
| `prompt` | ✅ | 執行時送給 Claude 的 prompt |
| `model` | ❌ | 覆寫此 job 使用的 model |
| `target` | ❌ | 結果送往 `"telegram"` / `"discord"` / `"both"`（預設 `"both"`） |
| `enabled` | ❌ | 是否啟用（預設 `true`） |

**Discord `/cron` 指令：**
- `/cron` — 列出所有 cron jobs 及下次執行時間
- `/cron action:enable job:morning-report` — 啟用指定 job
- `/cron action:disable job:morning-report` — 停用指定 job

Settings 支援 hot-reload，修改 `settings.json` 中的 `cron` 欄位會自動重新載入。

---

### Discord Thread Hire/Fire

在 Discord thread 中獨立管理 Claude session，支援 hire（啟用）和 fire（停用）指令。

- **獨立 Session：** 每個 thread 有自己的 Claude CLI session，與主頻道完全隔離
- **Hire/Fire：** 透過 intent classifier 解析指令，動態控制 thread session
- **Auto-Create：** 新 thread 首次訊息自動建立 session
- **Session Cleanup：** Thread 刪除或歸檔時自動清理

詳見 [docs/MULTI_SESSION.md](docs/MULTI_SESSION.md)。

---

### Session Metrics

每次 session 執行自動記錄到 `~/.claude/claudeclaw/metrics.jsonl`。

記錄欄位：timestamp、source、model、duration、exit code。在 Discord 使用 `/metrics` 指令可查看 7 天摘要。

---

### Concurrent Processing

跨 thread/channel 的訊息並行處理，同一 thread 內仍按順序。

```json
{
  "maxConcurrent": 3
}
```

由 `queue-manager.ts` 管理。調高可加速多 thread 回應，但會增加 API 並行負載。

---

### Web Dashboard API

Dashboard 提供即時監控頁面與 RESTful API：

- **`/dashboard`** — 即時監控儀表板（自動每 10 秒刷新）
- **`GET /api/status`** — 服務狀態（uptime、PID、model、session count）
- **`GET /api/sessions`** — 當前 session 列表
- **`GET /api/metrics?days=7`** — Metrics 摘要（token 用量、成功率）
- **`GET /api/queue`** — Queue 狀態（running/queued 數量）

---

### Skill System

載入 workspace 目錄下的 skills，擴展 agent 能力。支援 metadata、keyword 匹配、優先級排序。

```json
{
  "workspace": {
    "path": "/path/to/workspace"
  }
}
```

Workspace 遵循 OpenClaw 慣例：根目錄放 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`KNOWLEDGE.md`，`skills/` 目錄放各 skill 的 `SKILL.md`。啟動時自動載入並注入 prompt。

#### Skill 格式

每個 skill 放在 `skills/<name>/SKILL.md`，使用 YAML frontmatter：

```markdown
---
name: my-skill
description: 什麼時候觸發這個 skill
keywords:
  - keyword1
  - keyword2
examples:
  - "example trigger phrase"
priority: 100
---

# Skill Title

Instructions here.
```

- **keywords**：用於智慧匹配，不只靠 command name
- **examples**：觸發範例，提高匹配準確度
- **priority**：數字越小優先級越高（預設 100）

參考 `skills/TEMPLATE.md` 了解完整格式。

#### `/skills` 指令

在 Telegram 或 Discord 輸入 `/skills`，列出所有可用 skills 及其描述、觸發關鍵字。

---

### Graceful Shutdown

收到 SIGINT / SIGTERM 時，等待所有執行中的子程序完成後再退出。

由 `process-manager.ts` 追蹤所有 child process，shutdown 時逐一發送終止訊號並等待退出，避免中斷正在進行的 Claude session。

---

### Structured Logging

統一結構化日誌，同時輸出人類可讀格式與機器可解析的 NDJSON。

輸出目標：
1. **stdout** — 帶時間戳與來源標籤（方便 `journalctl`）
2. **`/tmp/claudeclaw-structured.log`** — 每行一個 JSON 物件

```json
{
  "timestamp": "2026-03-31T13:51:00.000Z",
  "level": "info",
  "source": "discord",
  "message": "Session created: abc123",
  "meta": { "session_id": "abc123", "user": "rex" }
}
```

```bash
# 所有 error
cat /tmp/claudeclaw-structured.log | jq 'select(.level == "error")'

# 只看 Discord 來源
cat /tmp/claudeclaw-structured.log | jq 'select(.source == "discord")'

# 統計各 level 數量
cat /tmp/claudeclaw-structured.log | jq -s 'group_by(.level) | map({level: .[0].level, count: length})'
```

程式碼使用：

```typescript
import { createLogger } from "./logger";
const logger = createLogger("discord");
logger.info("Bot started");
logger.error("Connection failed", { error: "timeout", retry: 3 });
```

---

### Settings Hot-Reload

修改 `settings.json` 後自動偵測並套用，不需重啟。

由 `settings-watcher.ts` 透過 `fs.watch()` 監聽，500ms debounce 防止頻繁觸發。支援 heartbeat、STT、token pool 等設定的即時更新。

---

## Node Pairing — 遠端裝置配對

讓 ClaudeClaw 能透過 WebSocket 配對並控制遠端裝置（手機、電腦）。

### 啟用設定

```json
{
  "nodes": {
    "enabled": true,
    "approvedDevices": [],
    "port": 4632,
    "pairingTimeout": 300
  }
}
```

### 配對流程

1. 在 Discord 輸入 `/pair`，ClaudeClaw 會產生一組 **6 位數配對碼**
2. 在目標裝置（手機/電腦）執行 node-client：
   ```bash
   bun run scripts/node-client.ts \
     --host 192.168.1.100 \
     --port 4632 \
     --code 123456 \
     --name "Rex 的 iPhone"
   ```
3. 配對成功後，裝置 ID 會顯示在終端機。日後重新連線使用 `--device-id <id>` 即可跳過配對碼。

### Discord Slash Commands

| 指令 | 說明 |
|------|------|
| `/pair` | 產生配對碼 |
| `/nodes` | 列出已配對裝置（🟢 = 線上，⚫ = 離線） |
| `/node <device> screenshot` | 遠端截圖 |
| `/node <device> clipboard` | 讀取遠端剪貼簿 |
| `/node <device> notify [訊息]` | 發送系統通知 |

### WebSocket 協定

所有訊息使用 **JSON-RPC 2.0** 格式，endpoint 為 `/ws/node`（與 web dashboard 共用 port 4632）。

**配對請求（裝置 → ClaudeClaw）：**
```json
{ "jsonrpc": "2.0", "id": "pair-1", "method": "pair",
  "params": { "code": "123456", "name": "My Phone", "platform": "ios", "deviceId": "<uuid>" } }
```

**支援的遠端指令（ClaudeClaw → 裝置）：**
- `notify` — 推送系統通知
- `screenshot` — 截圖（回傳 base64 PNG）
- `clipboard` — 讀取剪貼簿
- `exec` — 執行命令（裝置端需使用者本機確認）
- `heartbeat` — 保持連線活躍

### Node Client

`scripts/node-client.ts` 是輕量級客戶端，可在任何支援 Bun 的裝置上執行：

```bash
# 首次配對
bun run scripts/node-client.ts --host <IP> --code 123456 --name "My Device"

# 重新連線（已配對）
bun run scripts/node-client.ts --host <IP> --device-id <your-device-id>
```

斷線後自動重試，heartbeat 每 30 秒發送一次。

---

## Troubleshooting

| 問題 | 解法 |
|------|------|
| Daemon 啟動失敗 | 確認 Claude Code 已安裝且可執行 `claude` 指令 |
| Telegram/Discord 無回應 | 檢查 `settings.json` 中的 token 與 allowedUserIds |
| 語音辨識失敗 | 確認 whisper.cpp 已安裝，或 `stt.baseUrl` 指向有效的 API |
| OAuth token 過期 | 執行 `claude login` 重新登入 |
| Token Pool 全部 rate limited | 等待冷卻或新增帳號至 `tokenPool` |
| Settings 修改後沒生效 | 確認 JSON 語法正確（`jq . settings.json`），watcher 會忽略格式錯誤的檔案 |
| Context overflow | Session auto-compact 應自動處理；若持續發生可縮短 heartbeat interval |

---

## Testing

```bash
bun test
```

| 模組 | 測試檔案 | 涵蓋內容 |
|------|---------|---------|
| `runner.ts` | `tests/runner.test.ts` | buildChildEnv、rate limit 偵測、security args、serial queue、timeout |
| `config.ts` | `tests/config.test.ts` | resolvePrompt、parseSettings、Discord snowflake、exclude windows |
| `sessions.ts` | `tests/sessions.test.ts` | session CRUD、turnCount、compactWarned |
| `token-pool.ts` | `tests/token-pool.test.ts` | 三種策略、rate limit 偵測 |
| `intent-classifier.ts` | `tests/intent-classifier.test.ts` | hire/fire 指令解析、群組展開 |
| `oauth-provider.ts` | `tests/oauth-provider.test.ts` | credentials 讀取、token 過期判斷 |
| `context-monitor.ts` | `tests/context-monitor.test.ts` | context usage 計算、auto-compact 門檻 |
| `logger.ts` | `tests/logger.test.ts` | 結構化 JSON log、level filtering |
| `process-manager.ts` | `tests/process-manager.test.ts` | 子程序管理、graceful shutdown |
| `settings-watcher.ts` | `tests/settings-watcher.test.ts` | 設定變更監聽、debounce |
| `whisper.ts` | `tests/whisper.test.ts` | STT model URL/path、config 讀取 |

所有測試使用 mock/spy，不會呼叫實際 Claude CLI。

---

## Development

```bash
# 開發模式（hot reload）
bun run dev:web

# 執行測試
bun test

# 專案結構
src/
├── index.ts              # 入口
├── config.ts             # 設定解析
├── runner.ts             # Claude CLI 執行器
├── sessions.ts           # Session 管理
├── sessionManager.ts     # Multi-session 管理
├── token-pool.ts         # Token Pool 輪轉
├── oauth-provider.ts     # OAuth 認證
├── whisper.ts            # STT 語音辨識
├── tts.ts                # TTS 語音合成
├── context-monitor.ts    # Context 用量監控
├── intent-classifier.ts  # Hire/Fire 指令解析
├── metrics.ts            # Session Metrics
├── queue-manager.ts      # 並行佇列管理
├── skills.ts             # Skill System
├── process-manager.ts    # Graceful Shutdown
├── logger.ts             # Structured Logging
├── settings-watcher.ts   # Settings Hot-Reload
├── progress-reporter.ts  # 進度回報
├── cron.ts               # Cron 排程
├── web.ts                # Web Dashboard
└── ui/                   # Dashboard UI
```

---

## Screenshots

### Claude Code Status Bar
![Claude Code folder-based status bar](images/bar.png)

### Web Dashboard
![Cool UI to manage and check your ClaudeClaw](images/dashboard.png)

---

## FAQ

<details>
  <summary><strong>ClaudeClaw 能做什麼？</strong></summary>
  <p>Claude Code 能做的，ClaudeClaw 都能做。額外支援 cron、heartbeat、Telegram/Discord 橋接、語音辨識、多帳號輪轉等。</p>
</details>

<details>
  <summary><strong>這個專案違反 Anthropic ToS 嗎？</strong></summary>
  <p>ClaudeClaw 是本機使用 Claude Code 的包裝層，不涉及第三方 OAuth。OAuth 模式除外（見警告）。</p>
</details>

---

## Contributors

<a href="https://github.com/moazbuilds/claudeclaw/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=moazbuilds/claudeclaw" />
</a>
