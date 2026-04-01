/**
 * tests/node-host.test.ts
 * NodeHost 單元測試
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { NodeHost, type PairedDevice, type JsonRpcRequest, type JsonRpcResponse } from "../src/node-host";

// ── Mock ServerWebSocket ──────────────────────────────────────────────────────

function makeMockWs(deviceId: string | null = null) {
  const sent: string[] = [];
  return {
    data: { deviceId },
    send: (msg: string) => sent.push(msg),
    close: mock(),
    _sent: sent,
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NodeHost — 配對碼", () => {
  let host: NodeHost;

  beforeEach(() => {
    host = new NodeHost(300);
  });

  test("generatePairingCode 回傳 6 位數字字串", () => {
    const code = host.generatePairingCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  test("連續生成不一定相同（大多數情況）", () => {
    // 生成 10 個，應該有多個不同的值（極少機率全部相同）
    const codes = new Set(Array.from({ length: 10 }, () => host.generatePairingCode()));
    expect(codes.size).toBeGreaterThan(1);
  });

  test("validatePairingCode 正確碼回傳 true", () => {
    const code = host.generatePairingCode();
    expect(host.validatePairingCode(code)).toBe(true);
  });

  test("validatePairingCode 錯誤碼回傳 false", () => {
    host.generatePairingCode();
    expect(host.validatePairingCode("000000")).toBe(false);
  });

  test("沒有 pending code 時 validate 回傳 false", () => {
    expect(host.validatePairingCode("123456")).toBe(false);
  });

  test("clearPairingCode 後 validate 回傳 false", () => {
    const code = host.generatePairingCode();
    host.clearPairingCode();
    expect(host.validatePairingCode(code)).toBe(false);
  });

  test("getPendingCode 在有效期內回傳碼", () => {
    const code = host.generatePairingCode();
    const pending = host.getPendingCode();
    expect(pending).not.toBeNull();
    expect(pending!.code).toBe(code);
  });

  test("getPendingCode 無 pending 時回傳 null", () => {
    expect(host.getPendingCode()).toBeNull();
  });
});

describe("NodeHost — Device Registry", () => {
  let host: NodeHost;

  const device: PairedDevice = {
    id: "device-001",
    name: "Rex 的 iPhone",
    platform: "ios",
    pairedAt: "2024-01-01T00:00:00.000Z",
    lastSeenAt: "2024-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    host = new NodeHost(300);
  });

  test("registerDevice 後 listDevices 包含該裝置", () => {
    host.registerDevice(device);
    const list = host.listDevices();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("device-001");
  });

  test("getDevice 回傳正確裝置", () => {
    host.registerDevice(device);
    const found = host.getDevice("device-001");
    expect(found).not.toBeUndefined();
    expect(found!.name).toBe("Rex 的 iPhone");
  });

  test("getDevice 不存在的 ID 回傳 undefined", () => {
    expect(host.getDevice("nonexistent")).toBeUndefined();
  });

  test("unpairDevice 移除裝置", () => {
    host.registerDevice(device);
    const ok = host.unpairDevice("device-001");
    expect(ok).toBe(true);
    expect(host.listDevices()).toHaveLength(0);
  });

  test("unpairDevice 不存在的 ID 回傳 false", () => {
    expect(host.unpairDevice("ghost")).toBe(false);
  });

  test("多裝置並存", () => {
    host.registerDevice(device);
    host.registerDevice({ ...device, id: "device-002", name: "MacBook" });
    expect(host.listDevices()).toHaveLength(2);
  });
});

describe("NodeHost — 連線管理", () => {
  let host: NodeHost;

  beforeEach(() => {
    host = new NodeHost(300);
    host.registerDevice({
      id: "device-001",
      name: "Test Device",
      platform: "linux",
      pairedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  });

  test("setConnection 後 isOnline 回傳 true", () => {
    const ws = makeMockWs("device-001");
    host.setConnection("device-001", ws);
    expect(host.isOnline("device-001")).toBe(true);
  });

  test("removeConnection 後 isOnline 回傳 false", () => {
    const ws = makeMockWs("device-001");
    host.setConnection("device-001", ws);
    host.removeConnection("device-001");
    expect(host.isOnline("device-001")).toBe(false);
  });

  test("未連線裝置 isOnline 回傳 false", () => {
    expect(host.isOnline("device-001")).toBe(false);
  });
});

describe("NodeHost — WebSocket 訊息格式（JSON-RPC 2.0）", () => {
  let host: NodeHost;

  beforeEach(() => {
    host = new NodeHost(300);
  });

  test("非 JSON 訊息回傳 Parse error (-32700)", () => {
    const ws = makeMockWs(null);
    const resp = host.handleMessage(ws, "not json");
    expect(resp).not.toBeNull();
    expect(resp!.error?.code).toBe(-32700);
  });

  test("pair 請求配對碼無效時回傳錯誤 4001", () => {
    const ws = makeMockWs(null);
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "pair",
      params: { code: "999999", name: "Test", platform: "linux", deviceId: "abc" },
    };
    const resp = host.handleMessage(ws, JSON.stringify(req));
    expect(resp!.error?.code).toBe(4001);
  });

  test("pair 請求配對碼有效時成功配對", () => {
    const code = host.generatePairingCode();
    const ws = makeMockWs(null);
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "pair",
      params: { code, name: "My Phone", platform: "android", deviceId: "test-uuid-001" },
    };
    const resp = host.handleMessage(ws, JSON.stringify(req));
    expect(resp!.error).toBeUndefined();
    expect(resp!.result).toMatchObject({ deviceId: "test-uuid-001", message: "配對成功" });
    expect(host.getDevice("test-uuid-001")).not.toBeUndefined();
  });

  test("auth 請求未知裝置回傳錯誤 4003", () => {
    const ws = makeMockWs(null);
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "auth",
      params: { deviceId: "ghost-device" },
    };
    const resp = host.handleMessage(ws, JSON.stringify(req));
    expect(resp!.error?.code).toBe(4003);
  });

  test("heartbeat 回傳 pong", () => {
    host.registerDevice({
      id: "dev-1",
      name: "T",
      platform: "linux",
      pairedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const ws = makeMockWs("dev-1");
    host.setConnection("dev-1", ws);
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: "hb-1",
      method: "heartbeat",
      params: {},
    };
    const resp = host.handleMessage(ws, JSON.stringify(req));
    expect(resp!.result).toMatchObject({ pong: true });
  });

  test("未知 method 回傳 -32601", () => {
    const ws = makeMockWs(null);
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 3,
      method: "foobar",
      params: {},
    };
    const resp = host.handleMessage(ws, JSON.stringify(req));
    expect(resp!.error?.code).toBe(-32601);
  });

  test("JSON-RPC response 訊息（有 result）不產生回應", () => {
    const ws = makeMockWs(null);
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: "rpc-1",
      result: "hello",
    };
    const resp = host.handleMessage(ws, JSON.stringify(response));
    expect(resp).toBeNull();
  });
});

describe("NodeHost — getNodeHost singleton", () => {
  test("getNodeHost 回傳同一個實例", async () => {
    const { getNodeHost } = await import("../src/node-host");
    const a = getNodeHost();
    const b = getNodeHost();
    expect(a).toBe(b);
  });
});
