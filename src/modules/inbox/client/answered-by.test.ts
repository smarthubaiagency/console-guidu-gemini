import { describe, expect, it } from "vitest";

import { answeredByOf } from "./room-data";

const AGENT = "@_guidu_a_abcdefghijklmnop:hs.test";
const CONSUMER = "@_guidu_c_abcdefghijklmnop:hs.test";

describe("answeredByOf (GF2)", () => {
  it("reads the mark of an answer written by a GUIDS", () => {
    expect(answeredByOf(AGENT, { "io.guidu.answered_by": "seller" })).toBe(
      "seller",
    );
    expect(answeredByOf(AGENT, { "io.guidu.answered_by": "attendant" })).toBe(
      "attendant",
    );
  });

  it("ignores an unknown role, a missing mark and any sender that is not a GUIDS", () => {
    expect(answeredByOf(AGENT, { "io.guidu.answered_by": "ops" })).toBe(
      undefined,
    );
    expect(answeredByOf(AGENT, { body: "oi" })).toBe(undefined);
    // A contact could write the same key: the team's window ignores it.
    expect(answeredByOf(CONSUMER, { "io.guidu.answered_by": "seller" })).toBe(
      undefined,
    );
    expect(
      answeredByOf("@u_abcdefghijklmnopqrstuvwx:hs.test", {
        "io.guidu.answered_by": "seller",
      }),
    ).toBe(undefined);
  });
});
