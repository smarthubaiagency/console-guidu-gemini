import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import {
  adminAuditContext,
  requirePlatformPermission,
} from "@/core/module-runtime/settings";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  flattenMessages,
  keepsMessageArguments,
  LOCALE_CODE,
  messageArguments,
  SOURCE_LOCALE,
} from "./locales";
import { fileMessages, invalidateI18nCache, SOURCE_MESSAGES } from "./store";

/**
 * Languages of the dashboard (I1): Plataforma › Configurações › Idiomas,
 * the person's language and the workspace default.
 *
 * The texts live in the code (`src/i18n/messages`, pt-BR is the source);
 * the platform edits any of them per language, and a language added here
 * starts from the source texts until translated. Machine translation fills
 * the same edits with `origin = machine` (I6, `./machine`); saving a text
 * here makes it manual, i.e. reviewed.
 */

export type LanguageActor = Readonly<{
  userId: string;
  platformRole: PlatformAdminRoleKey | null;
}>;

export type LanguageView = Readonly<{
  code: string;
  name: string;
  status: "active" | "draft" | "disabled";
  isDefault: boolean;
  isSource: boolean;
  /** Keys with a text of this language (file or edit), out of `total`. */
  translated: number;
  total: number;
  edits: number;
}>;

export type TextRow = Readonly<{
  key: string;
  source: string;
  /** Text shipped in the code for this language, if any. */
  system: string | null;
  edit: string | null;
  origin: "manual" | "machine" | null;
  /** What the dashboard shows. */
  current: string;
}>;

function manage(actor: LanguageActor) {
  requirePlatformPermission(
    actor.platformRole,
    Permissions.PLATFORM_LANGUAGES_MANAGE,
  );
}

function invalid(message: string): AppError {
  return new AppError({ code: "invalid_input", safeMessage: message });
}

function audit(
  tx: ContextTransaction,
  actor: LanguageActor,
  action: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
) {
  return recordAudit(tx, adminAuditContext(actor.userId), {
    action,
    resourceType: "platform_language",
    resourceId,
    result: "success",
    ...(metadata ? { metadata } : {}),
  });
}

const SOURCE_FLAT = (): Record<string, string> =>
  flattenMessages(SOURCE_MESSAGES);

export async function listLanguages(
  tx: ContextTransaction,
  actor: LanguageActor,
): Promise<LanguageView[]> {
  manage(actor);
  const [rows, edits] = await Promise.all([
    tx.platformLanguage.findMany({
      orderBy: [{ position: "asc" }, { code: "asc" }],
    }),
    tx.platformTranslation.groupBy({ by: ["locale"], _count: { _all: true } }),
  ]);
  const source = SOURCE_FLAT();
  const total = Object.keys(source).length;
  const editKeys = await tx.platformTranslation.findMany({
    select: { locale: true, key: true },
  });
  return rows.map((row) => {
    const file = fileMessages(row.code);
    const fromFile = file ? flattenMessages(file) : {};
    const keys = new Set([
      ...Object.keys(fromFile).filter((k) => k in source),
      ...editKeys
        .filter((e) => e.locale === row.code && e.key in source)
        .map((e) => e.key),
    ]);
    return {
      code: row.code,
      name: row.name,
      status: row.status as LanguageView["status"],
      isDefault: row.isDefault,
      isSource: row.code === SOURCE_LOCALE,
      translated: row.code === SOURCE_LOCALE ? total : keys.size,
      total,
      edits: edits.find((e) => e.locale === row.code)?._count._all ?? 0,
    };
  });
}

export const LanguageInput = z
  .object({
    code: z
      .string()
      .trim()
      .regex(LOCALE_CODE, "Use um código BCP 47, como fr, it ou es-MX."),
    name: z.string().trim().min(1, "Informe o nome.").max(60),
  })
  .strict();

export async function addLanguage(
  tx: ContextTransaction,
  actor: LanguageActor,
  input: unknown,
): Promise<void> {
  manage(actor);
  const parsed = LanguageInput.safeParse(input);
  if (!parsed.success) {
    throw invalid(parsed.error.issues[0]?.message ?? "Idioma inválido.");
  }
  const { code, name } = parsed.data;
  if (await tx.platformLanguage.findUnique({ where: { code } })) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Este idioma já existe.",
    });
  }
  const last = await tx.platformLanguage.aggregate({
    _max: { position: true },
  });
  await tx.platformLanguage.create({
    data: {
      code,
      name,
      status: "draft",
      position: Math.min((last._max.position ?? 0) + 1, 1000),
      createdBy: actor.userId,
    },
  });
  await audit(tx, actor, "platform.language.create", code);
  invalidateI18nCache();
}

export const LanguageUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    status: z.enum(["active", "draft", "disabled"]).optional(),
    is_default: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nada para alterar.");

export async function updateLanguage(
  tx: ContextTransaction,
  actor: LanguageActor,
  code: string,
  input: unknown,
): Promise<void> {
  manage(actor);
  const parsed = LanguageUpdateInput.safeParse(input);
  if (!parsed.success) {
    throw invalid(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const current = await tx.platformLanguage.findUnique({ where: { code } });
  if (!current) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Idioma não encontrado.",
    });
  }
  const d = parsed.data;
  const status = d.status ?? current.status;
  if (code === SOURCE_LOCALE && status !== "active") {
    throw invalid("O idioma de origem (pt-BR) fica sempre ativo.");
  }
  if ((current.isDefault || d.is_default) && status !== "active") {
    throw invalid("O idioma padrão precisa estar ativo.");
  }
  if (d.is_default && !current.isDefault) {
    await tx.platformLanguage.updateMany({
      where: { isDefault: true },
      data: { isDefault: false, updatedBy: actor.userId },
    });
  }
  await tx.platformLanguage.update({
    where: { code },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.is_default ? { isDefault: true } : {}),
      updatedBy: actor.userId,
    },
  });
  await audit(tx, actor, "platform.language.update", code, {
    fields: Object.keys(d),
  });
  invalidateI18nCache();
}

export const TextsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "edited", "missing", "machine"]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().int().min(10).max(200).default(50),
});

/** Texts of a language, for the translation screen. */
export async function listTexts(
  tx: ContextTransaction,
  actor: LanguageActor,
  code: string,
  query: z.input<typeof TextsQuery> = {},
): Promise<{ rows: TextRow[]; total: number; page: number; pages: number }> {
  manage(actor);
  const q = TextsQuery.parse(query);
  if (!(await tx.platformLanguage.findUnique({ where: { code } }))) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Idioma não encontrado.",
    });
  }
  const source = SOURCE_FLAT();
  const file = fileMessages(code);
  const system = file ? flattenMessages(file) : {};
  const edits = new Map(
    (await tx.platformTranslation.findMany({ where: { locale: code } })).map(
      (e) => [e.key, e],
    ),
  );
  const needle = q.search?.toLowerCase();
  const all = Object.entries(source)
    .map(([key, text]): TextRow => {
      const edit = edits.get(key);
      const sys = code === SOURCE_LOCALE ? text : (system[key] ?? null);
      return {
        key,
        source: text,
        system: sys,
        edit: edit?.value ?? null,
        origin: (edit?.origin as TextRow["origin"]) ?? null,
        current: edit?.value ?? sys ?? text,
      };
    })
    .filter((row) =>
      q.filter === "edited"
        ? row.edit !== null
        : q.filter === "missing"
          ? row.edit === null && row.system === null
          : q.filter === "machine"
            ? row.origin === "machine"
            : true,
    )
    .filter(
      (row) =>
        !needle ||
        row.key.toLowerCase().includes(needle) ||
        row.source.toLowerCase().includes(needle) ||
        row.current.toLowerCase().includes(needle),
    );
  const pages = Math.max(1, Math.ceil(all.length / q.size));
  const page = Math.min(q.page, pages);
  return {
    rows: all.slice((page - 1) * q.size, page * q.size),
    total: all.length,
    page,
    pages,
  };
}

export const TextInput = z
  .object({
    key: z.string().min(1).max(200),
    value: z.string().trim().min(1, "Informe o texto.").max(5000),
    origin: z.enum(["manual", "machine"]).default("manual"),
  })
  .strict();

/** Saves the text of a key in a language (an edit over the code's text). */
export async function saveText(
  tx: ContextTransaction,
  actor: LanguageActor,
  code: string,
  input: unknown,
): Promise<void> {
  manage(actor);
  const parsed = TextInput.safeParse(input);
  if (!parsed.success) {
    throw invalid(parsed.error.issues[0]?.message ?? "Texto inválido.");
  }
  const { key, value, origin } = parsed.data;
  const source = SOURCE_FLAT()[key];
  if (source === undefined) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Texto não encontrado.",
    });
  }
  if (!(await tx.platformLanguage.findUnique({ where: { code } }))) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Idioma não encontrado.",
    });
  }
  // The dashboard fills the same arguments; a lost {count} would break it.
  const expected = messageArguments(source);
  if (!keepsMessageArguments(source, value)) {
    throw invalid(
      expected.length
        ? `Mantenha as variáveis do texto original: ${expected.map((a) => `{${a}}`).join(", ")}.`
        : "O texto não pode ter chaves { }.",
    );
  }
  await tx.platformTranslation.upsert({
    where: { locale_key: { locale: code, key } },
    create: { locale: code, key, value, origin, updatedBy: actor.userId },
    update: { value, origin, updatedBy: actor.userId },
  });
  await audit(tx, actor, "platform.translation.update", code, { key, origin });
  invalidateI18nCache();
}

/** Back to the text shipped in the code. */
export async function resetText(
  tx: ContextTransaction,
  actor: LanguageActor,
  code: string,
  key: string,
): Promise<void> {
  manage(actor);
  await tx.platformTranslation.deleteMany({ where: { locale: code, key } });
  await audit(tx, actor, "platform.translation.reset", code, { key });
  invalidateI18nCache();
}

async function assertActiveLanguage(
  tx: ContextTransaction,
  code: string | null,
): Promise<void> {
  if (code === null) return;
  if (!LOCALE_CODE.test(code)) throw invalid("Idioma inválido.");
  const rows = await tx.$queryRaw<{ code: string }[]>`
    select code from private.ui_languages() where code = ${code}
  `;
  if (!rows[0]) throw invalid("Este idioma não está disponível.");
}

/** The person's language (null follows the workspace); identity context. */
export async function setUserLocale(
  tx: ContextTransaction,
  userId: string,
  locale: string | null,
): Promise<void> {
  await assertActiveLanguage(tx, locale);
  await tx.profile.update({ where: { id: userId }, data: { locale } });
}

/** Default language of the workspace (owner and admin). */
export async function setWorkspaceLocale(
  tx: ContextTransaction,
  ctx: RequestContext,
  locale: string | null,
): Promise<void> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_SETTINGS_UPDATE,
  );
  await assertActiveLanguage(tx, locale);
  // Only default_locale is granted; Prisma would also set updated_at.
  const changed = await tx.$executeRaw(
    Prisma.sql`update public.workspaces set default_locale = ${locale}
               where id = ${ctx.workspaceId}::uuid`,
  );
  if (changed !== 1) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Workspace não encontrado.",
    });
  }
  await recordAudit(tx, ctx, {
    action: "workspace.locale.update",
    resourceType: "workspace",
    resourceId: ctx.workspaceId,
    result: "success",
    metadata: { locale },
  });
}
