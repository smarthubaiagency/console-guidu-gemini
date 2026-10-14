import { describe, expect, it, vi } from "vitest";

import {
  disabledTransport,
  emailConfig,
  fromHeader,
  RESEND_API,
  resendTransport,
} from "./transport";
import { EmailSendError, type OutboundMessage } from "./types";

const MESSAGE: OutboundMessage = {
  to: "pessoa@example.com",
  fromName: "Agência Azul",
  replyTo: "suporte@agencia.test",
  subject: "Assunto",
  text: "Texto",
  html: "<p>Texto</p>",
  idempotencyKey: "invitation:abc",
  eventType: "invitation.created",
};

const CONFIG = {
  apiKey: "re_test_key",
  fromAddress: "avisos@guidu.test",
  apiBase: RESEND_API,
};

describe("emailConfig", () => {
  it("is off without the key or a valid sending address", () => {
    expect(emailConfig({})).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(
      emailConfig({ RESEND_API_KEY: "re_x", EMAIL_FROM_ADDRESS: "sem-arroba" }),
    ).toBeNull();
  });

  it("reads the key, the address and an optional base", () => {
    expect(
      emailConfig({
        RESEND_API_KEY: " re_x ",
        EMAIL_FROM_ADDRESS: "Avisos@GUIDU.test",
        RESEND_API_BASE: "http://127.0.0.1:9999/",
      }),
    ).toEqual({
      apiKey: "re_x",
      fromAddress: "avisos@guidu.test",
      apiBase: "http://127.0.0.1:9999",
    });
  });
});

describe("fromHeader", () => {
  it("quotes the name and drops what would break the header", () => {
    expect(fromHeader("Agência Azul", "a@b.test")).toBe(
      '"Agência Azul" <a@b.test>',
    );
    expect(fromHeader('X"\r\nBcc: <evil@x.test>', "a@b.test")).toBe(
      '"XBcc: evil@x.test" <a@b.test>',
    );
    expect(fromHeader("  ", "a@b.test")).toBe("a@b.test");
  });
});

describe("resendTransport", () => {
  it("posts the message with the idempotency key and reply-to", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ id: "msg_1" }, { status: 200 }),
    );
    const result = await resendTransport(CONFIG, fetchImpl).send(MESSAGE);
    expect(result).toEqual({ status: "sent", providerMessageId: "msg_1" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Idempotency-Key": "invitation:abc",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: '"Agência Azul" <avisos@guidu.test>',
      to: ["pessoa@example.com"],
      subject: "Assunto",
      text: "Texto",
      html: "<p>Texto</p>",
      reply_to: "suporte@agencia.test",
      tags: [{ name: "event", value: "invitation_created" }],
    });
  });

  it("leaves reply-to out when there is none", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "msg_2" }));
    await resendTransport(CONFIG, fetchImpl).send({
      ...MESSAGE,
      replyTo: null,
    });
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("reply_to");
  });

  it("turns a refusal or a network failure into EmailSendError", async () => {
    const refused = resendTransport(CONFIG, async () =>
      Response.json(
        { name: "validation_error", message: "domain not verified" },
        { status: 422 },
      ),
    );
    await expect(refused.send(MESSAGE)).rejects.toMatchObject({
      name: "EmailSendError",
      status: 422,
      code: "validation_error",
    });

    const offline = resendTransport(CONFIG, async () => {
      throw new TypeError("fetch failed");
    });
    await expect(offline.send(MESSAGE)).rejects.toBeInstanceOf(EmailSendError);
  });

  it("the disabled transport sends nothing", async () => {
    expect(await disabledTransport.send(MESSAGE)).toEqual({
      status: "skipped",
      reason: "no_provider",
    });
  });
});
