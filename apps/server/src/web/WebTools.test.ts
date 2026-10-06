import { it } from "@effect/vitest";
import type { ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as Settings from "../serverSettings.ts";
import * as WebTools from "./WebTools.ts";

interface SentRequest {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly apiKey: string | undefined;
  readonly body: unknown;
}

const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array"
    ? JSON.parse(new TextDecoder().decode(request.body.body))
    : undefined;

/** Answers every request with `body` and records what was sent. */
const recordingClient = (status: number, body: unknown) => {
  const sent: SentRequest[] = [];
  const client = HttpClient.make((request) => {
    sent.push({
      url: request.url,
      authorization: request.headers.authorization,
      apiKey: request.headers["x-api-key"],
      body: bodyOf(request),
    });
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body, { status })));
  });
  return { sent, client };
};

const refuseRequests = HttpClient.make(() => Effect.die("must not send a request"));

const withWebTools = <A, E>(
  web: Partial<ServerSettings["web"]>,
  client: HttpClient.HttpClient,
  use: (tools: WebTools.WebTools["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* WebTools.WebTools);
  }).pipe(
    Effect.provide(
      WebTools.layer.pipe(
        Layer.provide(Settings.layerTest({ web })),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      ),
    ),
  );

describe("WebTools", () => {
  it.effect("searches through Firecrawl by default, without a key when none is saved", () =>
    Effect.gen(function* () {
      const { sent, client } = recordingClient(200, {
        success: true,
        data: {
          web: [
            { url: "https://effect.website", title: " Effect ", description: "x".repeat(900) },
            { url: "https://example.com" },
          ],
        },
      });
      const result = yield* withWebTools({}, client, (tools) =>
        tools.search({ query: "effect schema", limit: 50 }),
      );

      expect(sent).toEqual([
        {
          url: "https://api.firecrawl.dev/v2/search",
          authorization: undefined,
          apiKey: undefined,
          body: { query: "effect schema", limit: WebTools.MAX_WEB_SEARCH_RESULTS },
        },
      ]);
      expect(result.provider).toBe("firecrawl");
      expect(result.results.map(({ url, title }) => ({ url, title }))).toEqual([
        { url: "https://effect.website", title: "Effect" },
        { url: "https://example.com", title: "" },
      ]);
      expect(result.results[0]!.snippet.length).toBeLessThan(510);
    }),
  );

  it.effect("fetches a page as markdown with the saved Firecrawl key and cuts long pages", () =>
    Effect.gen(function* () {
      const { sent, client } = recordingClient(200, {
        success: true,
        data: {
          markdown: "a".repeat(WebTools.MAX_WEB_FETCH_CHARS + 10),
          metadata: { title: "Example Domain", url: "https://example.com/" },
        },
      });
      const result = yield* withWebTools({ firecrawlApiKey: "fc-test" }, client, (tools) =>
        tools.fetch({ url: "https://example.com" }),
      );

      expect(sent).toEqual([
        {
          url: "https://api.firecrawl.dev/v2/scrape",
          authorization: "Bearer fc-test",
          apiKey: undefined,
          body: {
            url: "https://example.com",
            formats: ["markdown"],
            onlyMainContent: true,
            maxAge: 0,
          },
        },
      ]);
      expect(result).toMatchObject({
        provider: "firecrawl",
        url: "https://example.com/",
        title: "Example Domain",
        truncated: true,
      });
      expect(result.content.length).toBe(WebTools.MAX_WEB_FETCH_CHARS);
    }),
  );

  it.effect("refuses without a request when the CLIs keep their own web tools", () =>
    Effect.gen(function* () {
      const error = yield* withWebTools({ provider: "builtin" }, refuseRequests, (tools) =>
        tools.search({ query: "anything" }),
      ).pipe(Effect.flip);
      expect(error._tag).toBe("WebToolsDisabledError");
    }),
  );

  it.effect("asks for an Exa key before calling Exa", () =>
    Effect.gen(function* () {
      const error = yield* withWebTools({ provider: "exa" }, refuseRequests, (tools) =>
        tools.fetch({ url: "https://example.com" }),
      ).pipe(Effect.flip);
      expect(error.message).toBe("Add your Exa API key in Settings → Web.");
    }),
  );

  it.effect("names the provider and status when a request is rejected", () =>
    Effect.gen(function* () {
      const { client } = recordingClient(401, { error: "Unauthorized" });
      const error = yield* withWebTools(
        { provider: "tavily", tavilyApiKey: "tvly-bad" },
        client,
        (tools) => tools.search({ query: "anything" }),
      ).pipe(Effect.flip);
      expect(error.message).toBe(
        "Tavily web search failed with HTTP 401. Check the API key in Settings → Web.",
      );
    }),
  );
});
