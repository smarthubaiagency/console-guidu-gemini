import { describe, expect, it } from "vitest";

import {
  callbackUrl,
  newConnectFlow,
  openConnectFlow,
  sameNonce,
  sameTarget,
  sealConnectFlow,
} from "./connect-flow";
import { automationPath, windowPath } from "./target";

const user = "a0000000-0000-4000-8000-000000000031";

describe("connection flow cookie", () => {
  it("seals, opens and expires", () => {
    const flow = newConnectFlow(
      user,
      { scope: "app", workspaceSlug: "loja" },
      1000,
    );
    const sealed = sealConnectFlow({ ...flow, pending: "fake:x" });
    expect(sealed).not.toContain("fake:x");
    expect(openConnectFlow(sealed, 2000)).toEqual({
      ...flow,
      pending: "fake:x",
    });
    expect(openConnectFlow(sealed, flow.expiresAt + 1)).toBeNull();
    expect(openConnectFlow("garbage", 2000)).toBeNull();
  });

  it("compares nonces and targets", () => {
    expect(sameNonce("abc", "abc")).toBe(true);
    expect(sameNonce("abc", "abd")).toBe(false);
    const id = "b0000000-0000-4000-8000-000000000001";
    expect(
      sameTarget(
        { scope: "admin", workspaceId: id },
        { scope: "admin", workspaceId: id },
      ),
    ).toBe(true);
    expect(
      sameTarget(
        { scope: "admin", workspaceId: id },
        { scope: "app", workspaceSlug: id },
      ),
    ).toBe(false);
  });

  it("builds the return and page addresses", () => {
    expect(callbackUrl("https://painel.test", "n1")).toBe(
      "https://painel.test/auth/google-business/callback?state=n1",
    );
    expect(
      windowPath({ scope: "app", workspaceSlug: "loja" }, "permissions", {
        missing: "manage_profile",
      }),
    ).toBe(
      "/app/loja/google-business?addLocation=permissions&missing=manage_profile",
    );
    const id = "b0000000-0000-4000-8000-000000000001";
    expect(windowPath({ scope: "admin", workspaceId: id }, "choose")).toBe(
      `/admin/customers?workspace=${id}&addLocation=choose`,
    );
    expect(automationPath({ scope: "admin", workspaceId: id }, "l1")).toBe(
      `/admin/customers/workspaces/${id}/locations/l1`,
    );
  });
});
