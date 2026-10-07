// @effect-diagnostics nodeBuiltinImport:off - Native loopback listener for one OAuth redirect, closed after the first callback, like the Codex sign-in receiver.
import * as NodeHttp from "node:http";

/** A one-shot OAuth redirect listener on a random loopback port (RFC 8252). */
export interface OAuthLoopbackReceiver {
  readonly redirectUri: string;
  /** Resolves with the redirect's query parameters on the first request to the callback path. */
  readonly callback: Promise<URLSearchParams>;
  readonly close: () => void;
}

const CALLBACK_PATH = "/callback";

const CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>Signed in</title>
<body style="font:15px system-ui;padding:3rem;text-align:center">
<p>You can close this tab and return to T3 Code.</p></body>`;

export function openOAuthLoopbackReceiver(): Promise<OAuthLoopbackReceiver> {
  return new Promise((resolve, reject) => {
    let deliver!: (params: URLSearchParams) => void;
    const callback = new Promise<URLSearchParams>((done) => {
      deliver = done;
    });
    const server = NodeHttp.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(CALLBACK_PAGE);
      deliver(url.searchParams);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("The loopback listener has no port."));
        return;
      }
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
        callback,
        close: () => server.close(),
      });
    });
  });
}
