import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Tool integrations are vendors' own MCP servers that T3 Code attaches to the
 * agent sessions it starts, the way it attaches its own `t3-code` server. T3
 * holds the credential and the connection settings; it never wraps the
 * vendor's API, so agents call the vendor's tools directly.
 */
export const ToolIntegrationId = Schema.Literals(["firecrawl", "exa", "tavily"]);
export type ToolIntegrationId = typeof ToolIntegrationId.Type;

/**
 * How T3 authenticates to the vendor's MCP server. `keyless` sends no
 * credential; `none` means the tool has no credential yet and is not set up
 * to run without one, so sessions do not get it.
 */
export const ToolIntegrationAuth = Schema.Literals(["keyless", "apiKey", "oauth", "none"]);
export type ToolIntegrationAuth = typeof ToolIntegrationAuth.Type;

/** One tool the vendor's server lists, as agents will see it. */
export const ToolIntegrationTool = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
});
export type ToolIntegrationTool = typeof ToolIntegrationTool.Type;

export const ToolIntegrationConnection = Schema.Struct({
  state: Schema.Literals(["connected", "unauthorized", "unreachable", "error"]),
  /** Tools the server listed for this credential; keyless connections list fewer. */
  tools: Schema.Array(ToolIntegrationTool),
  message: Schema.NullOr(Schema.String),
  /** The version the server reported when it connected. */
  serverVersion: Schema.NullOr(Schema.String),
});
export type ToolIntegrationConnection = typeof ToolIntegrationConnection.Type;

export const ToolIntegrationStatus = Schema.Struct({
  id: ToolIntegrationId,
  auth: ToolIntegrationAuth,
  /** An API key is stored, even while a sign-in takes precedence over it. */
  apiKeySaved: Schema.Boolean,
  /** A browser sign-in was started and has not come back yet. */
  signInPending: Schema.Boolean,
  connection: ToolIntegrationConnection,
  checkedAt: Schema.String,
});
export type ToolIntegrationStatus = typeof ToolIntegrationStatus.Type;

export const ToolIntegrationAction = Schema.Union([
  /** An empty key removes the stored one. */
  Schema.TaggedStruct("SaveApiKey", { key: Schema.String }),
  Schema.TaggedStruct("StartSignIn", {}),
  Schema.TaggedStruct("SignOut", {}),
]);
export type ToolIntegrationAction = typeof ToolIntegrationAction.Type;

export const ToolIntegrationStatusInput = Schema.Struct({ id: ToolIntegrationId });
export type ToolIntegrationStatusInput = typeof ToolIntegrationStatusInput.Type;

export const ToolIntegrationRunInput = Schema.Struct({
  id: ToolIntegrationId,
  action: ToolIntegrationAction,
});
export type ToolIntegrationRunInput = typeof ToolIntegrationRunInput.Type;

export const ToolIntegrationRunResult = Schema.Struct({
  status: ToolIntegrationStatus,
  /** Set by StartSignIn: the page the user opens to sign in. */
  authorizationUrl: Schema.NullOr(Schema.String),
});
export type ToolIntegrationRunResult = typeof ToolIntegrationRunResult.Type;

export class ToolIntegrationError extends Schema.TaggedError<ToolIntegrationError>()(
  "ToolIntegrationError",
  {
    id: ToolIntegrationId,
    action: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * A set of a tool's MCP tools that are turned on and off together. Tools in
 * no group, and the vendor's removed tools, are never attached.
 */
export interface ToolIntegrationToolGroup {
  readonly id: string;
  readonly tools: ReadonlyArray<string>;
  readonly defaultEnabled: boolean;
}

export const TOOL_INTEGRATION_TOOL_GROUPS: Readonly<
  Record<ToolIntegrationId, ReadonlyArray<ToolIntegrationToolGroup>>
> = {
  firecrawl: [
    {
      id: "search",
      tools: [
        "firecrawl_search",
        "firecrawl_scrape",
        "firecrawl_map",
        "firecrawl_crawl",
        "firecrawl_check_crawl_status",
      ],
      defaultEnabled: true,
    },
    { id: "alexandria", tools: ["firecrawl_find_tools"], defaultEnabled: true },
    {
      id: "feedback",
      tools: ["firecrawl_search_feedback", "firecrawl_feedback"],
      defaultEnabled: true,
    },
    { id: "account", tools: ["firecrawl_credit_usage"], defaultEnabled: true },
    { id: "documents", tools: ["firecrawl_parse"], defaultEnabled: true },
    {
      id: "browser",
      tools: ["firecrawl_interact", "firecrawl_interact_stop"],
      defaultEnabled: false,
    },
    {
      id: "monitors",
      tools: [
        "firecrawl_monitor_create",
        "firecrawl_monitor_list",
        "firecrawl_monitor_get",
        "firecrawl_monitor_update",
        "firecrawl_monitor_delete",
        "firecrawl_monitor_run",
        "firecrawl_monitor_checks",
        "firecrawl_monitor_check",
      ],
      defaultEnabled: false,
    },
    {
      id: "research",
      tools: [
        "firecrawl_research_search_papers",
        "firecrawl_research_inspect_paper",
        "firecrawl_research_related_papers",
        "firecrawl_research_read_paper",
      ],
      defaultEnabled: false,
    },
    {
      id: "indexes",
      tools: ["firecrawl_developer_search", "firecrawl_gov_search"],
      defaultEnabled: false,
    },
  ],
  exa: [{ id: "search", tools: ["web_search_exa", "web_fetch_exa"], defaultEnabled: true }],
  tavily: [
    {
      id: "search",
      tools: ["tavily_search", "tavily_extract", "tavily_crawl", "tavily_map"],
      defaultEnabled: true,
    },
    { id: "research", tools: ["tavily_research"], defaultEnabled: false },
    { id: "feedback", tools: ["tavily_feedback"], defaultEnabled: true },
  ],
};

/** Vendor tools T3 never attaches and does not offer. */
export const TOOL_INTEGRATION_REMOVED_TOOLS: Readonly<
  Record<ToolIntegrationId, ReadonlyArray<string>>
> = {
  firecrawl: ["firecrawl_agent", "firecrawl_agent_status"],
  exa: [],
  tavily: [],
};

/** The groups on for a tool: the saved choice, or each group's default when none is saved. */
export function enabledToolGroupIds(
  id: ToolIntegrationId,
  saved: ReadonlyArray<string> | null,
): ReadonlyArray<string> {
  const groups = TOOL_INTEGRATION_TOOL_GROUPS[id];
  return saved === null
    ? groups.filter((group) => group.defaultEnabled).map((group) => group.id)
    : groups.filter((group) => saved.includes(group.id)).map((group) => group.id);
}

const ToolIntegrationSettingsEntry = Schema.Struct({
  /** Attach the tool's MCP server to every session T3 starts on this environment. */
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Tool groups turned on; null keeps each group's default. */
  enabledToolGroups: Schema.NullOr(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});

export const ToolIntegrationSettings = Schema.Struct({
  /**
   * The tool sessions are told to use first for web search and page reading.
   * Null leaves the agents on their own web tools, which stay on either way as
   * the fallback. Only counts while that tool is enabled.
   */
  defaultWebTool: Schema.NullOr(ToolIntegrationId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  firecrawl: ToolIntegrationSettingsEntry.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  exa: ToolIntegrationSettingsEntry.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  tavily: ToolIntegrationSettingsEntry.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type ToolIntegrationSettings = typeof ToolIntegrationSettings.Type;

const ToolIntegrationSettingsEntryPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  enabledToolGroups: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
});

export const ToolIntegrationSettingsPatch = Schema.Struct({
  defaultWebTool: Schema.optionalKey(Schema.NullOr(ToolIntegrationId)),
  firecrawl: Schema.optionalKey(ToolIntegrationSettingsEntryPatch),
  exa: Schema.optionalKey(ToolIntegrationSettingsEntryPatch),
  tavily: Schema.optionalKey(ToolIntegrationSettingsEntryPatch),
});
export type ToolIntegrationSettingsPatch = typeof ToolIntegrationSettingsPatch.Type;
