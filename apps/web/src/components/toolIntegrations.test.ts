import type { ToolIntegrationStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { toolGroupViews, toolIntegrationNotice } from "./toolIntegrations";

const status = (
  overrides: Partial<Omit<ToolIntegrationStatus, "connection">> & {
    readonly connection?: Partial<ToolIntegrationStatus["connection"]>;
  },
): ToolIntegrationStatus => ({
  id: "firecrawl",
  auth: "keyless",
  apiKeySaved: false,
  signInPending: false,
  checkedAt: "2026-10-07T00:00:00.000Z",
  ...overrides,
  connection: {
    state: "connected",
    tools: [],
    message: null,
    serverVersion: null,
    ...overrides.connection,
  },
});

describe("toolIntegrationNotice", () => {
  it("stays quiet while the server connects", () => {
    expect(toolIntegrationNotice(status({}))).toBeNull();
  });

  it("asks for a key or sign-in when keyless is refused", () => {
    expect(
      toolIntegrationNotice(
        status({ connection: { state: "unauthorized", tools: [], message: "Refused." } }),
      ),
    ).toEqual({
      key: "tool:firecrawl:keyless:unauthorized",
      title: "Firecrawl needs an API key or sign-in here",
      description: "Refused.",
    });
  });

  it("asks to sign in again when a sign-in stops working", () => {
    expect(
      toolIntegrationNotice(
        status({ auth: "oauth", connection: { state: "unauthorized", message: null } }),
      )?.title,
    ).toBe("Firecrawl needs you to sign in again");
  });

  it("leaves a tool that has no key yet to its row", () => {
    expect(
      toolIntegrationNotice(
        status({ id: "tavily", auth: "none", connection: { state: "unauthorized" } }),
      ),
    ).toBeNull();
  });

  it("waits for a sign-in in progress instead of nagging", () => {
    expect(
      toolIntegrationNotice(status({ signInPending: true, connection: { state: "unauthorized" } })),
    ).toBeNull();
  });
});

describe("toolGroupViews", () => {
  const listed = [
    { name: "firecrawl_search", description: "Search." },
    { name: "firecrawl_scrape", description: null },
    { name: "firecrawl_interact", description: null },
    { name: "firecrawl_agent", description: null },
    { name: "firecrawl_new_thing", description: null },
  ];

  it("turns on the default groups when nothing is saved, and hides the agent tools", () => {
    const groups = toolGroupViews("firecrawl", listed, null);
    expect(groups.filter((group) => group.enabled).map((group) => group.id)).toEqual([
      "search",
      "alexandria",
      "feedback",
      "account",
      "documents",
    ]);
    expect(groups.flatMap((group) => group.tools).map((tool) => tool.name)).not.toContain(
      "firecrawl_agent",
    );
    expect(groups.at(-1)).toMatchObject({ id: "other", enabled: false });
  });

  it("follows the saved groups and marks groups the server does not list", () => {
    const groups = toolGroupViews("firecrawl", listed, ["browser"]);
    expect(groups.find((group) => group.id === "browser")).toMatchObject({
      enabled: true,
      available: true,
    });
    expect(groups.find((group) => group.id === "monitors")?.available).toBe(false);
  });
});
