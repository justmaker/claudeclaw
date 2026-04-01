#!/usr/bin/env bun
/**
 * node-client.ts — ClaudeClaw Node Client
 *
 * 在目標裝置上執行此 script，連線到 ClaudeClaw 的 /ws/node WebSocket endpoint，
 * 完成配對並持續監聽遠端指令。
 *
 * 使用方式：
 *   bun run scripts/node-client.ts --host 192.168.1.100 --port 4632 --code 123456
 *
 * 支援的遠端指令（JSON-RPC 2.0 method）：
 *   notify    — 顯示系統通知
 *   screenshot — 截圖並回傳 base64 PNG
 *   clipboard  — 讀取系統剪貼簿
 *   exec       — 執行 shell 命令（需要本機確認）
 *   heartbeat  — 保持連線活躍
 */

import { parseArgs } from "util";

// ── 參數解析 ──────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4632" },
    code: { type: "string" },
    name: { type: "string", default: `${process.platform}-${process.env.USER ?? "device"}` },
    platform: { type: "string", default: process.platform },
    "device-id": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`
ClaudeClaw Node Client

用法：
  bun run scripts/node-client.ts [options]

選項：
  --host        ClaudeClaw 主機 IP（預設: 127.0.0.1）
  --port        WebSocket port（預設: 4632）
  --code        配對碼（6 位數字）
  --name        此裝置顯示名稱
  --platform    平台名稱（預設: 系統自動偵測）
  --device-id   裝置 ID（重新連線時使用已配對的 ID）
  -h, --help    顯示此說明
`);
  process.exit(0);
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function rpcOk(id: string | number | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function rpcErr(id: string | number | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── 平台指令 ─────────────────────────────────────────────────────────────────

async function takeScreenshot(): Promise<string> {
  const os = process.platform;
  let cmd: string;
  const tmpFile = `/tmp/cc-screenshot-${Date.now()}.png`;

  if (os === "darwin") {
    cmd = `screencapture -x ${tmpFile}`;
  } else if (os === "linux") {
    // 嘗試 scrot，再試 gnome-screenshot
    cmd = `scrot ${tmpFile} 2>/dev/null || gnome-screenshot -f ${tmpFile}`;
  } else if (os === "win32") {
    cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${tmpFile}') }"`;
  } else {
    throw new Error(`不支援的平台: ${os}`);
  }

  const proc = Bun.spawn(["sh", "-c", cmd]);
  await proc.exited;
  const file = Bun.file(tmpFile);
  const buf = await file.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  // 清理暫存檔
  await Bun.spawn(["rm", "-f", tmpFile]).exited;
  return b64;
}

async function readClipboard(): Promise<string> {
  const os = process.platform;
  let cmd: string;

  if (os === "darwin") cmd = "pbpaste";
  else if (os === "linux") cmd = "xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null";
  else if (os === "win32") cmd = "powershell -Command Get-Clipboard";
  else throw new Error(`不支援的平台: ${os}`);

  const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe" });
  await proc.exited;
  const text = await new Response(proc.stdout).text();
  return text.trim();
}

async function showNotify(title: string, body: string): Promise<void> {
  const os = process.platform;
  let cmd: string;

  if (os === "darwin") {
    cmd = `osascript -e 'display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`;
  } else if (os === "linux") {
    cmd = `notify-send "${title.replace(/"/g, '\\"')}" "${body.replace(/"/g, '\\"')}"`;
  } else if (os === "win32") {
    cmd = `powershell -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('${body}','${title}')"`;
  } else {
    console.log(`[Notify] ${title}: ${body}`);
    return;
  }

  await Bun.spawn(["sh", "-c", cmd]).exited;
}

async function runExec(command: string): Promise<string> {
  // 本機確認
  process.stdout.write(`\n⚠️  ClaudeClaw 要求執行命令：\n  ${command}\n執行嗎？ [y/N] `);
  // 讀取一行輸入
  let answer = "";
  for await (const chunk of Bun.stdin.stream()) {
    answer = new TextDecoder().decode(chunk).trim().toLowerCase();
    break;
  }
  if (answer !== "y" && answer !== "yes") {
    throw new Error("使用者拒絕執行命令");
  }

  const proc = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return stdout + (stderr ? `\n[stderr] ${stderr}` : "");
}

// ── 主程式 ───────────────────────────────────────────────────────────────────

const host = values.host!;
const port = parseInt(values.port!, 10);
const wsUrl = `ws://${host}:${port}/ws/node`;
const deviceName = values.name!;
const platform = values.platform!;
const existingDeviceId = values["device-id"];
const pairingCode = values.code;

if (!pairingCode && !existingDeviceId) {
  console.error("❌ 請提供 --code <配對碼> 或 --device-id <已配對的裝置ID>");
  process.exit(1);
}

console.log(`🔌 連線到 ${wsUrl}...`);

let ws: WebSocket;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let deviceId: string | null = existingDeviceId ?? null;

function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("✅ 已連線到 ClaudeClaw");

    if (deviceId) {
      // 重新連線：auth
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        id: "auth-1",
        method: "auth",
        params: { deviceId },
      }));
    } else {
      // 首次配對
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        id: "pair-1",
        method: "pair",
        params: {
          code: pairingCode,
          name: deviceName,
          platform,
          deviceId: crypto.randomUUID(),
        },
      }));
    }

    // 啟動 heartbeat（每 30 秒）
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: null, method: "heartbeat", params: {} }));
      }
    }, 30_000);
  };

  ws.onmessage = async (event) => {
    let msg: any;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      console.error("[NodeClient] 無法解析訊息:", event.data);
      return;
    }

    // 處理配對/驗證回應
    if (msg.id === "pair-1" || msg.id === "auth-1") {
      if (msg.error) {
        console.error(`❌ ${msg.id === "pair-1" ? "配對" : "驗證"}失敗: ${msg.error.message}`);
        process.exit(1);
      }
      if (msg.id === "pair-1" && msg.result?.deviceId) {
        deviceId = msg.result.deviceId;
        console.log(`🎉 配對成功！裝置 ID: ${deviceId}`);
        console.log(`💡 下次連線可使用：--device-id ${deviceId}`);
      } else {
        console.log(`✅ 驗證成功，裝置 ${deviceId}`);
      }
      return;
    }

    // 處理遠端指令（JSON-RPC request）
    if (msg.method) {
      const { id, method, params } = msg;
      try {
        let result: unknown;

        switch (method) {
          case "notify":
            await showNotify(String((params as any)?.title ?? "ClaudeClaw"), String((params as any)?.body ?? ""));
            result = { ok: true };
            break;
          case "screenshot":
            console.log("[NodeClient] 截圖中...");
            result = await takeScreenshot();
            break;
          case "clipboard":
            result = await readClipboard();
            break;
          case "exec":
            result = { output: await runExec(String((params as any)?.command ?? "")) };
            break;
          case "heartbeat":
            result = { pong: true };
            break;
          default:
            ws.send(rpcErr(id, -32601, `未知方法: ${method}`));
            return;
        }

        ws.send(rpcOk(id, result));
      } catch (err: any) {
        ws.send(rpcErr(id, -32000, err.message ?? String(err)));
      }
    }
  };

  ws.onerror = (err) => {
    console.error("[NodeClient] WebSocket 錯誤:", err);
  };

  ws.onclose = (event) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    console.log(`[NodeClient] 連線中斷 (code: ${event.code})，5 秒後重試...`);
    reconnectTimer = setTimeout(connect, 5_000);
  };
}

connect();

// 優雅退出
process.on("SIGINT", () => {
  console.log("\n[NodeClient] 關閉中...");
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close(1000, "Client shutdown");
  process.exit(0);
});
