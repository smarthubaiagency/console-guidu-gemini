/**
 * ============================================================================
 * File: e2e/proposals.spec.ts
 * Module: End-to-End Tests for proposals with human approval (F4d, §17.4)
 *
 * Maintenance Rationale:
 * - An assistant (JSON-RPC client with a `proposals:write` key) proposes a
 *   new contact; nothing is created. The owner, with MFA, opens Propostas,
 *   checks the content and approves; the worker runs it and the contact
 *   appears in the CRM. A second proposal is rejected and never runs.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  runJobs,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { totpCode } from "./support/totp";

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

test("an assistant proposes a contact and the owner approves it", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("proposals-owner");
  const wsSlug = `prop-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Propostas ${stamp}`,
    orgSlug: `prop-org-${stamp}`,
    wsName: `Workspace Propostas ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await enrolMfa(page);

  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar CRM" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();

  await page.goto(`/app/${wsSlug}/settings/mcp`);
  await page.getByRole("button", { name: "Emitir Nova Chave" }).click();
  await page
    .getByPlaceholder(/Conector Cursor|Nome da Chave/i)
    .fill("E2E Propostas");
  await page.locator('input[type="checkbox"][value="proposals:write"]').check();
  await page.getByRole("button", { name: /Emitir Chave/i }).click();
  const key = (
    await page
      .getByText(/gdu_live_[a-f0-9]{64}/)
      .first()
      .innerText()
  ).match(/gdu_live_[a-f0-9]{64}/)?.[0];
  expect(key).toBeTruthy();

  const propose = async (name: string, idempotencyKey: string) => {
    const response = await request.post("/mcp/workspace", {
      headers: { ...HEADERS, authorization: `Bearer ${key}` },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "propose_operation",
          arguments: {
            operation: "crm.contacts.create",
            payload: { name, companyName: "Cliente E2E" },
            idempotencyKey,
            reason: "Contato citado na conversa",
          },
        },
      },
    });
    expect(response.status()).toBe(200);
    const result = (await response.json()).result;
    expect(result.isError).toBeFalsy();
    return result.structuredContent as {
      proposalId: string;
      reviewUrl: string;
    };
  };

  const approved = await propose("Lia E2E", `${stamp}-1`);
  expect(approved.reviewUrl).toContain(
    `/app/${wsSlug}/proposals/${approved.proposalId}`,
  );
  const rejected = await propose("Rui E2E", `${stamp}-2`);

  // Nothing ran yet.
  await page.goto(`/app/${wsSlug}/crm/contacts`);
  await expect(
    page.getByText("Sem dados: nenhum contato ainda."),
  ).toBeVisible();

  await page.goto(`/app/${wsSlug}`);
  await page.locator("aside").getByRole("link", { name: "Propostas" }).click();
  const open = page.getByTestId("proposals-open");
  await expect(open.getByTestId("proposal-row")).toHaveCount(2);
  await open.getByRole("link", { name: "Adicionar contato: Lia E2E" }).click();
  await expect(page.getByTestId("proposal-fields")).toContainText("Lia E2E");
  await expect(page.getByText("Contato citado na conversa")).toBeVisible();
  await page.getByRole("button", { name: "Aprovar e executar" }).click();
  await expect(page.getByTestId("proposal-status")).toHaveText(
    "Aprovada, na fila",
  );

  await page.goto(`/app/${wsSlug}/proposals/${rejected.proposalId}`);
  await page.getByRole("button", { name: "Rejeitar" }).click();
  await expect(page.getByTestId("proposal-status")).toHaveText("Rejeitada");

  expect(await runJobs(request)).toBe(0);

  await page.goto(`/app/${wsSlug}/proposals/${approved.proposalId}`);
  await expect(page.getByTestId("proposal-status")).toHaveText("Executada");
  await page.getByRole("link", { name: "Ver o registro" }).click();
  await expect(page.getByTestId("edit-contact").getByLabel("Nome")).toHaveValue(
    "Lia E2E",
  );

  await page.goto(`/app/${wsSlug}/crm/contacts`);
  const list = page.getByTestId("crm-contact-list");
  await expect(list.getByRole("link", { name: "Lia E2E" })).toBeVisible();
  await expect(list.getByRole("link", { name: "Rui E2E" })).toHaveCount(0);
});
