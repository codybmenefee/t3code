import type { ToolIntegrationDefinition } from "./ToolIntegrationDefinition.ts";

/**
 * Firecrawl's hosted MCP server. `/v2/mcp` serves keyless sessions with no
 * credential and the full tool surface with an API key as a bearer token;
 * `/v2/mcp-oauth` takes the token from a browser sign-in.
 */
export const firecrawl: ToolIntegrationDefinition = {
  id: "firecrawl",
  label: "Firecrawl",
  serverName: "firecrawl",
  url: "https://mcp.firecrawl.dev/v2/mcp",
  apiKeyHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  keyless: true,
  oauthUrl: "https://mcp.firecrawl.dev/v2/mcp-oauth",
  oauthScopes: ["firecrawl:global", "offline_access"],
  webTools: ["firecrawl_search", "firecrawl_scrape"],
};
