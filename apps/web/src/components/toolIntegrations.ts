import {
  enabledToolGroupIds,
  TOOL_INTEGRATION_REMOVED_TOOLS,
  TOOL_INTEGRATION_TOOL_GROUPS,
  type ToolIntegrationId,
  type ToolIntegrationStatus,
  type ToolIntegrationTool,
} from "@t3tools/contracts";

import { ExaIcon, FirecrawlIcon, type Icon, TavilyIcon } from "./Icons";

export interface ToolIntegrationPresentation {
  readonly label: string;
  readonly icon: Icon;
  readonly description: string;
  readonly docs: string;
  readonly apiKeyLink: string;
  /**
   * What a keyless connection offers, so the page can say what a key or
   * sign-in adds. Null for a tool that needs a key or sign-in to be attached.
   */
  readonly keylessNote: string | null;
  /** The vendor's server offers a browser sign-in T3 can run. */
  readonly signIn: boolean;
  /** First-party tools stay listed; removing one turns it off. Others leave the list. */
  readonly firstParty: boolean;
}

export const TOOL_INTEGRATIONS: Readonly<Record<ToolIntegrationId, ToolIntegrationPresentation>> = {
  firecrawl: {
    label: "Firecrawl",
    icon: FirecrawlIcon,
    description: "Web search, scraping, crawling, and document parsing.",
    docs: "https://docs.firecrawl.dev/mcp-server",
    apiKeyLink: "https://www.firecrawl.dev/app/api-keys",
    keylessNote: "Works keyless within daily limits.",
    signIn: true,
    firstParty: true,
  },
  exa: {
    label: "Exa",
    icon: ExaIcon,
    description: "Web search and page reading.",
    docs: "https://docs.exa.ai/reference/exa-mcp",
    apiKeyLink: "https://dashboard.exa.ai/api-keys",
    keylessNote: null,
    signIn: true,
    firstParty: false,
  },
  tavily: {
    label: "Tavily",
    icon: TavilyIcon,
    description: "Web search, extraction, mapping, and crawling.",
    docs: "https://docs.tavily.com/documentation/mcp",
    apiKeyLink: "https://app.tavily.com/home",
    keylessNote: null,
    signIn: false,
    firstParty: false,
  },
};

interface ToolGroupLabel {
  readonly label: string;
  readonly description: string;
}

/** How each catalog group reads on the page, keyed by tool, then group id. */
const TOOL_GROUP_LABELS: Readonly<
  Record<ToolIntegrationId, Readonly<Record<string, ToolGroupLabel>>>
> = {
  firecrawl: {
    search: {
      label: "Search and scrape",
      description: "Search the web, read pages, map and crawl sites.",
    },
    alexandria: { label: "Alexandria", description: "Find the right tool or API for a task." },
    feedback: { label: "Feedback", description: "Rate results and report problems." },
    account: { label: "Account", description: "Check remaining credits." },
    documents: { label: "Documents", description: "Turn PDFs and other files into text." },
    browser: {
      label: "Browser",
      description: "Drive a live browser on a page: click, type, read.",
    },
    monitors: { label: "Monitors", description: "Watch pages for changes on a schedule." },
    research: { label: "Research papers", description: "Search and read academic papers." },
    indexes: {
      label: "Developer and government search",
      description: "Search developer docs and government sources.",
    },
  },
  exa: {
    search: { label: "Search and fetch", description: "Search the web and read pages." },
  },
  tavily: {
    search: {
      label: "Search and extract",
      description: "Search the web, read pages, map and crawl sites.",
    },
    research: { label: "Research", description: "Run multi-step research on a topic." },
    feedback: { label: "Feedback", description: "Rate results and report problems." },
  },
};

export interface ToolGroupView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly enabled: boolean;
  /** The group's tools; the server's description when it listed the tool. */
  readonly tools: ReadonlyArray<ToolIntegrationTool>;
  /** False when the server lists none of the group's tools, as for keyless connections. */
  readonly available: boolean;
}

/**
 * The tool's catalog groups as the page toggles them. Listed tools no group
 * claims come last as an "Other" group that stays off; removed tools never show.
 */
export function toolGroupViews(
  id: ToolIntegrationId,
  listed: ReadonlyArray<ToolIntegrationTool>,
  savedGroups: ReadonlyArray<string> | null,
): ReadonlyArray<ToolGroupView> {
  const enabled = enabledToolGroupIds(id, savedGroups);
  const byName = new Map(listed.map((tool) => [tool.name, tool]));
  const groups = TOOL_INTEGRATION_TOOL_GROUPS[id];
  const views: Array<ToolGroupView> = groups.map((group) => ({
    id: group.id,
    label: TOOL_GROUP_LABELS[id][group.id]?.label ?? group.id,
    description: TOOL_GROUP_LABELS[id][group.id]?.description ?? "",
    enabled: enabled.includes(group.id),
    tools: group.tools.map((name) => byName.get(name) ?? { name, description: null }),
    available: group.tools.some((name) => byName.has(name)),
  }));
  const claimed = new Set([
    ...groups.flatMap((group) => group.tools),
    ...TOOL_INTEGRATION_REMOVED_TOOLS[id],
  ]);
  const other = listed.filter((tool) => !claimed.has(tool.name));
  if (other.length > 0) {
    views.push({
      id: "other",
      label: "Other",
      description: "Not grouped yet. Always off.",
      enabled: false,
      tools: other,
      available: true,
    });
  }
  return views;
}

export interface ToolIntegrationNotice {
  /** Dismissal key; the provider-update dismissals store keeps it, so it is namespaced. */
  readonly key: string;
  readonly title: string;
  readonly description: string;
}

/** What to tell the user about an added tool whose server will not connect, or null. */
export function toolIntegrationNotice(status: ToolIntegrationStatus): ToolIntegrationNotice | null {
  // A tool still waiting for its first key is unfinished setup, which its row shows, not an outage.
  if (status.connection.state === "connected" || status.signInPending || status.auth === "none") {
    return null;
  }
  const label = TOOL_INTEGRATIONS[status.id].label;
  return {
    key: `tool:${status.id}:${status.auth}:${status.connection.state}`,
    title:
      status.connection.state === "unauthorized"
        ? status.auth === "keyless"
          ? `${label} needs an API key or sign-in here`
          : `${label} needs you to sign in again`
        : `${label} is not connecting`,
    description: status.connection.message ?? `New sessions can't use ${label} until it connects.`,
  };
}
