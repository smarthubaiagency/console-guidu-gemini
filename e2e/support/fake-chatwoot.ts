import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

/**
 * Chatwoot test double for the end-to-end suite (A5a): one account (id 1)
 * with one inbox, accepting only `FAKE_CHATWOOT_TOKEN`. It creates, reads
 * and removes Agent Bots like the account API does; `GET /__bots` tells a
 * spec the webhook URL of the last bot, so it can play Chatwoot's calls.
 * The app reaches it on 127.0.0.1 only because the rig sets
 * `GUIDU_CHANNELS_ALLOW_PRIVATE=true`.
 */

export const FAKE_CHATWOOT_TOKEN = "e2e-chatwoot-user-token";

export type FakeChatwoot = Readonly<{
  url: string;
  close: () => Promise<void>;
}>;

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

export async function startFakeChatwoot(port: number): Promise<FakeChatwoot> {
  const bots = new Map<number, string>();
  let nextBot = 1;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const method = request.method ?? "GET";
    if (url.pathname === "/__bots") {
      json(response, 200, {
        bots: [...bots.entries()].map(([id, outgoingUrl]) => ({
          id,
          outgoingUrl,
        })),
      });
      return;
    }
    if (request.headers.api_access_token !== FAKE_CHATWOOT_TOKEN) {
      json(response, 401, { error: "Invalid token" });
      return;
    }
    const prefix = "/api/v1/accounts/1";
    if (!url.pathname.startsWith(`${prefix}/`)) {
      json(response, 404, { error: "Account not found" });
      return;
    }
    const rest = url.pathname.slice(prefix.length);
    if (rest === "/agent_bots" && method === "POST") {
      const input = JSON.parse(await body(request)) as { outgoing_url: string };
      const id = nextBot++;
      bots.set(id, input.outgoing_url);
      json(response, 200, { id, access_token: `e2e-bot-token-${id}` });
      return;
    }
    if (rest === "/inboxes" && method === "GET") {
      json(response, 200, {
        payload: [
          { id: 3, name: "WhatsApp Loja", channel_type: "Channel::Api" },
        ],
      });
      return;
    }
    if (/^\/inboxes\/\d+\/set_agent_bot$/.test(rest) && method === "POST") {
      response.writeHead(204);
      response.end();
      return;
    }
    const bot = /^\/agent_bots\/(\d+)$/.exec(rest);
    if (bot && bots.has(Number(bot[1]))) {
      if (method === "DELETE") bots.delete(Number(bot[1]));
      json(response, 200, { id: Number(bot[1]) });
      return;
    }
    json(response, 404, { error: "Not found" });
  });

  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
