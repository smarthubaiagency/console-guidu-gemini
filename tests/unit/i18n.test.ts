import { describe, expect, it } from "vitest";

import {
  balancedBraces,
  chooseLocale,
  flattenMessages,
  type Messages,
  mergeMessages,
  messageArguments,
  negotiateLocale,
  unflattenMessages,
} from "@/core/i18n/locales";
import { workspaceSlugOf } from "@/core/i18n/path";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import ptBR from "@/i18n/messages/pt-BR.json";

describe("languages of the dashboard (I1)", () => {
  it("ships en and es with every key of the pt-BR source and its arguments", () => {
    const source = flattenMessages(ptBR);
    for (const [code, file] of [
      ["en", en],
      ["es", es],
    ] as const) {
      const flat = flattenMessages(file as Messages);
      expect(Object.keys(flat).sort(), code).toEqual(
        Object.keys(source).sort(),
      );
      for (const [key, text] of Object.entries(source)) {
        expect(messageArguments(flat[key]!), `${code} ${key}`).toEqual(
          messageArguments(text),
        );
        expect(balancedBraces(flat[key]!), `${code} ${key}`).toBe(true);
      }
    }
  });

  it("chooses the person, then the workspace, then the platform", () => {
    const active = ["pt-BR", "en", "es"];
    expect(
      chooseLocale(
        { user: "es", workspace: "en", platformDefault: "pt-BR" },
        active,
      ),
    ).toBe("es");
    expect(
      chooseLocale(
        { user: null, workspace: "en", platformDefault: "pt-BR" },
        active,
      ),
    ).toBe("en");
    // A language turned off falls through.
    expect(
      chooseLocale(
        { user: "fr", workspace: null, platformDefault: "pt-BR" },
        active,
      ),
    ).toBe("pt-BR");
    expect(
      chooseLocale({ browser: "es", platformDefault: "pt-BR" }, active),
    ).toBe("es");
  });

  it("negotiates the browser language by quality and base language", () => {
    const active = ["pt-BR", "en", "es"];
    expect(negotiateLocale("es-AR,es;q=0.9,en;q=0.8", active)).toBe("es");
    expect(negotiateLocale("fr-FR,en;q=0.5", active)).toBe("en");
    expect(negotiateLocale("pt", active)).toBe("pt-BR");
    expect(negotiateLocale("en;q=0.2,pt-BR;q=0.9", active)).toBe("pt-BR");
    expect(negotiateLocale("de", active)).toBeNull();
    expect(negotiateLocale(null, active)).toBeNull();
  });

  it("merges source, file and edits only over the source keys", () => {
    const source = { a: { b: "B", c: "C {n}" }, d: "D" };
    const file = { a: { b: "B-en" }, gone: "x" };
    const merged = mergeMessages(source, file, {
      "a.c": "C-edit {n}",
      "not.there": "y",
    });
    expect(merged).toEqual({ a: { b: "B-en", c: "C-edit {n}" }, d: "D" });
    expect(unflattenMessages(flattenMessages(source))).toEqual(source);
  });

  it("reads ICU arguments and braces", () => {
    expect(messageArguments("{count} textos de {name}")).toEqual([
      "count",
      "name",
    ]);
    expect(
      messageArguments("{count, plural, one {# item} other {# itens}}"),
    ).toEqual(["count"]);
    expect(balancedBraces("a {b} c")).toBe(true);
    expect(balancedBraces("a {b c")).toBe(false);
    expect(balancedBraces("a } b {")).toBe(false);
  });

  it("finds the workspace in the path", () => {
    expect(workspaceSlugOf("/app/acme/settings")).toBe("acme");
    expect(workspaceSlugOf("/app/acme")).toBe("acme");
    expect(workspaceSlugOf("/app/account/language")).toBeNull();
    expect(workspaceSlugOf("/platform")).toBeNull();
    expect(workspaceSlugOf(null)).toBeNull();
  });
});
