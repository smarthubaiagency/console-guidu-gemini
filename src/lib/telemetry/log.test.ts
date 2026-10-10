import { describe, expect, it } from "vitest";

import { createLogger, formatLogLine, type LogLevel } from "./log";

const now = new Date("2026-10-16T12:00:00Z");

describe("structured logs (F3d)", () => {
  it("writes one JSON object with the fixed fields first", () => {
    const line = JSON.parse(
      formatLogLine(
        "info",
        "worker",
        "job.succeeded",
        { jobId: "j1", kind: "billing.payout-report" },
        now,
      ),
    );
    expect(line).toEqual({
      ts: "2026-10-16T12:00:00.000Z",
      level: "info",
      source: "worker",
      event: "job.succeeded",
      jobId: "j1",
      kind: "billing.payout-report",
    });
  });

  it("never carries secrets, by key or by value", () => {
    const line = formatLogLine(
      "error",
      "web",
      "app.error",
      {
        requestId: "r1",
        apiKey: "gdu_live_abc",
        headers: { authorization: "Bearer x", cookie: "sb=1" },
        password: "hunter2",
        message:
          "falhou com sk-ant-abc123 em postgresql://app:senha@db:5432/x para pessoa@cliente.com.br",
        nested: { client_secret: "s", token_hash: "t" },
      },
      now,
    );
    for (const secret of [
      "gdu_live_abc",
      "Bearer x",
      "sb=1",
      "hunter2",
      "sk-ant-abc123",
      "senha",
      "pessoa@",
    ]) {
      expect(line).not.toContain(secret);
    }
    const parsed = JSON.parse(line);
    expect(parsed.requestId).toBe("r1");
    expect(parsed.apiKey).toBe("[REDACTED]");
    expect(parsed.headers.authorization).toBe("[REDACTED]");
    expect(parsed.nested).toEqual({
      client_secret: "[REDACTED]",
      token_hash: "[REDACTED]",
    });
  });

  it("keeps the fixed fields and rejects free-text events", () => {
    const parsed = JSON.parse(
      formatLogLine(
        "warn",
        "web",
        "Something broke!",
        { level: "debug", source: "x", ts: "y" },
        now,
      ),
    );
    expect(parsed).toMatchObject({
      level: "warn",
      source: "web",
      event: "log.invalid_event",
    });
    expect(parsed.ts).toBe("2026-10-16T12:00:00.000Z");
  });

  it("logs errors by name and redacted message, without the stack", () => {
    const parsed = JSON.parse(
      formatLogLine(
        "error",
        "worker",
        "worker.crashed",
        { error: new Error("token eyJa.eyJb.c vazou") },
        now,
      ),
    );
    expect(parsed.error).toEqual({
      name: "Error",
      message: "token eyJ[REDACTED] vazou",
    });
  });

  it("adds the correlation id of a child logger to every line", () => {
    const lines: Array<[LogLevel, string]> = [];
    const log = createLogger("worker", {}, (level, line) =>
      lines.push([level, line]),
    ).child({ jobId: "j9" });
    log.info("job.started");
    log.error("job.failed", { attempt: 2 });
    expect(lines.map(([level]) => level)).toEqual(["info", "error"]);
    expect(lines.map(([, line]) => JSON.parse(line).jobId)).toEqual([
      "j9",
      "j9",
    ]);
  });
});
