/**
 * ============================================================================
 * File: e2e/platform-events.spec.ts
 * Module: End-to-End Tests for Plataforma › Eventos (H1, ADR 0022)
 *
 * Maintenance Rationale:
 * - The platform lists the situation of the Event Hub's events with
 *   filters and opens one in the drawer (ADR 0015): seal, chain and
 *   deliveries, never the data.
 * - "Ver dados" exists only with the keychain capability, which the
 *   platform owner grants in Usuários da Plataforma; opening asks for a
 *   reason (field error next to the field) and answers in the
 *   SmartStatusBanner (ADR 0016).
 * - The event is seeded sealed with the rig's key (control route), as
 *   `emitEvent` writes it.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  seedEvent,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

test("the platform reads the situation of an event and opens its data only with keychain", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const email = uniqueEmail("events-owner");
  const stamp = Date.now();
  const orgName = `Empresa Eventos ${stamp}`;
  const wsSlug = `ws-eventos-${stamp}`;
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await seedWorkspace(request, {
    email,
    orgName,
    orgSlug: `org-eventos-${stamp}`,
    wsName: "Loja Eventos",
    wsSlug,
    role: "owner",
  });
  const { id: eventId } = await seedEvent(request, {
    workspaceSlug: wsSlug,
    type: "ai.agent.key_backup",
    module: "ai_agents",
    data: { workspaceName: "Loja Eventos E2E", agentName: null },
  });

  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  // The list, from the sidebar, with the type filter.
  await page.goto("/platform");
  await page
    .getByRole("link", { name: "Eventos", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/platform\/events$/);
  await expect(
    page.getByRole("heading", { name: "Eventos", level: 1 }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Tipo").selectOption("ai.agent.key_backup");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/type=ai\.agent\.key_backup/);
  const row = page.getByTestId("event-row").filter({ hasText: orgName });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("1 entrega");

  // The drawer: situation, seal and deliveries; no data, no "Ver dados".
  await row.click();
  await expect(page).toHaveURL(new RegExp(`event=${eventId}`));
  const panel = page.getByTestId("event-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("event-panel-type")).toHaveText(
    "ai.agent.key_backup",
  );
  await expect(panel).toContainText(eventId);
  await expect(panel.getByTestId("event-chain")).toHaveText("Corrente íntegra");
  await expect(panel.getByTestId("event-integrity")).toHaveText(
    "Ainda não conferido",
  );
  await expect(panel.getByTestId("event-delivery")).toContainText("E-mail");
  await expect(panel.getByTestId("event-delivery")).toContainText(
    "Não enviado",
  );
  await expect(panel).not.toContainText("Loja Eventos E2E");
  await expect(panel.getByTestId("event-keychain")).toHaveCount(0);

  // The owner grants keychain to themselves in Usuários da Plataforma.
  await page.goto("/platform/users");
  const team = page.getByTestId("platform-team");
  await expect(team).toBeVisible();
  await page.waitForLoadState("networkidle");
  const mine = team
    .getByTestId("platform-team-member")
    .filter({ hasText: email.split("@")[0]! });
  await mine.getByRole("switch").click();
  await expect(statusBanner(page)).toContainText("Acesso total concedido.");

  // "Ver dados": the reason first, then the data.
  await page.goto(`/platform/events?event=${eventId}`);
  const keychain = page.getByTestId("event-keychain");
  await expect(keychain).toBeVisible();
  await page.waitForLoadState("networkidle");
  await keychain.getByRole("button", { name: "Ver dados" }).click();
  await keychain.getByLabel("Motivo").fill("curto");
  await keychain.getByRole("button", { name: "Ver dados" }).click();
  await expect(keychain.getByTestId("event-reason-hint")).toHaveText(
    "Escreva o motivo (de 10 a 500 caracteres).",
  );
  await keychain.getByLabel("Motivo").fill("Chamado 4521 do cliente");
  await keychain.getByRole("button", { name: "Ver dados" }).click();
  await expect(statusBanner(page)).toContainText(
    "Dados abertos. A abertura foi registrada na auditoria.",
  );
  await expect(keychain.getByTestId("event-data")).toContainText(
    "Loja Eventos E2E",
  );
});
