/**
 * MCP Client Manager — 原生 MCP server 連線管理。
 *
 * 讓 ClaudeClaw 直接連接 MCP server（透過 stdio transport），
 * 不依賴 Claude Code CLI 的 MCP integration。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ── Types ──────────────────────────────────────────────────────────

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPServersConfig {
  [name: string]: MCPServerConfig;
}

export interface MCPConfig {
  servers?: MCPServersConfig;
}

export interface MCPToolInfo {
  server: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ── Manager ────────────────────────────────────────────────────────

interface ConnectedServer {
  client: Client;
  transport: StdioClientTransport;
  tools: MCPToolInfo[];
}

export class MCPClientManager {
  private servers = new Map<string, ConnectedServer>();

  async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    if (this.servers.has(name)) {
      await this.disconnectServer(name);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client(
      { name: "claudeclaw", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools: MCPToolInfo[] = (toolsResult.tools || []).map((t) => ({
      server: name,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));

    this.servers.set(name, { client, transport, tools });
  }

  async disconnectServer(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (!entry) return;
    try {
      await entry.client.close();
    } catch {
      // ignore close errors
    }
    this.servers.delete(name);
  }

  listTools(): MCPToolInfo[] {
    const all: MCPToolInfo[] = [];
    for (const entry of this.servers.values()) {
      all.push(...entry.tools);
    }
    return all;
  }

  listServers(): string[] {
    return [...this.servers.keys()];
  }

  getServerTools(name: string): MCPToolInfo[] {
    return this.servers.get(name)?.tools ?? [];
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const entry = this.servers.get(serverName);
    if (!entry) {
      throw new Error(`MCP server "${serverName}" 未連線`);
    }
    const result = await entry.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.allSettled(names.map((n) => this.disconnectServer(n)));
  }

  get size(): number {
    return this.servers.size;
  }

  get connected(): boolean {
    return this.servers.size > 0;
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _manager: MCPClientManager | null = null;

export function getMCPManager(): MCPClientManager {
  if (!_manager) {
    _manager = new MCPClientManager();
  }
  return _manager;
}

export async function initMCPServers(config?: MCPConfig): Promise<{ connected: string[]; errors: Array<{ name: string; error: string }> }> {
  const manager = getMCPManager();
  const servers = config?.servers ?? {};
  const desiredNames = new Set(Object.keys(servers));
  const connected: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const name of manager.listServers()) {
    if (!desiredNames.has(name)) {
      await manager.disconnectServer(name);
    }
  }

  for (const [name, serverConfig] of Object.entries(servers)) {
    try {
      await manager.connectServer(name, serverConfig);
      connected.push(name);
    } catch (err) {
      errors.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { connected, errors };
}

export function formatMCPStatus(): string {
  const manager = getMCPManager();
  const servers = manager.listServers();

  if (servers.length === 0) {
    return "🔌 **MCP Status**\n\n沒有已連線的 MCP server。\n\n請在 settings.json 的 `mcp.servers` 中設定 server。";
  }

  const lines = ["🔌 **MCP Status**", ""];
  for (const name of servers) {
    const tools = manager.getServerTools(name);
    lines.push(`**${name}** — ${tools.length} tool(s)`);
    for (const tool of tools) {
      lines.push(`  • \`${tool.name}\`${tool.description ? ` — ${tool.description}` : ""}`);
    }
    lines.push("");
  }

  const total = manager.listTools().length;
  lines.push(`共 ${servers.length} 個 server，${total} 個 tool。`);

  return lines.join("\n");
}

export function parseMCPConfig(raw: unknown): MCPConfig {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const servers: MCPServersConfig = {};

  if (obj.servers && typeof obj.servers === "object") {
    for (const [name, cfg] of Object.entries(obj.servers as Record<string, unknown>)) {
      if (!cfg || typeof cfg !== "object") continue;
      const c = cfg as Record<string, unknown>;
      if (typeof c.command !== "string") continue;
      servers[name] = {
        command: c.command,
        args: Array.isArray(c.args) ? c.args.filter((a: unknown): a is string => typeof a === "string") : undefined,
        env: c.env && typeof c.env === "object"
          ? Object.fromEntries(
              Object.entries(c.env as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, v as string]),
            )
          : undefined,
      };
    }
  }

  return { servers: Object.keys(servers).length > 0 ? servers : undefined };
}
