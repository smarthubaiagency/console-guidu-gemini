import { createServer, type IncomingMessage } from "node:http";

/**
 * Resend test double for the end-to-end suite (CF3a). `POST /emails` with
 * `FAKE_RESEND_KEY` keeps the message and answers an id, like the API;
 * `GET /__sent?to=<address>` lists what was sent to an address, newest
 * last, so a spec can read the e-mail a screen sent.
 */

export const FAKE_RESEND_KEY = "re_e2e_fake_key";

export type FakeResend = Readonly<{ close: () => Promise<void> }>;

type Sent = Readonly<{
  id: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  reply_to?: string;
  idempotencyKey: string | null;
}>;

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakeResend(port: number): Promise<FakeResend> {
  const sent: Sent[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (url.pathname === "/__sent" && request.method === "GET") {
      const to = url.searchParams.get("to")?.toLowerCase();
      reply(200, { sent: sent.filter((m) => !to || m.to.includes(to)) });
      return;
    }
    if (url.pathname !== "/emails" || request.method !== "POST") {
      reply(404, { name: "not_found" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${FAKE_RESEND_KEY}`) {
      reply(401, { name: "missing_api_key" });
      return;
    }
    const message = JSON.parse(await body(request)) as Omit<
      Sent,
      "id" | "idempotencyKey"
    >;
    const id = `fake-${sent.length + 1}`;
    sent.push({
      ...message,
      to: message.to.map((address) => address.toLowerCase()),
      id,
      idempotencyKey: (request.headers["idempotency-key"] as string) ?? null,
    });
    reply(200, { id });
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
