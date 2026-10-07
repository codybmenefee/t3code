import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { describe } from "vite-plus/test";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { claudeMcpQueryOverrides } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { codexThreadRuntimeParams } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  defaultWebToolInstructions,
  readExternalMcpSessionTools,
  setExternalMcpSessionTools,
} from "./externalMcpServers.ts";
import { startMcpOAuthSignIn } from "./mcpOAuth.ts";
import * as ToolIntegrations from "./ToolIntegrations.ts";

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly apiKey: string | undefined;
  readonly body: string;
}

const bodyText = (request: HttpClientRequest.HttpClientRequest) =>
  request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";

/** An MCP server that lists `tools` tools, or answers every request with `status`. */
const mcpServer = (options: { readonly status?: number; readonly tools?: number }) => {
  const sent: Array<Sent> = [];
  const client = HttpClient.make((request) => {
    const body = bodyText(request);
    sent.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      apiKey: request.headers["x-api-key"],
      body,
    });
    if (options.status !== undefined) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response("{}", { status: options.status })),
      );
    }
    const result = body.includes('"tools/list"')
      ? {
          tools: Array.from({ length: options.tools ?? 0 }, (_, index) => ({
            name: `tool_${index}`,
            description: `Does thing ${index}.`,
          })),
        }
      : { protocolVersion: "2025-06-18", serverInfo: { name: "stub", version: "3.28.2" } };
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`,
          {
            headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" },
          },
        ),
      ),
    );
  });
  return { sent, client };
};

const memorySecrets = () => {
  const values = new Map<string, Uint8Array>();
  return ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.succeed(Option.fromNullishOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, value)),
    create: (name, value) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: (name, bytes) =>
      Effect.sync(() => values.get(name) ?? new Uint8Array(bytes)),
    remove: (name) => Effect.sync(() => void values.delete(name)),
  });
};

const withTools = <A, E>(
  client: HttpClient.HttpClient,
  settings: {
    readonly enabled: boolean;
    readonly default: boolean;
    readonly groups?: ReadonlyArray<string>;
    readonly exa?: boolean;
    readonly tavily?: boolean;
  },
  use: (tools: ToolIntegrations.ToolIntegrations["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* ToolIntegrations.ToolIntegrations);
  }).pipe(
    Effect.provide(
      ToolIntegrations.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            ServerSettings.layerTest({
              toolIntegrations: {
                defaultWebTool: settings.default ? "firecrawl" : null,
                firecrawl: {
                  enabled: settings.enabled,
                  enabledToolGroups: settings.groups === undefined ? null : [...settings.groups],
                },
                exa: { enabled: settings.exa ?? false },
                tavily: { enabled: settings.tavily ?? false },
              },
            }),
            Layer.succeed(ServerSecretStore.ServerSecretStore, memorySecrets()),
            Layer.succeed(HttpClient.HttpClient, client),
          ),
        ),
      ),
    ),
  );

describe("ToolIntegrations", () => {
  it.effect("leaves a key-only tool out of sessions until it has a key, without calling it", () =>
    Effect.gen(function* () {
      const { sent, client } = mcpServer({ tools: 2 });
      const status = yield* withTools(
        client,
        { enabled: false, default: false, tavily: true },
        (tools) => tools.status({ id: "tavily" }),
      );
      expect(status.auth).toBe("none");
      expect(status.connection.state).toBe("unauthorized");
      expect(sent).toEqual([]);
      expect(readExternalMcpSessionTools().servers).toEqual([]);
    }),
  );

  it.effect("sends each vendor's key the way its server takes it", () =>
    Effect.gen(function* () {
      const { sent, client } = mcpServer({ tools: 1 });
      yield* withTools(
        client,
        { enabled: false, default: false, exa: true, tavily: true },
        (tools) =>
          Effect.gen(function* () {
            yield* tools.run({ id: "exa", action: { _tag: "SaveApiKey", key: "exa-key" } });
            yield* tools.run({ id: "tavily", action: { _tag: "SaveApiKey", key: "tvly-key" } });
          }),
      );
      const exaRequest = sent.find((request) => request.url.startsWith("https://mcp.exa.ai/"));
      const tavilyRequest = sent.find((request) =>
        request.url.startsWith("https://mcp.tavily.com/"),
      );
      expect(exaRequest).toMatchObject({ apiKey: "exa-key", authorization: undefined });
      expect(tavilyRequest?.authorization).toBe("Bearer tvly-key");
      expect(readExternalMcpSessionTools().servers.map((server) => server.name)).toEqual([
        "exa",
        "tavily",
      ]);
    }),
  );

  it.effect("connects keyless with no credential and counts the listed tools", () =>
    Effect.gen(function* () {
      const { sent, client } = mcpServer({ tools: 3 });
      const status = yield* withTools(client, { enabled: true, default: false }, (tools) =>
        tools.status({ id: "firecrawl" }),
      );
      expect(status.auth).toBe("keyless");
      expect(status.connection.state).toBe("connected");
      expect(status.connection.tools.map(({ name }) => name)).toEqual([
        "tool_0",
        "tool_1",
        "tool_2",
      ]);
      expect(status.connection.tools[0]?.description).toBe("Does thing 0.");
      expect(sent.every((request) => request.authorization === undefined)).toBe(true);
      expect(sent[0]?.url).toBe("https://mcp.firecrawl.dev/v2/mcp");
    }),
  );

  it.effect("sends a saved API key as a bearer token and publishes it to sessions", () =>
    Effect.gen(function* () {
      const { sent, client } = mcpServer({ tools: 9 });
      const result = yield* withTools(client, { enabled: true, default: true }, (tools) =>
        tools.run({ id: "firecrawl", action: { _tag: "SaveApiKey", key: " fc-test " } }),
      );
      expect(result.status.auth).toBe("apiKey");
      expect(result.status.connection.serverVersion).toBe("3.28.2");
      expect(sent.at(-1)?.authorization).toBe("Bearer fc-test");
      const [server] = readExternalMcpSessionTools().servers;
      expect(server).toMatchObject({
        name: "firecrawl",
        url: "https://mcp.firecrawl.dev/v2/mcp",
        headers: { Authorization: "Bearer fc-test" },
      });
      // The default groups: search and scrape, Alexandria, feedback, account, documents.
      expect(server?.enabledTools).toContain("firecrawl_find_tools");
      expect(server?.enabledTools).toContain("firecrawl_parse");
      expect(server?.enabledTools).not.toContain("firecrawl_interact");
      expect(server?.disabledTools).toEqual(
        expect.arrayContaining([
          "firecrawl_agent",
          "firecrawl_interact",
          "firecrawl_monitor_create",
        ]),
      );
      expect(readExternalMcpSessionTools().defaultWebTool).toEqual({
        label: "Firecrawl",
        serverName: "firecrawl",
        exampleTools: ["firecrawl_search", "firecrawl_scrape"],
      });
    }),
  );

  it.effect("attaches an optional group once it is turned on, and never the agent tools", () =>
    Effect.gen(function* () {
      const { client } = mcpServer({ tools: 1 });
      yield* withTools(
        client,
        { enabled: true, default: false, groups: ["search", "browser"] },
        () => Effect.void,
      );
      const [server] = readExternalMcpSessionTools().servers;
      expect(server?.enabledTools).toEqual(
        expect.arrayContaining([
          "firecrawl_scrape",
          "firecrawl_interact",
          "firecrawl_interact_stop",
        ]),
      );
      expect(server?.enabledTools).not.toContain("firecrawl_find_tools");
      expect(server?.disabledTools).toEqual(
        expect.arrayContaining([
          "firecrawl_agent",
          "firecrawl_agent_status",
          "firecrawl_find_tools",
        ]),
      );
    }),
  );

  it.effect("publishes nothing, and no default, for a tool that is not added", () =>
    Effect.gen(function* () {
      const { client } = mcpServer({ tools: 1 });
      yield* withTools(client, { enabled: false, default: true }, () => Effect.void);
      expect(readExternalMcpSessionTools()).toEqual({ servers: [], defaultWebTool: null });
    }),
  );

  it.effect("reports a refused keyless connection with what to do next", () =>
    Effect.gen(function* () {
      const { client } = mcpServer({ status: 401 });
      const status = yield* withTools(client, { enabled: true, default: false }, (tools) =>
        tools.status({ id: "firecrawl" }),
      );
      expect(status.connection.state).toBe("unauthorized");
      expect(status.connection.message).toContain("Add an API key or sign in");
    }),
  );

  it("reads JSON-RPC results from JSON and from SSE", () => {
    expect(ToolIntegrations.rpcResult("application/json", '{"result":{"ok":1}}')).toEqual({
      ok: 1,
    });
    expect(
      ToolIntegrations.rpcResult(
        "text/event-stream",
        'event: message\ndata: {"result":{"ok":2}}\n\n',
      ),
    ).toEqual({ ok: 2 });
    expect(ToolIntegrations.rpcResult("application/json", "not json")).toBeUndefined();
  });
});

describe("MCP OAuth sign-in", () => {
  it.effect("discovers, registers, and exchanges the code the browser brings back", () =>
    Effect.gen(function* () {
      const posted: Array<{ readonly url: string; readonly body: string }> = [];
      const client = HttpClient.make((request) => {
        const json = (value: unknown) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(value)));
        if (request.url.includes("oauth-protected-resource")) {
          return json({ authorization_servers: ["https://auth.example"] });
        }
        if (request.url.includes("oauth-authorization-server")) {
          return json({
            authorization_endpoint: "https://auth.example/authorize",
            token_endpoint: "https://auth.example/token",
            registration_endpoint: "https://auth.example/register",
          });
        }
        posted.push({ url: request.url, body: bodyText(request) });
        return request.url.endsWith("/register")
          ? json({ client_id: "client-1" })
          : json({ access_token: "fco_access", refresh_token: "fco_refresh", expires_in: 3600 });
      });

      const signIn = yield* startMcpOAuthSignIn({
        resource: "https://mcp.example/v2/mcp-oauth",
        scopes: ["firecrawl:global", "offline_access"],
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));
      const authorization = new URL(signIn.authorizationUrl);
      expect(authorization.origin + authorization.pathname).toBe("https://auth.example/authorize");
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorization.searchParams.get("resource")).toBe("https://mcp.example/v2/mcp-oauth");

      // Play the browser: follow the redirect back to T3's loopback receiver.
      const redirect = new URL(authorization.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", "code-1");
      redirect.searchParams.set("state", authorization.searchParams.get("state")!);
      yield* HttpClient.get(redirect.toString()).pipe(Effect.provide(FetchHttpClient.layer));

      const tokens = yield* signIn.completion.pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      );
      expect(tokens).toMatchObject({
        accessToken: "fco_access",
        refreshToken: "fco_refresh",
        clientId: "client-1",
        tokenEndpoint: "https://auth.example/token",
      });
      const exchange = new URLSearchParams(posted.at(-1)!.body);
      expect(exchange.get("grant_type")).toBe("authorization_code");
      expect(exchange.get("code")).toBe("code-1");
      expect(exchange.get("code_verifier")?.length).toBeGreaterThan(40);
    }),
  );
});

describe("session attachment", () => {
  const threadId = ThreadId.make("thread-tools");
  const firecrawlDefault = {
    servers: [
      {
        name: "firecrawl",
        url: "https://mcp.example/v2/mcp",
        headers: { Authorization: "Bearer fc-test" },
        enabledTools: ["firecrawl_search", "firecrawl_scrape"],
        disabledTools: ["firecrawl_agent"],
      },
    ],
    defaultWebTool: {
      label: "Firecrawl",
      serverName: "firecrawl",
      exampleTools: ["firecrawl_search", "firecrawl_scrape"],
    },
  };

  it("tells agents to use the default tool first and keep their own as the fallback", () => {
    const text = defaultWebToolInstructions(firecrawlDefault);
    expect(text).toContain("Firecrawl is this session's default web provider");
    expect(text).toContain("`firecrawl_search` and `firecrawl_scrape`");
    expect(text).toContain("Use your own web search or fetch only when");
    expect(defaultWebToolInstructions({ ...firecrawlDefault, defaultWebTool: null })).toBe("");
  });

  it("gives Claude Code the server and the instruction, and leaves its web tools on", () => {
    setExternalMcpSessionTools(firecrawlDefault);
    const overrides = claudeMcpQueryOverrides({ threadId, readOnlySandbox: false });
    expect(overrides.mcpServers).toEqual({
      firecrawl: {
        type: "http",
        url: "https://mcp.example/v2/mcp",
        headers: { Authorization: "Bearer fc-test" },
      },
    });
    expect(overrides.toolInstructions).toBe(defaultWebToolInstructions(firecrawlDefault));
    // Only the tools left off are denied; Claude Code's own WebSearch and WebFetch stay on.
    expect(overrides.disallowedTools).toEqual(["mcp__firecrawl__firecrawl_agent"]);
  });

  it("gives Codex the server and leaves its web search on", () => {
    setExternalMcpSessionTools(firecrawlDefault);
    const config = codexThreadRuntimeParams({ threadId }).config;
    expect(config).toMatchObject({
      mcp_servers: {
        firecrawl: {
          url: "https://mcp.example/v2/mcp",
          http_headers: { Authorization: "Bearer fc-test" },
          enabled_tools: ["firecrawl_search", "firecrawl_scrape"],
        },
      },
    });
    expect(config).not.toHaveProperty("web_search");
    setExternalMcpSessionTools({ servers: [], defaultWebTool: null });
  });
});
