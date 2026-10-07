import type { ToolIntegrationDefinition } from "./ToolIntegrationDefinition.ts";

/**
 * Tavily's hosted MCP server, with an API key as a bearer token. Its browser
 * sign-in does not publish standard OAuth discovery, so T3 offers the key only.
 */
export const tavily: ToolIntegrationDefinition = {
  id: "tavily",
  label: "Tavily",
  serverName: "tavily",
  url: "https://mcp.tavily.com/mcp/",
  apiKeyHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  keyless: false,
  oauthUrl: null,
  oauthScopes: [],
  webTools: ["tavily_search", "tavily_extract"],
};
