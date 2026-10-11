import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  activeLanguages,
  invalidateI18nCache,
  loadMessages,
} from "@/core/i18n/store";
import {
  addLanguage,
  type LanguageActor,
  listLanguages,
  listTexts,
  resetText,
  saveText,
  setUserLocale,
  setWorkspaceLocale,
  updateLanguage,
} from "@/core/i18n/service";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const platformOwner = "d0000000-0000-4000-8000-000000000003";
const owner: LanguageActor = { userId: platformOwner, platformRole: "owner" };
const support: LanguageActor = {
  userId: platformOwner,
  platformRole: "support",
};
const wsOwner: RequestContext = { ...contextA, principalType: "user" };
const wsViewer: RequestContext = { ...wsOwner, userId: ids.userMultiOrg };

type Nested = { [k: string]: string | Nested };
const pick = (m: Nested, path: string) =>
  path.split(".").reduce<unknown>((n, p) => (n as Nested)?.[p], m);

describeDatabase("I1: languages of the dashboard", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const asPlatform = <T>(fn: Parameters<typeof withIdentityContext<T>>[2]) =>
    withIdentityContext(prisma, platformOwner, fn);

  async function cleanup() {
    await admin.$executeRawUnsafe(`delete from public.platform_translations`);
    await admin.$executeRawUnsafe(
      `delete from public.platform_languages where code not in ('pt-BR', 'en', 'es')`,
    );
    await admin.$executeRawUnsafe(
      `update public.platform_languages set status = 'active', is_default = (code = 'pt-BR')`,
    );
    await admin.$executeRawUnsafe(
      `update public.profiles set locale = null where id in ('${ids.userA}', '${ids.userMultiOrg}')`,
    );
    await admin.$executeRawUnsafe(
      `update public.workspaces set default_locale = null where id = '${ids.workspaceA}'`,
    );
    invalidateI18nCache();
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("lists pt-BR, en and es with their progress; only managers see it", async () => {
    const languages = await asPlatform((tx) => listLanguages(tx, owner));
    expect(languages.map((l) => [l.code, l.status, l.isDefault])).toEqual([
      ["pt-BR", "active", true],
      ["en", "active", false],
      ["es", "active", false],
    ]);
    for (const l of languages) expect(l.translated).toBe(l.total);
    await expect(
      asPlatform((tx) => listLanguages(tx, support)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("edits a text, keeps its arguments and goes back to the system text", async () => {
    await asPlatform((tx) =>
      saveText(tx, owner, "en", {
        key: "nav.items.core_overview",
        value: "Home",
      }),
    );
    invalidateI18nCache();
    expect(pick(await loadMessages("en"), "nav.items.core_overview")).toBe(
      "Home",
    );
    // pt-BR and es keep their texts.
    expect(pick(await loadMessages("es"), "nav.items.core_overview")).toBe(
      "Visión general",
    );
    const edited = await asPlatform((tx) =>
      listTexts(tx, owner, "en", { filter: "edited" }),
    );
    expect(edited.rows).toEqual([
      expect.objectContaining({
        key: "nav.items.core_overview",
        system: "Overview",
        edit: "Home",
        current: "Home",
      }),
    ]);
    // An argument lost or added breaks the screen: refused.
    for (const value of ["{total} texts", "texts", "{count texts"]) {
      await expect(
        asPlatform((tx) =>
          saveText(tx, owner, "en", { key: "languages.count", value }),
        ),
      ).rejects.toBeInstanceOf(AppError);
    }
    await expect(
      asPlatform((tx) =>
        saveText(tx, owner, "en", { key: "no.such.key", value: "x" }),
      ),
    ).rejects.toThrow(/não encontrado/);
    await asPlatform((tx) =>
      resetText(tx, owner, "en", "nav.items.core_overview"),
    );
    invalidateI18nCache();
    expect(pick(await loadMessages("en"), "nav.items.core_overview")).toBe(
      "Overview",
    );
  });

  it("adds a language as a draft, translates it and turns it on", async () => {
    await asPlatform((tx) =>
      addLanguage(tx, owner, { code: "fr", name: "Français" }),
    );
    await expect(
      asPlatform((tx) => addLanguage(tx, owner, { code: "fr", name: "x" })),
    ).rejects.toThrow(/já existe/);
    await expect(
      asPlatform((tx) => addLanguage(tx, owner, { code: "FRANCE", name: "x" })),
    ).rejects.toBeInstanceOf(AppError);
    invalidateI18nCache();
    expect((await activeLanguages()).map((l) => l.code)).not.toContain("fr");

    const missing = await asPlatform((tx) =>
      listTexts(tx, owner, "fr", { filter: "missing", size: 10 }),
    );
    expect(missing.total).toBeGreaterThan(50);
    await asPlatform((tx) =>
      saveText(tx, owner, "fr", {
        key: "nav.items.core_overview",
        value: "Vue d'ensemble",
      }),
    );
    // Without a file, the draft starts from the source texts.
    const fr = await loadMessages("fr");
    expect(pick(fr, "nav.items.core_executions")).toBe("Execuções");

    await asPlatform((tx) =>
      updateLanguage(tx, owner, "fr", { status: "active" }),
    );
    invalidateI18nCache();
    expect((await activeLanguages()).map((l) => l.code)).toContain("fr");
    expect(pick(await loadMessages("fr"), "nav.items.core_overview")).toBe(
      "Vue d'ensemble",
    );

    // The default moves; pt-BR never turns off.
    await asPlatform((tx) =>
      updateLanguage(tx, owner, "es", { is_default: true }),
    );
    const after = await asPlatform((tx) => listLanguages(tx, owner));
    expect(after.filter((l) => l.isDefault).map((l) => l.code)).toEqual(["es"]);
    await expect(
      asPlatform((tx) =>
        updateLanguage(tx, owner, "pt-BR", { status: "disabled" }),
      ),
    ).rejects.toThrow(/pt-BR/);
    await expect(
      asPlatform((tx) =>
        updateLanguage(tx, owner, "es", { status: "disabled" }),
      ),
    ).rejects.toThrow(/padrão/);
    await asPlatform((tx) =>
      updateLanguage(tx, owner, "pt-BR", { is_default: true }),
    );
  });

  it("sets the person's language and the workspace default", async () => {
    await withIdentityContext(prisma, ids.userA, (tx) =>
      setUserLocale(tx, ids.userA, "es"),
    );
    await expect(
      withIdentityContext(prisma, ids.userA, (tx) =>
        setUserLocale(tx, ids.userA, "de"),
      ),
    ).rejects.toThrow(/não está disponível/);
    expect(
      (
        await admin.profile.findUnique({
          where: { id: ids.userA },
          select: { locale: true },
        })
      )?.locale,
    ).toBe("es");

    await withContext(prisma, wsOwner, (tx) =>
      setWorkspaceLocale(tx, wsOwner, "en"),
    );
    await expect(
      withContext(prisma, wsViewer, (tx) =>
        setWorkspaceLocale(tx, wsViewer, "es"),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(
      (
        await admin.workspace.findUnique({
          where: { id: ids.workspaceA },
          select: { defaultLocale: true },
        })
      )?.defaultLocale,
    ).toBe("en");
    // The member reads the workspace default through the helper.
    const [, rows] = await prisma.$transaction([
      prisma.$executeRaw`select set_config('app.user_id', ${ids.userMultiOrg}, true)`,
      prisma.$queryRaw<{ locale: string | null }[]>`
        select private.ui_workspace_locale('workspace-a') as locale`,
    ]);
    expect(rows[0]?.locale).toBe("en");
    await withContext(prisma, wsOwner, (tx) =>
      setWorkspaceLocale(tx, wsOwner, null),
    );
  });
});
