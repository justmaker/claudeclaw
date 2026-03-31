import { describe, test, expect } from "bun:test";
import { MCPClientManager, parseMCPConfig, formatMCPStatus, getMCPManager } from "../src/mcp-client";

describe("parseMCPConfig", () => {
  test("解析空值回傳空物件", () => {
    expect(parseMCPConfig(null)).toEqual({});
    expect(parseMCPConfig(undefined)).toEqual({});
    expect(parseMCPConfig({})).toEqual({});
  });

  test("解析有效的 server config", () => {
    const raw = {
      servers: {
        "mcp-sauron": {
          command: "npx",
          args: ["-y", "efficient-gitlab-mcp-server"],
          env: { GITLAB_PERSONAL_ACCESS_TOKEN: "test-token" },
        },
        "mcp-atlassian": {
          command: "uvx",
          args: ["mcp-atlassian"],
          env: { CONFLUENCE_URL: "https://example.com" },
        },
      },
    };

    const result = parseMCPConfig(raw);
    expect(result.servers).toBeDefined();
    expect(Object.keys(result.servers!)).toEqual(["mcp-sauron", "mcp-atlassian"]);
    expect(result.servers!["mcp-sauron"].command).toBe("npx");
    expect(result.servers!["mcp-sauron"].args).toEqual(["-y", "efficient-gitlab-mcp-server"]);
    expect(result.servers!["mcp-sauron"].env?.GITLAB_PERSONAL_ACCESS_TOKEN).toBe("test-token");
  });

  test("忽略缺少 command 的 server", () => {
    const raw = {
      servers: {
        "valid": { command: "echo", args: ["hello"] },
        "invalid": { args: ["no-command"] },
      },
    };
    const result = parseMCPConfig(raw);
    expect(Object.keys(result.servers!)).toEqual(["valid"]);
  });

  test("過濾非字串的 args 和 env", () => {
    const raw = {
      servers: {
        test: {
          command: "echo",
          args: ["valid", 123, "also-valid"],
          env: { KEY: "value", BAD: 42 },
        },
      },
    };
    const result = parseMCPConfig(raw);
    expect(result.servers!["test"].args).toEqual(["valid", "also-valid"]);
    expect(result.servers!["test"].env).toEqual({ KEY: "value" });
  });
});

describe("MCPClientManager", () => {
  test("初始狀態：無連線", () => {
    const manager = new MCPClientManager();
    expect(manager.size).toBe(0);
    expect(manager.connected).toBe(false);
    expect(manager.listTools()).toEqual([]);
    expect(manager.listServers()).toEqual([]);
  });

  test("disconnectAll 在沒有 server 時不報錯", async () => {
    const manager = new MCPClientManager();
    await manager.disconnectAll();
    expect(manager.size).toBe(0);
  });

  test("disconnectServer 對不存在的 server 不報錯", async () => {
    const manager = new MCPClientManager();
    await manager.disconnectServer("nonexistent");
  });

  test("callTool 對不存在的 server 拋錯", async () => {
    const manager = new MCPClientManager();
    expect(manager.callTool("nonexistent", "tool", {})).rejects.toThrow("未連線");
  });

  test("getServerTools 對不存在的 server 回傳空陣列", () => {
    const manager = new MCPClientManager();
    expect(manager.getServerTools("nonexistent")).toEqual([]);
  });
});

describe("getMCPManager", () => {
  test("回傳 singleton", () => {
    const a = getMCPManager();
    const b = getMCPManager();
    expect(a).toBe(b);
  });
});

describe("formatMCPStatus", () => {
  test("無 server 時顯示提示訊息", () => {
    const status = formatMCPStatus();
    expect(status).toContain("MCP Status");
    expect(status).toContain("沒有已連線的 MCP server");
  });
});
