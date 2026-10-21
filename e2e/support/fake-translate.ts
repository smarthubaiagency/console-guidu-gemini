import { createServer, type IncomingMessage } from "node:http";

/**
 * Google Cloud Translation (Basic, v2) test double for the end-to-end suite
 * (TR2). `POST /language/translate/v2` with `FAKE_GOOGLE_TRANSLATE_KEY` in
 * `x-goog-api-key` answers like the API: known phrases get their
 * Portuguese, anything else goes back with a mark; the terms marked as not
 * translatable come back as they went. Another key gets 400, as Google
 * answers to a key it does not know. The app reaches it on 127.0.0.1 only
 * because the rig sets `GUIDU_CHANNELS_ALLOW_PRIVATE=true`.
 */

export const FAKE_GOOGLE_TRANSLATE_KEY = "AIzaE2eFakeTranslateKey0123456789";

const PHRASES: Record<string, string> = {
  "Hola, ¿tienen habitación para dos personas esta noche?":
    "Olá, vocês têm quarto para duas pessoas esta noite?",
  "Hola, ¿tienen habitación para esta noche?":
    "Olá, vocês têm quarto para esta noite?",
  // TR3: what the team writes goes the other way (Portuguese to Spanish).
  "Temos quarto para duas pessoas esta noite.":
    "Tenemos habitación para dos personas esta noche.",
};

export type FakeTranslate = Readonly<{ close: () => Promise<void> }>;

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function unescape(html: string): string {
  return html
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export async function startFakeTranslate(port: number): Promise<FakeTranslate> {
  const server = createServer(async (request, response) => {
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (
      request.method !== "POST" ||
      request.url?.split("?")[0] !== "/language/translate/v2"
    ) {
      reply(404, { error: { code: 404, message: "Not found" } });
      return;
    }
    if (request.headers["x-goog-api-key"] !== FAKE_GOOGLE_TRANSLATE_KEY) {
      reply(400, { error: { code: 400, message: "API key not valid." } });
      return;
    }
    const sent = JSON.parse(await body(request)) as {
      q?: string[];
      target?: string;
    };
    const translations = (sent.q ?? []).map((html) => {
      const plain = unescape(html);
      return {
        translatedText: PHRASES[plain] ?? `[${sent.target ?? "?"}] ${html}`,
      };
    });
    reply(200, { data: { translations } });
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
