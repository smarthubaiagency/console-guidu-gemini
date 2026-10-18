/**
 * ============================================================================
 * File: e2e/partner-proposals.spec.ts
 * Module: H4 — Propostas no /admin (Central de Eventos, ADR 0020)
 *
 * Maintenance Rationale:
 * - A managed company has a pending proposal (seeded with the hash of its
 *   content). That the customer only follows is covered by
 *   tests/core/event-handoffs.test.ts.
 * - The managing partner's owner, with MFA, opens Admin › Propostas, checks
 *   what will be done and the content fingerprint and approves; the hub
 *   hands the execution to `proposals.execute` (the worker) and the
 *   proposal ends executed. The trace of `proposals.approved` in Admin ›
 *   Eventos shows the hand-off done.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  runJobs,
  seedPartner,
  seedProposal,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { totpCode } from "./support/totp";

test("the managing partner approves a proposal from /admin and the hub executes it", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const wsSlug = `prop-ger-${stamp}`;
  const ownerEmail = uniqueEmail("proposals-managed-owner");
  await createIdentity(request, ownerEmail);
  await seedWorkspace(request, {
    email: ownerEmail,
    orgName: `Gerenciada ${stamp}`,
    orgSlug: `prop-ger-org-${stamp}`,
    wsName: `Loja Gerenciada ${stamp}`,
    wsSlug,
    role: "owner",
  });

  const host = `prop-parceiro-${stamp}.localhost`;
  const partnerEmail = uniqueEmail("proposals-partner");
  await createIdentity(request, partnerEmail);
  const { partnerId } = await seedPartner(request, {
    slug: `prop-parceiro-${stamp}`,
    name: `Agência Propostas ${stamp}`,
    host,
    memberEmail: partnerEmail,
    role: "partner_owner",
  });
  const name = `Lia Gerenciada ${stamp}`;
  const { id: proposalId } = await seedProposal(request, {
    workspaceSlug: wsSlug,
    partnerId,
    name,
  });

  const context = await browser.newContext({
    baseURL: `http://${host}:${RIG.appPort}`,
    locale: "pt-BR",
  });
  const admin = await context.newPage();
  await signIn(admin, partnerEmail);
  await admin.goto("/app/account/security");
  await admin.getByTestId("start-mfa-enrolment").click();
  const secret = (await admin.getByTestId("totp-secret").textContent())?.trim();
  await admin.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await admin.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(admin.getByTestId("mfa-factors")).toBeVisible();

  await admin.goto("/admin/proposals");
  const open = admin.getByTestId("partner-proposals-open");
  await expect(open.getByTestId("partner-proposal-row")).toHaveCount(1);
  await expect(open).toContainText(`Gerenciada ${stamp}`);
  await open.getByRole("link", { name: /Adicionar contato/ }).click();
  const panel = admin.getByTestId("partner-proposal-panel");
  await expect(panel.getByTestId("partner-proposal-fields")).toContainText(
    name,
  );
  await expect(panel.getByTestId("partner-proposal-hash")).toHaveText(
    /^[0-9a-f]{16}$/,
  );
  await expect(panel).toContainText("Lead da conversa");
  await admin.waitForLoadState("networkidle");
  await panel.getByRole("button", { name: "Aprovar e executar" }).click();
  // The panel re-renders with the decision (as in /app, F4d).
  await expect(admin.getByTestId("partner-proposal-status")).toHaveText(
    "Aprovada, na fila",
  );

  expect(await runJobs(request)).toBe(0);

  await admin.goto(`/admin/proposals?proposal=${proposalId}`);
  await expect(admin.getByTestId("partner-proposal-status")).toHaveText(
    "Executada",
  );
  await expect(
    admin
      .getByTestId("partner-proposals-history")
      .getByTestId("partner-proposal-row"),
  ).toHaveCount(1);

  // The trace of the approval shows the hand-off to the execution.
  await admin.goto("/admin/events");
  await admin
    .getByTestId("events-row")
    .filter({ hasText: "Proposta aprovada" })
    .first()
    .click();
  const handoff = admin.getByTestId("event-trace-handoff");
  await expect(handoff).toHaveAttribute("data-subscriber", "proposals.execute");
  await expect(handoff).toHaveAttribute("data-status", "done");
  await context.close();
});
