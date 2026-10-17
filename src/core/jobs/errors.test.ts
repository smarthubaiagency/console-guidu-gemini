import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyJobFailure,
  SkipJobError,
  WORKSPACE_CLOSED_REASON,
  WorkspaceClosedError,
} from "./errors";

describe("job failures", () => {
  it("skips the run of a closed workspace quietly (WS1)", () => {
    expect(classifyJobFailure(new WorkspaceClosedError())).toEqual({
      action: "skip",
      message: "O workspace não está ativo.",
      quietReason: WORKSPACE_CLOSED_REASON,
    });
  });

  it("keeps the message of any other skip", () => {
    const outcome = classifyJobFailure(new SkipJobError("Sem acesso."));
    expect(outcome).toEqual({ action: "skip", message: "Sem acesso." });
  });

  it("retries an unknown failure", () => {
    expect(classifyJobFailure(new Error("boom")).action).toBe("retry");
  });
});
