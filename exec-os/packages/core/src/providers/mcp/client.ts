import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Logger } from "../../logging/logger.js";

export interface McpToolInfo { name: string; description?: string; inputSchema?: unknown }

export interface McpClientOptions {
  id: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
  logger: Logger;
}

export interface ToolCallResult {
  isError: boolean;
  text: string;                    // concatenated text content
  structured?: unknown;            // structuredContent when provided
  raw: unknown;
}

/**
 * Thin, transport-agnostic MCP client. This is the ONLY place that speaks MCP; adapters
 * above it work with tool names and JSON, and the rest of the app never sees MCP at all.
 */
export class McpClient {
  private client: Client | undefined;
  private tools: McpToolInfo[] = [];
  private stderrTail: string[] = [];
  constructor(private readonly opts: McpClientOptions) {}

  get id(): string { return this.opts.id; }
  get connected(): boolean { return !!this.client; }
  get recentStderr(): string { return this.stderrTail.join("\n"); }

  async connect(): Promise<void> {
    if (this.client) return;
    const client = new Client({ name: "execos", version: "0.1.0" }, { capabilities: {} });
    if (this.opts.transport === "stdio") {
      if (!this.opts.command) throw new Error(`provider ${this.opts.id}: stdio transport requires a command`);
      // Never leak our own secret env vars to servers: pass a curated environment.
      const env: Record<string, string> = {};
      for (const k of ["PATH", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "USERNAME", "COMSPEC", "PATHEXT", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "DOTNET_CLI_HOME", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) {
        const v = process.env[k]; if (v !== undefined) env[k] = v;
      }
      Object.assign(env, this.opts.env ?? {});
      const transport = new StdioClientTransport({ command: this.opts.command, args: this.opts.args ?? [], env, stderr: "pipe" });
      transport.stderr?.on("data", (d: Buffer) => {
        const line = d.toString().trim();
        if (!line) return;
        this.stderrTail.push(line.slice(0, 500));
        if (this.stderrTail.length > 20) this.stderrTail.shift();
        this.opts.logger.debug("mcp stderr", { provider: this.opts.id, len: line.length });
      });
      await client.connect(transport);
    } else {
      if (!this.opts.url) throw new Error(`provider ${this.opts.id}: http transport requires a url`);
      const transport = new StreamableHTTPClientTransport(new URL(this.opts.url), { requestInit: { headers: this.opts.headers ?? {} } });
      await client.connect(transport);
    }
    this.client = client;
    await this.refreshTools();
  }

  async refreshTools(): Promise<McpToolInfo[]> {
    if (!this.client) throw new Error("not connected");
    const res = await this.client.listTools();
    this.tools = res.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    this.opts.logger.info("mcp tools discovered", { provider: this.opts.id, tools: this.tools.map((t) => t.name) });
    return this.tools;
  }

  listTools(): McpToolInfo[] { return this.tools; }
  hasTool(name: string): boolean { return this.tools.some((t) => t.name === name); }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<ToolCallResult> {
    if (!this.client) throw new Error("not connected");
    const res = await this.client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs ?? this.opts.timeout_ms ?? 120000 });
    const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    const text = content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string).join("\n");
    return {
      isError: Boolean((res as { isError?: boolean }).isError),
      text,
      structured: (res as { structuredContent?: unknown }).structuredContent,
      raw: res,
    };
  }

  async close(): Promise<void> {
    try { await this.client?.close(); } catch { /* ignore */ }
    this.client = undefined;
  }
}
