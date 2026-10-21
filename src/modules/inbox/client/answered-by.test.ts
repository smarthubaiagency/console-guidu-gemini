import { describe, expect, it } from "vitest";

import { agentEventIds } from "./room-data";

const AGENT = "@_guidu_a_abcdefghijklmnop:hs.test";
const CONSUMER = "@_guidu_c_abcdefghijklmnop:hs.test";
const ATTENDANT = "@u_abcdefghijklmnopqrstuvwx:hs.test";

describe("agentEventIds (GF2)", () => {
  it("asks about the events a GUIDS sent, and only those", () => {
    expect(
      agentEventIds([
        { id: "$1", sender: CONSUMER },
        { id: "$2", sender: AGENT },
        { id: "$3", sender: ATTENDANT },
        { id: "$4", sender: AGENT },
        { id: "local-1", sender: AGENT },
      ]),
    ).toEqual(["$2", "$4"]);
  });
});
