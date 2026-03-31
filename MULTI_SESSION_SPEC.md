# ClaudeClaw Multi-Session Thread Support — Feature Spec

> 最後更新：2026-04-01｜對照實作狀態標記 ✅ 已完成 / ⏳ 未實作

---

## 架構總覽（ASCII Diagram）

```
Discord Guild
│
├── #listen-channel  (global session — session.json)
│   ├── user msg → QueueManager.enqueue(channelId) → execClaude(threadId=undefined)
│   │                                                    └─ --resume <global sessionId>
│   │
│   ├── "hire 張飛 關羽" → intent-classifier → create threads
│   │       ├── 🧵 張飛  (threadId=T1, sessions.json[T1])
│   │       └── 🧵 關羽  (threadId=T2, sessions.json[T2])
│   │
│   └── "fire 張飛" → remove thread session + archive thread
│
├── 🧵 Thread T1  (independent session)
│   └── user msg → QueueManager.enqueue(T1) → execClaude(threadId=T1)
│                                                 └─ --resume <T1 sessionId>
│
└── 🧵 Thread T2  (independent session, parallel with T1)
    └── user msg → QueueManager.enqueue(T2) → execClaude(threadId=T2)
                                                  └─ --resume <T2 sessionId>

Storage:
  .claude/claudeclaw/session.json    ← global session (GlobalSession)
  .claude/claudeclaw/sessions.json   ← thread sessions map (Record<threadId, ThreadSession>)

Concurrency:
  QueueManager (singleton, default maxConcurrent=3)
  ├── 同一 thread/channel 內：FIFO 序列
  └── 不同 thread 間：並行（受 maxConcurrent 限制）
  └── Round-robin fairness via pendingThreads queue
```

---

## 目標

Discord thread binding + 獨立 Claude CLI session per thread，實現平行對話。

---

## 實作狀態

### 1. Session 管理

| 功能 | 狀態 | 檔案 | 說明 |
|------|------|------|------|
| Global session (session.json) | ✅ | `src/sessions.ts` | `getSession` / `createSession` / `resetSession` / `backupSession` |
| Thread session map (sessions.json) | ✅ | `src/sessionManager.ts` | `getThreadSession` / `createThreadSession` / `removeThreadSession` / `listThreadSessions` |
| Turn counter (global) | ✅ | `src/sessions.ts` | `incrementTurn()` — 每次 Claude 回覆後 +1 |
| Turn counter (per-thread) | ✅ | `src/sessionManager.ts` | `incrementThreadTurn()` |
| Compact warning flag | ✅ | 兩處皆有 | `markCompactWarned` / `markThreadCompactWarned` |
| Session peek (read-only) | ✅ | 兩處皆有 | `peekSession` / `peekThreadSession` — 不更新 lastUsedAt |
| In-memory cache | ✅ | 兩處皆有 | 避免重複 disk I/O |
| Session TTL / 自動過期清理 | ⏳ | — | 目前無自動清理過期 thread session 的機制 |
| Max session 上限 | ⏳ | — | 信任 Claude CLI rate limiting，無硬上限 |

### 2. Queue / 並行處理

| 功能 | 狀態 | 檔案 | 說明 |
|------|------|------|------|
| Per-thread FIFO queue | ✅ | `src/queue-manager.ts` | 同 thread 內序列，跨 thread 並行 |
| Global maxConcurrent 限制 | ✅ | `src/queue-manager.ts` | 預設 3，可 runtime 調整 `setMaxConcurrent()` |
| Round-robin fairness | ✅ | `src/queue-manager.ts` | `pendingThreads` 陣列確保公平排程 |
| Running / queued count | ✅ | `src/queue-manager.ts` | `runningCount` / `queuedCount` getter |
| Legacy serial queue (runner.ts) | ✅ | `src/runner.ts` | `threadQueues` Map — runner 層的序列化保護 |

### 3. Discord 整合

| 功能 | 狀態 | 檔案 | 說明 |
|------|------|------|------|
| Thread 訊息偵測 & 路由 | ✅ | `src/commands/discord.ts` | `knownThreads` Map 追蹤 thread → parent 關係 |
| Thread 自動建立（hire） | ✅ | `src/commands/discord.ts` + `src/intent-classifier.ts` | AI intent classification + regex 快速路徑 |
| Thread 關閉（fire） | ✅ | `src/commands/discord.ts` | 移除 session + archive thread |
| Listen channel thread 支援 | ✅ | `src/commands/discord.ts` | `shouldRespond()` 判斷 `listen_channel_thread` |
| Thread rejoin on restart | ✅ | `src/commands/discord.ts` | `rejoinThreads()` — 定時重新加入 + unarchive |
| Thread 從 sessions.json 恢復 | ✅ | `src/commands/discord.ts` | `knownThreads` 不在時 fallback 到 `peekThreadSession` |
| Session 首次建立時機 | ✅ | `src/runner.ts` | 第一則訊息時 Claude CLI 自動建立，解析 JSON output 取 session_id |
| `/status` 顯示 thread sessions | ✅ | `src/commands/discord.ts` | 列出所有 active thread session 數量 |
| `/reset` thread session | ⏳ | — | 目前 `/reset` 只重設 global session |
| `/compact` thread session | ⏳ | — | 目前 `/compact` 只對 global session 操作 |

### 4. Intent Classifier（Thread 管理語意辨識）

| 功能 | 狀態 | 檔案 | 說明 |
|------|------|------|------|
| Regex 快速分類 | ✅ | `src/intent-classifier.ts` | hire / fire 指令的 pattern matching |
| AI fallback 分類 | ✅ | `src/intent-classifier.ts` | regex 失敗時 fallback 到 Claude CLI |
| 群組展開（桃園三結義、五虎將） | ✅ | `src/intent-classifier.ts` | `GROUP_EXPANSIONS` 支援批次建立 |

### 5. Runner（Claude CLI 呼叫）

| 功能 | 狀態 | 檔案 | 說明 |
|------|------|------|------|
| `execClaude` 接受 `threadId` | ✅ | `src/runner.ts` | threadId → thread session；無 threadId → global session |
| 新 session：JSON output 解析 session_id | ✅ | `src/runner.ts` | 首次呼叫用 `--output-format json` |
| Resume session：`--resume <sessionId>` | ✅ | `src/runner.ts` | 後續呼叫自動帶 `--resume` |
| `--append-system-prompt` 每次都傳 | ✅ | `src/runner.ts` | 因為 system prompt 不會跨 `--resume` 保留 |
| Auto-compact on high turn count | ✅ | `src/runner.ts` | 到達門檻時自動 compact + 警告 |
| Run result 包含 thread_id | ✅ | `src/runner.ts` | `RunResult.thread_id` 欄位 |

### 6. 文件

| 功能 | 狀態 | 說明 |
|------|------|------|
| README 更新 | ⏳ | 尚未反映 multi-session 架構 |
| `docs/MULTI_SESSION.md` 詳細技術文件 | ⏳ | 尚未建立 |

---

## 關鍵設計決策

| 決策 | 說明 |
|------|------|
| **向後相容** | 無 threadId = 使用 global session，既有行為完全不變 |
| **Lazy session 建立** | Thread 建立時不預先建 session，第一則訊息才觸發 Claude CLI 建立 |
| **雙層序列化** | runner.ts `threadQueues` + `QueueManager` 確保同 thread 不會並行 `--resume` |
| **JSON 儲存** | 沿用既有 session.json 模式，thread sessions 存 sessions.json |
| **Round-robin 公平** | `QueueManager.pendingThreads` 確保高流量 thread 不會餓死其他 thread |
| **Rejoin 機制** | 重啟後自動重新加入所有已知 thread，避免漏訊息 |

---

## 待實作項目（Gap Analysis）

| 項目 | 優先級 | 說明 |
|------|--------|------|
| `/reset` 支援 thread session | 中 | 在 thread 內執行 `/reset` 應只重設該 thread 的 session |
| `/compact` 支援 thread session | 中 | 在 thread 內執行 `/compact` 應只 compact 該 thread |
| Session TTL 自動過期 | 低 | 超過 N 天未使用的 thread session 自動清理 |
| Max session 上限 | 低 | 防止無限建立 thread session |
| README 文件更新 | 中 | 反映 multi-session 架構和使用方式 |
| 詳細技術文件 | 低 | `docs/MULTI_SESSION.md` — migration notes、lifecycle、concurrency model |
