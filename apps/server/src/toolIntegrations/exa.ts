import type { ToolIntegrationDefinition } from "./ToolIntegrationDefinition.ts";

/**
 * Exa's hosted MCP server. It takes an API key in `x-api-key` or a bearer
 * token from a browser sign-in on the same endpoint. It also answers keyless,
 * but T3 attaches it only once the user has a key or has signed in.
 */
export const exa: ToolIntegrationDefinition = {
  id: "exa",
  label: "Exa",
  serverName: "exa",
  url: "https://mcp.exa.ai/mcp",
  apiKeyHeaders: (key) => ({ "x-api-key": key }),
  keyless: false,
  oauthUrl: "https://mcp.exa.ai/mcp",
  oauthScopes: ["mcp:tools"],
  webTools: ["web_search_exa", "web_fetch_exa"],
};
