import { describe, expect, it } from "vitest";

import {
  resolveServiceSettings,
  SERVICE_DEFAULTS,
  shapeAnswer,
} from "./settings";

/** Service settings of the integration (A5b). */

describe("resolveServiceSettings", () => {
  it("takes the inbox's own, then the connection's, then ours", () => {
    const config = {
      service: {
        defaults: { grouping_seconds: 8, max_messages: 2 },
        inboxes: { "3": { max_messages: 4 } },
      },
    };
    expect(resolveServiceSettings(config, "3")).toEqual({
      ...SERVICE_DEFAULTS,
      grouping_seconds: 8,
      max_messages: 4,
    });
    expect(resolveServiceSettings(config, "9")).toMatchObject({
      grouping_seconds: 8,
      max_messages: 2,
    });
    expect(resolveServiceSettings({}, null)).toEqual(SERVICE_DEFAULTS);
  });

  it("ignores a broken service block", () => {
    expect(
      resolveServiceSettings(
        { service: { defaults: { max_messages: 99 } } },
        null,
      ),
    ).toEqual(SERVICE_DEFAULTS);
  });
});

describe("shapeAnswer", () => {
  it("joins the extra messages into the last part", () => {
    expect(
      shapeAnswer(["a", " ", "b", "c", "d"], { max_messages: 3 }, 4000),
    ).toEqual(["a", "b", "c\n\nd"]);
    expect(shapeAnswer(["a", "b"], { max_messages: 1 }, 4000)).toEqual([
      "a\n\nb",
    ]);
  });

  it("keeps each part within the channel's limit", () => {
    expect(shapeAnswer(["x".repeat(10)], { max_messages: 3 }, 4)).toEqual([
      "xxxx",
    ]);
  });
});
