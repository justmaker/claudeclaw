/**
 * NodeHost — 管理已配對的遠端裝置，透過 WebSocket (JSON-RPC 2.0) 溝通。
 *
 * 配對流程：
 *   1. ClaudeClaw 呼叫 NodeHost.generatePairingCode() 取得 6 位數配對碼
 *   2. 使用者在目標裝置執行 node-client，輸入配對碼
 *   3. 裝置透過 /ws/node 連入，傳送 pair 請求
 *   4. NodeHost 驗證配對碼後，將裝置登錄為已配對
 */

import type { ServerWebSocket } from "bun";

// ── 型別 ──────────────────────────────────────────────────────────────────────

export interface PairedDevice {
  id: string;          // 裝置唯一 ID（UUID）
  name: string;        // 顯示名稱
  platform: string;    // "android" | "ios" | "macos" | "linux" | "windows"
  pairedAt: string;    // ISO 8601
  lastSeenAt: string;  // ISO 8601
}

export interface PendingPairing {
  code: string;        // 6 位數字字串
  expiresAt: number;   // Date.now() + timeout
}

// JSON-RPC 2.0
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface NodeWsData {
  deviceId: string | null;  // null 表示尚未配對/驗證
}

// ── NodeHost ──────────────────────────────────────────────────────────────────

export class NodeHost {
  private devices = new Map<string, PairedDevice>();
  private pending: PendingPairing | null = null;
  private connections = new Map<string, ServerWebSocket<NodeWsData>>();
  private pairingTimeout: number;

  constructor(pairingTimeoutSeconds = 300) {
    this.pairingTimeout = pairingTimeoutSeconds * 1000;
  }

  // ── 配對碼 ──────────────────────────────────────────────────────────────────

  /** 生成一組 6 位數配對碼，有效期為 pairingTimeout 秒 */
  generatePairingCode(): string {
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    this.pending = {
      code,
      expiresAt: Date.now() + this.pairingTimeout,
    };
    console.log(`[NodeHost] 配對碼已產生: ${code}，有效期 ${this.pairingTimeout / 1000}s`);
    return code;
  }

  /** 驗證配對碼是否有效（未過期） */
  validatePairingCode(code: string): boolean {
    if (!this.pending) return false;
    if (Date.now() > this.pending.expiresAt) {
      this.pending = null;
      return false;
    }
    return this.pending.code === code;
  }

  /** 清除當前配對碼 */
  clearPairingCode(): void {
    this.pending = null;
  }

  /** 取得目前的配對碼（若存在且未過期） */
  getPendingCode(): PendingPairing | null {
    if (!this.pending) return null;
    if (Date.now() > this.pending.expiresAt) {
      this.pending = null;
      return null;
    }
    return this.pending;
  }

  // ── 裝置 Registry ────────────────────────────────────────────────────────────

  /** 新增或更新已配對的裝置 */
  registerDevice(device: PairedDevice): void {
    this.devices.set(device.id, device);
    console.log(`[NodeHost] 裝置已配對: ${device.name} (${device.id})`);
  }

  /** 取得所有已配對裝置 */
  listDevices(): PairedDevice[] {
    return Array.from(this.devices.values());
  }

  /** 取得特定裝置 */
  getDevice(deviceId: string): PairedDevice | undefined {
    return this.devices.get(deviceId);
  }

  /** 移除裝置配對 */
  unpairDevice(deviceId: string): boolean {
    const removed = this.devices.delete(deviceId);
    if (removed) {
      this.connections.get(deviceId)?.close(1000, "Unpaired");
      this.connections.delete(deviceId);
    }
    return removed;
  }

  // ── 連線管理 ──────────────────────────────────────────────────────────────────

  /** 登錄 WebSocket 連線（配對完成後呼叫） */
  setConnection(deviceId: string, ws: ServerWebSocket<NodeWsData>): void {
    this.connections.set(deviceId, ws);
    const dev = this.devices.get(deviceId);
    if (dev) {
      dev.lastSeenAt = new Date().toISOString();
    }
  }

  /** 移除 WebSocket 連線（斷線時呼叫） */
  removeConnection(deviceId: string): void {
    this.connections.delete(deviceId);
    console.log(`[NodeHost] 裝置斷線: ${deviceId}`);
  }

  /** 取得裝置是否線上 */
  isOnline(deviceId: string): boolean {
    return this.connections.has(deviceId);
  }

  // ── 遠端指令 ──────────────────────────────────────────────────────────────────

  /**
   * 發送 JSON-RPC 請求到裝置，等待回應（超時 30s）
   */
  private async rpc(deviceId: string, method: string, params?: unknown): Promise<unknown> {
    const ws = this.connections.get(deviceId);
    if (!ws) throw new Error(`裝置 ${deviceId} 未連線`);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("RPC 逾時")), 30_000);
      // 回應由 handleMessage 觸發，透過 pendingRpcs 解析
      this.pendingRpcs.set(id as string, { resolve, reject, timeout });
      ws.send(JSON.stringify(req));
    });
  }

  private pendingRpcs = new Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  /** 處理裝置回傳的 JSON-RPC response */
  handleRpcResponse(response: JsonRpcResponse): void {
    const id = response.id as string;
    const pending = this.pendingRpcs.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRpcs.delete(id);
    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  /** 推送通知到裝置 */
  async notify(deviceId: string, title: string, body: string): Promise<void> {
    await this.rpc(deviceId, "notify", { title, body });
  }

  /** 遠端截圖，回傳 base64 PNG */
  async screenshot(deviceId: string): Promise<string> {
    const result = await this.rpc(deviceId, "screenshot", {});
    if (typeof result !== "string") throw new Error("截圖回傳格式錯誤");
    return result;
  }

  /** 讀取裝置剪貼簿 */
  async clipboard(deviceId: string): Promise<string> {
    const result = await this.rpc(deviceId, "clipboard", {});
    return String(result ?? "");
  }

  /**
   * 遠端執行命令（需要使用者 approval）
   * approvalFn 應該暫停並等待使用者確認
   */
  async exec(
    deviceId: string,
    command: string,
    approvalFn?: (cmd: string) => Promise<boolean>,
  ): Promise<string> {
    if (approvalFn) {
      const approved = await approvalFn(command);
      if (!approved) throw new Error("使用者拒絕執行遠端命令");
    }
    const result = await this.rpc(deviceId, "exec", { command });
    return String((result as any)?.output ?? result ?? "");
  }

  // ── WebSocket 訊息處理 ─────────────────────────────────────────────────────

  /**
   * 處理來自裝置的 WebSocket 訊息。
   * 回傳 JsonRpcResponse（由 web server 實際發送）或 null（若為通知型訊息）。
   */
  handleMessage(
    ws: ServerWebSocket<NodeWsData>,
    rawMessage: string,
  ): JsonRpcResponse | null {
    let msg: JsonRpcRequest | JsonRpcResponse;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
    }

    // 若是 response（有 result 或 error），轉給 pendingRpcs
    if ("result" in msg || ("error" in msg && !("method" in msg))) {
      this.handleRpcResponse(msg as JsonRpcResponse);
      return null;
    }

    const req = msg as JsonRpcRequest;

    // pair 請求：裝置提交配對碼
    if (req.method === "pair") {
      const params = req.params as any;
      const code = String(params?.code ?? "");
      if (!this.validatePairingCode(code)) {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: 4001, message: "配對碼無效或已過期" },
        };
      }
      const deviceId = params?.deviceId ?? crypto.randomUUID();
      const device: PairedDevice = {
        id: deviceId,
        name: String(params?.name ?? deviceId),
        platform: String(params?.platform ?? "unknown"),
        pairedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      this.registerDevice(device);
      this.setConnection(deviceId, ws);
      ws.data.deviceId = deviceId;
      this.clearPairingCode();
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { deviceId, message: "配對成功" },
      };
    }

    // auth 請求：已配對裝置重新連線驗證
    if (req.method === "auth") {
      const params = req.params as any;
      const deviceId = String(params?.deviceId ?? "");
      if (!this.devices.has(deviceId)) {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: 4003, message: "裝置未配對" },
        };
      }
      this.setConnection(deviceId, ws);
      ws.data.deviceId = deviceId;
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { ok: true },
      };
    }

    // heartbeat
    if (req.method === "heartbeat") {
      const deviceId = ws.data.deviceId;
      if (deviceId) {
        const dev = this.devices.get(deviceId);
        if (dev) dev.lastSeenAt = new Date().toISOString();
      }
      return { jsonrpc: "2.0", id: req.id, result: { pong: true } };
    }

    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32601, message: `未知方法: ${req.method}` },
    };
  }
}

// ── 全域 singleton ────────────────────────────────────────────────────────────

let _nodeHost: NodeHost | null = null;

export function getNodeHost(pairingTimeoutSeconds?: number): NodeHost {
  if (!_nodeHost) {
    _nodeHost = new NodeHost(pairingTimeoutSeconds ?? 300);
  }
  return _nodeHost;
}
