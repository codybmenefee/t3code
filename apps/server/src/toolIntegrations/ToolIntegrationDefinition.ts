import type { ToolIntegrationId } from "@t3tools/contracts";

/**
 * A vendor's own MCP server, as T3 Code attaches it to agent sessions. Adding
 * a tool means describing its endpoints here, not wrapping its API.
 */
export interface ToolIntegrationDefinition {
  readonly id: ToolIntegrationId;
  readonly label: string;
  /** The name agents see the server under (Claude Code tools become `mcp__<name>__<tool>`). */
  readonly serverName: string;
  /** Streamable HTTP endpoint for keyless and API-key connections; keyless sends no credential. */
  readonly url: string;
  /** Headers that carry an API key to `url`; vendors differ on the header. */
  readonly apiKeyHeaders: (key: string) => Readonly<Record<string, string>>;
  /**
   * Whether T3 attaches the server with no credential. A vendor whose server
   * also answers keyless can still be set up to need a key or sign-in first.
   */
  readonly keyless: boolean;
  /** Endpoint that takes an OAuth access token; null when the vendor has no sign-in. */
  readonly oauthUrl: string | null;
  readonly oauthScopes: ReadonlyArray<string>;
  /** Search and page-reading tools the default-web-provider instruction names. */
  readonly webTools: ReadonlyArray<string>;
}
