/**
 * ToolIntegrations - attaches vendors' own MCP servers to the agent sessions
 * T3 Code starts, the way T3 attaches `t3-code`. It holds each tool's
 * credential (an API key, an OAuth sign-in, or none for keyless), publishes
 * the servers sessions should get, and checks that each server answers.
 *
 * @module ToolIntegrations
 */
import {
  DEFAULT_SERVER_SETTINGS,
  enabledToolGroupIds,
  TOOL_INTEGRATION_REMOVED_TOOLS,
  TOOL_INTEGRATION_TOOL_GROUPS,
  type ToolIntegrationAuth,
  type ToolIntegrationConnection,
  ToolIntegrationError,
  ToolIntegrationId,
  type ToolIntegrationRunInput,
  type ToolIntegrationRunResult,
  type ToolIntegrationStatus,
  type ToolIntegrationStatusInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { type ExternalMcpServer, setExternalMcpSessionTools } from "./externalMcpServers.ts";
import { exa } from "./exa.ts";
import { firecrawl } from "./firecrawl.ts";
import { McpOAuthTokens, refreshMcpOAuthTokens, startMcpOAuthSignIn } from "./mcpOAuth.ts";
import { tavily } from "./tavily.ts";
import type { ToolIntegrationDefinition } from "./ToolIntegrationDefinition.ts";

const DEFINITIONS: Readonly<Record<ToolIntegrationId, ToolIntegrationDefinition>> = {
  firecrawl,
  exa,
  tavily,
};

/** Refresh an OAuth token this close to expiry, so a session never starts with a dying one. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** How often attached credentials are re-published, which also keeps OAuth tokens fresh. */
const REPUBLISH_INTERVAL = Duration.minutes(10);
const CONNECTION_TIMEOUT = Duration.seconds(10);

const secretName = (id: ToolIntegrationId, kind: "api-key" | "oauth") =>
  `tool-integration-${id}-${kind}`;

interface Credential {
  readonly auth: ToolIntegrationAuth;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const TokensJson = Schema.fromJsonString(McpOAuthTokens);
const decodeTokens = Schema.decodeUnknownOption(TokensJson);
const decodeServerInfo = Schema.decodeUnknownOption(
  Schema.Struct({ serverInfo: Schema.Struct({ version: Schema.optional(Schema.String) }) }),
);
const decodeToolList = Schema.decodeUnknownOption(
  Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({ name: Schema.String, description: Schema.optional(Schema.String) }),
    ),
  }),
);
/** Long tool descriptions are for the agent; the settings page shows a summary. */
const MAX_TOOL_DESCRIPTION_CHARS = 600;
const encodeTokens = Schema.encodeSync(TokensJson);
const decodeRpcEnvelope = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ result: Schema.optional(Schema.Unknown) })),
);

export class ToolIntegrations extends Context.Service<
  ToolIntegrations,
  {
    readonly status: (input: ToolIntegrationStatusInput) => Effect.Effect<ToolIntegrationStatus>;
    readonly run: (
      input: ToolIntegrationRunInput,
    ) => Effect.Effect<ToolIntegrationRunResult, ToolIntegrationError>;
  }
>()("t3/toolIntegrations/ToolIntegrations") {}

/** The JSON-RPC result in a Streamable HTTP response, which may arrive as SSE. */
export const rpcResult = (contentType: string, body: string): unknown => {
  const json = contentType.includes("text/event-stream")
    ? body
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .at(-1)
    : body;
  if (json === undefined) return undefined;
  return Option.getOrUndefined(decodeRpcEnvelope(json))?.result;
};

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const signInsPending = new Set<ToolIntegrationId>();
  // While a sign-in is out, the page polls for it; answer from the last handshake.
  const lastConnection = new Map<ToolIntegrationId, ToolIntegrationConnection>();

  const readSecret = (name: string) =>
    secrets.get(name).pipe(
      Effect.map(Option.map((bytes) => textDecoder.decode(bytes))),
      Effect.catch(() =>
        // No cause: a secret store error can quote the value it failed on.
        Effect.logWarning("could not read a tool integration secret").pipe(
          Effect.as(Option.none<string>()),
        ),
      ),
    );

  const writeSecret = (name: string, value: string | null) =>
    (value === null ? secrets.remove(name) : secrets.set(name, textEncoder.encode(value))).pipe(
      Effect.mapError(() => "Could not save the credential on this machine."),
    );

  /** OAuth beats an API key beats keyless, when the tool runs keyless; an expiring token is refreshed first. */
  const credential = Effect.fn("ToolIntegrations.credential")(function* (
    definition: ToolIntegrationDefinition,
  ) {
    if (definition.oauthUrl !== null) {
      const stored = Option.flatMap(
        yield* readSecret(secretName(definition.id, "oauth")),
        decodeTokens,
      );
      if (Option.isSome(stored)) {
        let tokens = stored.value;
        const now = yield* Clock.currentTimeMillis;
        if (tokens.expiresAt !== null && tokens.expiresAt - now < REFRESH_MARGIN_MS) {
          const refreshed = yield* refreshMcpOAuthTokens(tokens).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.option,
          );
          if (Option.isSome(refreshed)) {
            tokens = refreshed.value;
            yield* writeSecret(secretName(definition.id, "oauth"), encodeTokens(tokens)).pipe(
              Effect.ignore,
            );
          }
        }
        return {
          auth: "oauth",
          url: definition.oauthUrl,
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        } satisfies Credential;
      }
    }
    const apiKey = yield* readSecret(secretName(definition.id, "api-key"));
    return Option.isSome(apiKey) && apiKey.value.length > 0
      ? ({
          auth: "apiKey",
          url: definition.url,
          headers: definition.apiKeyHeaders(apiKey.value),
        } satisfies Credential)
      : ({
          auth: definition.keyless ? "keyless" : "none",
          url: definition.url,
          headers: {},
        } satisfies Credential);
  });

  /** Recompute what every new session gets from the current settings and credentials. */
  const publish = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.map((value) => value.toolIntegrations),
      Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS.toolIntegrations),
    );
    const enabled = ToolIntegrationId.literals.filter((id) => settings[id].enabled);
    const servers: Array<ExternalMcpServer> = [];
    for (const id of enabled) {
      const definition = DEFINITIONS[id];
      const { auth, url, headers } = yield* credential(definition);
      // A tool that does not run keyless waits for its key or sign-in.
      if (auth === "none") continue;
      const groups = enabledToolGroupIds(id, settings[id].enabledToolGroups);
      const enabledTools = TOOL_INTEGRATION_TOOL_GROUPS[id]
        .filter((group) => groups.includes(group.id))
        .flatMap((group) => group.tools);
      // Everything else T3 knows of is off, including tools the server added since.
      const known = new Set([
        ...TOOL_INTEGRATION_TOOL_GROUPS[id].flatMap((group) => group.tools),
        ...TOOL_INTEGRATION_REMOVED_TOOLS[id],
        ...(lastConnection.get(id)?.tools.map((tool) => tool.name) ?? []),
      ]);
      servers.push({
        name: definition.serverName,
        url,
        headers,
        enabledTools,
        disabledTools: [...known].filter((tool) => !enabledTools.includes(tool)),
      });
    }
    // The default counts only while its server is attached, so instructions never name a missing one.
    const defaultId = settings.defaultWebTool;
    const defaultTool =
      defaultId !== null &&
      servers.some((server) => server.name === DEFINITIONS[defaultId].serverName)
        ? DEFINITIONS[defaultId]
        : null;
    setExternalMcpSessionTools({
      servers,
      defaultWebTool:
        defaultTool === null
          ? null
          : {
              label: defaultTool.label,
              serverName: defaultTool.serverName,
              exampleTools: defaultTool.webTools,
            },
    });
  });

  /** One MCP handshake: initialize, then list tools, with the session's own credential. */
  const checkConnection = (target: Credential) =>
    Effect.gen(function* () {
      if (target.auth === "none") {
        return {
          state: "unauthorized",
          tools: [],
          serverVersion: null,
          message: "Needs an API key.",
        } satisfies ToolIntegrationConnection;
      }
      const post = (body: unknown, sessionId: string | null) =>
        httpClient
          .execute(
            HttpClientRequest.post(target.url).pipe(
              HttpClientRequest.setHeaders({
                ...target.headers,
                accept: "application/json, text/event-stream",
                ...(sessionId === null ? {} : { "mcp-session-id": sessionId }),
              }),
              HttpClientRequest.bodyJsonUnsafe(body),
            ),
          )
          .pipe(Effect.timeout(CONNECTION_TIMEOUT));
      const initialized = yield* post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "t3-code", version: "1" },
          },
        },
        null,
      );
      if (initialized.status === 401 || initialized.status === 403) {
        return {
          state: "unauthorized",
          tools: [],
          serverVersion: null,
          message:
            target.auth === "keyless"
              ? "Keyless access refused. Add an API key or sign in."
              : target.auth === "oauth"
                ? "Sign-in expired. Sign in again."
                : "API key rejected.",
        } satisfies ToolIntegrationConnection;
      }
      if (initialized.status < 200 || initialized.status >= 300) {
        return {
          state: "error",
          tools: [],
          serverVersion: null,
          message: `Server returned HTTP ${initialized.status}.`,
        } satisfies ToolIntegrationConnection;
      }
      const serverInfo = decodeServerInfo(
        rpcResult(initialized.headers["content-type"] ?? "", yield* initialized.text),
      );
      const sessionId = initialized.headers["mcp-session-id"] ?? null;
      yield* post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId).pipe(
        Effect.ignore,
      );
      const listed = yield* post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionId);
      const listing = decodeToolList(
        rpcResult(listed.headers["content-type"] ?? "", yield* listed.text),
      );
      return {
        state: "connected",
        tools: Option.match(listing, {
          onNone: () => [],
          onSome: ({ tools }) =>
            tools.map((tool) => ({
              name: tool.name,
              description: tool.description?.trim().slice(0, MAX_TOOL_DESCRIPTION_CHARS) ?? null,
            })),
        }),
        message: null,
        serverVersion: Option.match(serverInfo, {
          onNone: () => null,
          onSome: (info) => info.serverInfo.version ?? null,
        }),
      } satisfies ToolIntegrationConnection;
    }).pipe(
      Effect.catch(() =>
        Effect.succeed({
          state: "unreachable",
          tools: [],
          serverVersion: null,
          message: "Can't reach the server.",
        } satisfies ToolIntegrationConnection),
      ),
    );

  const status = Effect.fn("ToolIntegrations.status")(function* (
    input: ToolIntegrationStatusInput,
  ) {
    const definition = DEFINITIONS[input.id];
    const target = yield* credential(definition);
    return {
      id: definition.id,
      auth: target.auth,
      apiKeySaved: Option.exists(
        yield* readSecret(secretName(definition.id, "api-key")),
        (key) => key.length > 0,
      ),
      signInPending: signInsPending.has(definition.id),
      connection: yield* (() => {
        const last = lastConnection.get(definition.id);
        return signInsPending.has(definition.id) && last !== undefined
          ? Effect.succeed(last)
          : checkConnection(target).pipe(
              Effect.tap((connection) =>
                Effect.sync(() => lastConnection.set(definition.id, connection)),
              ),
              // Newly listed tools join the deny list of the next sessions.
              Effect.tap(() => publish),
            );
      })(),
      checkedAt: DateTime.formatIso(yield* DateTime.now),
    } satisfies ToolIntegrationStatus;
  });

  const run = Effect.fn("ToolIntegrations.run")(function* (input: ToolIntegrationRunInput) {
    const definition = DEFINITIONS[input.id];
    const fail = (detail: string) =>
      new ToolIntegrationError({ id: input.id, action: input.action._tag, detail });
    let authorizationUrl: string | null = null;

    switch (input.action._tag) {
      case "SaveApiKey": {
        const key = input.action.key.trim();
        yield* writeSecret(secretName(input.id, "api-key"), key === "" ? null : key).pipe(
          Effect.mapError(fail),
        );
        break;
      }
      case "SignOut":
        yield* writeSecret(secretName(input.id, "oauth"), null).pipe(Effect.mapError(fail));
        break;
      case "StartSignIn": {
        if (definition.oauthUrl === null) {
          return yield* fail(`${definition.label} has no sign-in; use an API key.`);
        }
        const signIn = yield* startMcpOAuthSignIn({
          resource: definition.oauthUrl,
          scopes: definition.oauthScopes,
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.mapError((error) => fail(error.message)),
        );
        authorizationUrl = signIn.authorizationUrl;
        signInsPending.add(input.id);
        // The browser round trip outlives this call; the status reports when it lands.
        yield* signIn.completion.pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.flatMap((tokens) =>
            writeSecret(secretName(input.id, "oauth"), encodeTokens(tokens)),
          ),
          Effect.andThen(publish),
          Effect.catch((error) =>
            Effect.logWarning("tool integration sign-in did not finish", {
              id: input.id,
              reason: typeof error === "string" ? error : error.message,
            }),
          ),
          Effect.ensuring(Effect.sync(() => signInsPending.delete(input.id))),
          Effect.forkDetach,
        );
        break;
      }
    }

    yield* publish;
    return { status: yield* status({ id: input.id }), authorizationUrl };
  });

  // New sessions pick up settings and credential changes, and tokens stay fresh.
  yield* publish;
  yield* serverSettings.streamChanges.pipe(
    Stream.runForEach(() => publish),
    Effect.forkScoped,
  );
  yield* publish.pipe(Effect.repeat(Schedule.spaced(REPUBLISH_INTERVAL)), Effect.forkScoped);

  return ToolIntegrations.of({ status, run });
});

export const layer = Layer.effect(ToolIntegrations, make);
