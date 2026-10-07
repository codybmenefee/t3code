/**
 * The vendor MCP servers every session T3 starts gets beside `t3-code`, kept
 * current by ToolIntegrations as settings and credentials change. Adapters
 * read it when they build a session's MCP configuration and instructions,
 * like they read McpProviderSession for T3's own server.
 */

export interface ExternalMcpServer {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The server's tools in groups the user turned on; agents that take an allowlist use it. */
  readonly enabledTools: ReadonlyArray<string>;
  /** Every other tool T3 knows the server has; agents that take a deny list use it. */
  readonly disabledTools: ReadonlyArray<string>;
}

export interface DefaultWebTool {
  readonly label: string;
  readonly serverName: string;
  /** Tool names the instructions cite, so agents can find them in their catalog. */
  readonly exampleTools: ReadonlyArray<string>;
}

export interface ExternalMcpSessionTools {
  readonly servers: ReadonlyArray<ExternalMcpServer>;
  /** The attached tool sessions are told to use first for web search and page reading. */
  readonly defaultWebTool: DefaultWebTool | null;
}

const NONE: ExternalMcpSessionTools = { servers: [], defaultWebTool: null };

let current: ExternalMcpSessionTools = NONE;

export function setExternalMcpSessionTools(next: ExternalMcpSessionTools): void {
  current = next;
}

export function readExternalMcpSessionTools(): ExternalMcpSessionTools {
  return current;
}

/**
 * The instruction that makes a default web tool the default. The agents' own
 * web tools stay available, so they remain the fallback when this one fails.
 */
export function defaultWebToolInstructions(tools: ExternalMcpSessionTools): string {
  const tool = tools.defaultWebTool;
  if (tool === null) return "";
  const examples = tool.exampleTools.map((name) => `\`${name}\``).join(" and ");
  return `

## Web search and page reading

${tool.label} is this session's default web provider. For web search and for reading web pages, use the tools from the \`${tool.serverName}\` MCP server first (${examples}). Use your own web search or fetch only when ${tool.label}'s tools are unavailable or fail.
`;
}
