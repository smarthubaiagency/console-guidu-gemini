/**
 * ============================================================================
 * File: e2e/notifications.spec.ts
 * Module: End-to-End Tests for the bell and notification preferences (CF3c)
 *
 * Maintenance Rationale:
 * - The bell sits on the right of the 60px header (ADR 0014) with the
 *   unread count; the list shows the notices written in the reader's
 *   language; "mark as read" (one and all) answers in the SmartStatusBanner
 *   (ADR 0016) and survives a reload.
 * - Minha conta › Notificações shows the event × channel matrix; every
 *   current event is essential, so every switch is locked on.
 * - Notices are seeded as the worker would write them (rig control route).
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedNotification,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { statusBanner } from "./support/status";

test("the bell counts, lists and marks notices as read", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("bell");
  const slug = `sino-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: "Empresa Sino",
    orgSlug: `org-${slug}`,
    wsName: "Loja Sino",
    wsSlug: slug,
    role: "owner",
  });
  await seedNotification(request, {
    email,
    eventType: "ai.agent.key_backup",
    data: { workspace: "Loja Sino", until: "2026-10-15T12:00:00.000Z" },
    linkUrl: `http://127.0.0.1/app/${slug}/settings/credentials`,
  });
  await seedNotification(request, {
    email,
    eventType: "billing.subscription.past_due",
    data: { organization: "Cliente Atrasado", periodEnd: "2026-10-01" },
  });

  await signIn(page, email);
  await page.goto(`/app/${slug}`);

  const bell = page.getByTestId("notification-bell");
  await expect(bell).toBeVisible();
  await expect(bell).toHaveAccessibleName("Avisos: 2 não lidos");
  await expect(page.getByTestId("notification-count")).toHaveText("2");

  await bell.click();
  const items = page.getByTestId("notification-item");
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId("notification-list")).toContainText(
    "Assinatura em atraso: Cliente Atrasado",
  );
  await expect(page.getByTestId("notification-list")).toContainText(
    "A chave de IA de Loja Sino falhou",
  );
  await expect(
    items
      .filter({ hasText: "A chave de IA de Loja Sino falhou" })
      .getByRole("menuitem", { name: /A chave de IA/ }),
  ).toHaveAttribute("href", /\/settings\/credentials$/);

  // One notice.
  const overdue = items.filter({ hasText: "Cliente Atrasado" });
  await overdue.getByTestId("notification-mark-read").click();
  await expect(statusBanner(page)).toContainText("Aviso marcado como lido.");
  await expect(overdue).toHaveAttribute("data-read", "true");
  await expect(page.getByTestId("notification-count")).toHaveText("1");

  // All of them.
  await page.getByTestId("notification-mark-all").click();
  await expect(statusBanner(page)).toContainText(
    "Todos os avisos foram marcados como lidos.",
  );
  await expect(page.getByTestId("notification-count")).toHaveCount(0);

  // Read stays read.
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("notification-bell")).toHaveAccessibleName(
    "Avisos",
  );
  await expect(page.getByTestId("notification-count")).toHaveCount(0);
  await page.getByTestId("notification-bell").click();
  await expect(page.getByTestId("notification-item")).toHaveCount(2);
  for (const item of await page.getByTestId("notification-item").all()) {
    await expect(item).toHaveAttribute("data-read", "true");
  }

  // The preferences, from the bell.
  await page.getByTestId("notification-preferences").click();
  await expect(page).toHaveURL(/\/app\/account\/notifications$/);
  await expect(
    page.getByRole("heading", { name: "Notificações", level: 1 }),
  ).toBeVisible();
  const rows = page.getByTestId("notification-preference-row");
  await expect(rows).toHaveCount(4);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute("data-locked", "true");
  }
  // Invitations and the test e-mail are not person preferences.
  await expect(page.locator('[data-event="invitation.created"]')).toHaveCount(
    0,
  );
  for (const channel of ["email", "app"]) {
    const toggle = page.getByTestId(
      `preference-billing.subscription.past_due-${channel}`,
    );
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("data-state", "checked");
    await expect(toggle).toHaveAccessibleName(/\(Obrigatório\)$/);
  }
  await expect(
    page.getByText(
      "Avisos de segurança e cobrança são obrigatórios e não podem ser desligados.",
    ),
  ).toBeVisible();
});

test("an account without notices shows an empty bell", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("bell-empty");
  const slug = `sino-vazio-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: "Empresa Vazia",
    orgSlug: `org-${slug}`,
    wsName: "Loja Vazia",
    wsSlug: slug,
    role: "owner",
  });
  await signIn(page, email);
  await page.goto(`/app/${slug}`);
  await expect(page.getByTestId("notification-count")).toHaveCount(0);
  await page.getByTestId("notification-bell").click();
  await expect(page.getByTestId("notification-empty")).toHaveText(
    "Nenhum aviso por aqui.",
  );
  await expect(page.getByTestId("notification-mark-all")).toHaveAttribute(
    "data-disabled",
  );
});
