/**
 * Sign-in to an OAuth-protected MCP server (the MCP authorization spec):
 * discover the authorization server from the resource's metadata, register
 * T3 Code as a public client, run an authorization-code + PKCE flow through a
 * one-shot loopback receiver, and refresh the token later.
 *
 * @module mcpOAuth
 */

import { openOAuthLoopbackReceiver } from "@t3tools/shared/oauthLoopbackReceiver";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Base64Url from "effect/encoding/Base64Url";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

export class McpOAuthError extends Schema.TaggedError<McpOAuthError>()("McpOAuthError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** What T3 keeps in its secret store for one signed-in server. */
export const McpOAuthTokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  /** Epoch milliseconds; null when the server gave no lifetime. */
  expiresAt: Schema.NullOr(Schema.Number),
  clientId: Schema.String,
  tokenEndpoint: Schema.String,
  resource: Schema.String,
});
export type McpOAuthTokens = typeof McpOAuthTokens.Type;

const ProtectedResourceMetadata = Schema.Struct({
  authorization_servers: Schema.Array(Schema.String),
});
const AuthorizationServerMetadata = Schema.Struct({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optional(Schema.String),
});
const ClientRegistration = Schema.Struct({ client_id: Schema.String });
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
});

const SIGN_IN_TIMEOUT = Duration.minutes(5);
const CLIENT_NAME = "T3 Code";

const fail = (detail: string) => new McpOAuthError({ detail });

const readJson = <S extends Schema.Top>(
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
  what: string,
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .execute(request.pipe(HttpClientRequest.acceptJson))
      .pipe(Effect.mapError(() => fail(`Could not reach the server for ${what}.`)));
    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* fail(`${what} failed with HTTP ${response.status}. ${body.slice(0, 300)}`);
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(() => fail(`The server returned an unexpected ${what} response.`)),
    );
  });

const discover = (resource: string) =>
  Effect.gen(function* () {
    const url = new URL(resource);
    const protectedResource = yield* readJson(
      HttpClientRequest.get(`${url.origin}/.well-known/oauth-protected-resource${url.pathname}`),
      ProtectedResourceMetadata,
      "protected resource metadata",
    );
    const issuer = protectedResource.authorization_servers[0];
    if (issuer === undefined) return yield* fail("The server names no authorization server.");
    return yield* readJson(
      HttpClientRequest.get(`${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`),
      AuthorizationServerMetadata,
      "authorization server metadata",
    );
  });

const requestTokens = (
  tokenEndpoint: string,
  params: Record<string, string>,
  previous: Pick<McpOAuthTokens, "clientId" | "resource" | "refreshToken">,
) =>
  readJson(
    HttpClientRequest.post(tokenEndpoint).pipe(HttpClientRequest.bodyUrlParams(params)),
    TokenResponse,
    "token",
  ).pipe(
    Effect.flatMap((tokens) =>
      Clock.currentTimeMillis.pipe(
        Effect.map((now): McpOAuthTokens => ({
          accessToken: tokens.access_token,
          // A refresh that returns no new refresh token keeps using the old one.
          refreshToken: tokens.refresh_token ?? previous.refreshToken,
          expiresAt: tokens.expires_in === undefined ? null : now + tokens.expires_in * 1_000,
          clientId: previous.clientId,
          tokenEndpoint,
          resource: previous.resource,
        })),
      ),
    ),
  );

const openLoopbackReceiver = Effect.tryPromise({
  try: openOAuthLoopbackReceiver,
  catch: () => fail("Could not open a local address for the sign-in to return to."),
});

export interface McpOAuthSignIn {
  /** The page the user opens in a browser. */
  readonly authorizationUrl: string;
  /** Resolves once the browser returns to T3 and the code is exchanged. */
  readonly completion: Effect.Effect<McpOAuthTokens, McpOAuthError, HttpClient.HttpClient>;
}

export const startMcpOAuthSignIn = Effect.fn("startMcpOAuthSignIn")(function* (input: {
  readonly resource: string;
  readonly scopes: ReadonlyArray<string>;
}) {
  const server = yield* discover(input.resource);
  if (server.registration_endpoint === undefined) {
    return yield* fail("The server does not let T3 Code register for sign-in.");
  }
  const receiver = yield* openLoopbackReceiver;
  const registration = yield* readJson(
    HttpClientRequest.post(server.registration_endpoint).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        client_name: CLIENT_NAME,
        redirect_uris: [receiver.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    ),
    ClientRegistration,
    "client registration",
  ).pipe(Effect.tapError(() => Effect.sync(receiver.close)));

  // PKCE verifier and state come from the platform's secure random source.
  const crypto = yield* Crypto.Crypto;
  const keys = Effect.gen(function* () {
    const verifier = Base64Url.encode(yield* crypto.randomBytes(32));
    const state = Base64Url.encode(yield* crypto.randomBytes(16));
    const challenge = Base64Url.encode(
      yield* crypto.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    return { verifier, state, challenge };
  }).pipe(
    Effect.mapError(() => fail("Could not create the sign-in keys on this machine.")),
    Effect.tapError(() => Effect.sync(receiver.close)),
  );
  const { verifier, state, challenge } = yield* keys;
  const authorizationUrl = new URL(server.authorization_endpoint);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: registration.client_id,
    redirect_uri: receiver.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: input.scopes.join(" "),
    resource: input.resource,
  }).toString();

  const completion = Effect.tryPromise({
    try: () => receiver.callback,
    catch: () => fail("The sign-in did not return to T3 Code."),
  }).pipe(
    Effect.timeoutOrElse({
      duration: SIGN_IN_TIMEOUT,
      orElse: () => Effect.fail(fail("The sign-in was not finished in time.")),
    }),
    Effect.flatMap((params) => {
      if (params.get("state") !== state)
        return Effect.fail(fail("The sign-in response did not match."));
      const code = params.get("code");
      if (code === null) {
        return Effect.fail(
          fail(
            params.get("error_description") ?? params.get("error") ?? "The sign-in was declined.",
          ),
        );
      }
      return requestTokens(
        server.token_endpoint,
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: receiver.redirectUri,
          client_id: registration.client_id,
          code_verifier: verifier,
          resource: input.resource,
        },
        { clientId: registration.client_id, resource: input.resource, refreshToken: null },
      );
    }),
    Effect.ensuring(Effect.sync(receiver.close)),
  );

  return { authorizationUrl: authorizationUrl.toString(), completion } satisfies McpOAuthSignIn;
});

export const refreshMcpOAuthTokens = (tokens: McpOAuthTokens) =>
  tokens.refreshToken === null
    ? Effect.fail(fail("The sign-in has expired; sign in again."))
    : requestTokens(
        tokens.tokenEndpoint,
        {
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: tokens.clientId,
          resource: tokens.resource,
        },
        tokens,
      );
