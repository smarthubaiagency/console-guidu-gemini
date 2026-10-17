/**
 * ============================================================================
 * File: e2e/event-rules.spec.ts
 * Module: End-to-End Tests for the H2 of the Event Hub (ADR 0022)
 *
 * Maintenance Rationale:
 * - Configurações › Notificações of the workspace saves a rule of the
 *   cascade (delivery in the daily digest) and answers in the
 *   SmartStatusBanner (ADR 0016).
 * - Access to the data of an event (ADR 0022 item 7): the platform support
 *   asks in the event's drawer (reason and reference; a short reason is a
 *   field error), the worker records the request in the hub, the owner of
 *   the workspace approves in Eventos, the support reads the data, and the
 *   customer sees "dados vistos por…, autorizado por…" in the event's trace.
 * - One person plays both sides (platform owner and workspace owner), as
 *   in platform-events.spec.ts; the database rules are proven by
 *   tests/core/event-rules-rls.sql.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  runJobs,
  seedEvent,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

test("a rule is saved, access to an event is asked, approved, used and traced", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("event-rules");
  const stamp = Date.now();
  const orgName = `Empresa Regras ${stamp}`;
  const wsSlug = `ws-regras-${stamp}`;
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await seedWorkspace(request, {
    email,
    orgName,
    orgSlug: `org-regras-${stamp}`,
    wsName: "Loja Regras",
    wsSlug,
    role: "owner",
  });
  const { id: eventId } = await seedEvent(request, {
    workspaceSlug: wsSlug,
    type: "ai.agent.key_backup",
    module: "ai_agents",
    data: { workspaceName: "Loja Regras E2E", agentName: null },
  });

  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  // 1. A rule of the workspace: the analyses of a ficha go to the digest.
  await page.goto(`/app/${wsSlug}/settings/notifications`);
  await expect(
    page.getByRole("heading", { name: "Notificações", level: 1 }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  const delivery = page.getByTestId(
    "rule-google_business.analyses_done-delivery",
  );
  await delivery.selectOption("digest");
  await expect(delivery).toHaveValue("digest");
  await page.getByRole("button", { name: "Salvar regras" }).click();
  await expect(statusBanner(page)).toContainText("Regras de aviso salvas.");
  await page.reload();
  await expect(
    page.getByTestId("rule-google_business.analyses_done-delivery"),
  ).toHaveValue("digest");
  await expect(
    page.locator(
      '[data-testid="notification-rule"][data-event="google_business.analyses_done"]',
    ),
  ).toContainText("Ajustado aqui");

  // 2. The platform asks for the data of the event.
  await page.goto(`/platform/events?event=${eventId}`);
  const panel = page.getByTestId("event-panel");
  await expect(panel).toBeVisible();
  await page.waitForLoadState("networkidle");
  const access = panel.getByTestId("access-request");
  await access.getByRole("button", { name: "Pedir acesso aos dados" }).click();
  await access.getByLabel("Motivo").fill("curto");
  await access.getByLabel("Referência da solicitação").fill("CH-4521");
  await access.getByRole("button", { name: "Enviar pedido" }).click();
  await expect(access.getByTestId("access-reason-error")).toHaveText(
    "Escreva o motivo (de 10 a 500 caracteres).",
  );
  await access
    .getByLabel("Motivo")
    .fill("Chamado 4521 do cliente sobre o aviso");
  await access.getByRole("button", { name: "Enviar pedido" }).click();
  await expect(statusBanner(page)).toContainText(
    "Pedido de acesso enviado ao cliente.",
  );
  await expect(panel).toContainText("Aguardando a decisão do cliente.");

  // The worker records the request in the hub and tells the customer.
  await expect.poll(() => runJobs(request), { timeout: 60_000 }).toBe(0);

  // 3. The owner approves in Eventos.
  await page.goto(`/app/${wsSlug}/events`);
  await expect(
    page.getByRole("heading", { name: "Eventos", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("events-row")
      .filter({ hasText: "Pedido de acesso aos dados" }),
  ).toHaveCount(1);
  const grant = page.getByTestId("access-grant");
  await expect(grant).toHaveCount(1);
  await expect(grant).toContainText("Suporte da plataforma pediu acesso");
  await expect(grant).toContainText("CH-4521");
  await page.waitForLoadState("networkidle");
  await grant.getByRole("button", { name: "Aprovar" }).click();
  await expect(statusBanner(page)).toContainText("Acesso aprovado.");
  await expect(page.getByTestId("access-grant")).toHaveAttribute(
    "data-status",
    "approved",
  );

  // 4. The support reads the data, recorded.
  await page.goto(`/platform/events?event=${eventId}`);
  const data = page.getByTestId("grant-data");
  await expect(data).toBeVisible();
  await page.waitForLoadState("networkidle");
  await data.getByRole("button", { name: "Ver dados" }).click();
  await expect(statusBanner(page)).toContainText(
    "Dados abertos. A visualização foi registrada e o cliente vê.",
  );
  await expect(data.getByTestId("grant-event-data")).toContainText(
    "Loja Regras E2E",
  );

  // 5. The customer sees the view and the trace of the event.
  await page.goto(`/app/${wsSlug}/events?event=${eventId}`);
  const own = page.getByTestId("event-panel");
  await expect(own).toBeVisible();
  await expect(own.getByTestId("event-panel-data")).toContainText(
    "Loja Regras E2E",
  );
  await expect(own.getByTestId("event-trace-deliveries")).toBeVisible();
  await expect(own.getByTestId("event-data-view")).toHaveText(
    /Dados vistos por suporte da plataforma, autorizado por Você/,
  );
  await expect(own.getByTestId("event-trace-audit")).toContainText(
    "event.data.viewed",
  );
});
