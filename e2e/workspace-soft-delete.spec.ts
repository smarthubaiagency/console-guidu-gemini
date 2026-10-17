/**
 * Exclusão suave completa (WS1): with the deletion of the workspace
 * scheduled, the webhook of its Chatwoot connection answers 404 and stores
 * nothing (no GUIDS answers); after the owner cancels, the same webhook
 * takes events again.
 */

import { expect, test, type Page } from "@playwright/test";

import { FAKE_CHATWOOT_TOKEN } from "./support/fake-chatwoot";
import {
  createIdentity,
  runJobs,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

const CHATWOOT_URL = `http://127.0.0.1:${RIG.chatwootPort}`;

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

function contactMessage(id: number) {
  return {
    event: "message_created",
    id,
    content: "Olá",
    message_type: "incoming",
    private: false,
    sender: { id: 9, name: "Maria", type: "contact" },
    conversation: { id: 77, inbox_id: 3, status: "pending" },
    inbox: { id: 3 },
  };
}

test("a workspace scheduled for deletion refuses its channel webhook until the cancel", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("ws1-owner");
  const wsSlug = `ws1-exclusao-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Exclusão WS1 ${stamp}`,
    orgSlug: `ws1-org-${stamp}`,
    wsName: `Workspace WS1 ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await enrolMfa(page);

  // Connect the Chatwoot double; it gets the webhook of the bot.
  await page.goto(`/app/${wsSlug}/settings/channels`);
  const form = page.getByTestId("create-chatwoot");
  await form.getByLabel("Nome").fill("Atendimento");
  await form.getByLabel("Endereço do Chatwoot").fill(CHATWOOT_URL);
  await form.getByLabel("ID da conta").fill("1");
  await form.getByLabel("Token de acesso").fill(FAKE_CHATWOOT_TOKEN);
  await form.getByRole("button", { name: "Conectar" }).click();
  await expect(statusBanner(page)).toContainText("Chatwoot conectado.");
  const bots = (await (await request.get(`${CHATWOOT_URL}/__bots`)).json()) as {
    bots: { outgoingUrl: string }[];
  };
  const outgoingUrl = bots.bots.at(-1)!.outgoingUrl;
  expect(
    (await request.post(outgoingUrl, { data: contactMessage(1) })).status(),
  ).toBe(200);

  // Schedule the deletion: the webhook closes at once.
  await page.goto(`/app/${wsSlug}/settings/data`);
  const deletion = page.getByTestId("request-deletion");
  await deletion.getByLabel(`Digite ${wsSlug} para confirmar`).fill(wsSlug);
  await deletion.getByRole("button", { name: "Agendar exclusão" }).click();
  await page.waitForURL(/\/app\?exclusao=agendada/);
  await expect(page.getByTestId("scheduled-deletions")).toContainText(
    `Workspace WS1 ${stamp}`,
  );
  expect(
    (await request.post(outgoingUrl, { data: contactMessage(2) })).status(),
  ).toBe(404);

  // Cancel: the same webhook takes events again.
  await page
    .getByTestId(`cancel-deletion-${wsSlug}`)
    .getByRole("button", { name: "Cancelar exclusão" })
    .click();
  await expect(page.getByTestId("scheduled-deletions")).toBeHidden();
  expect(
    (await request.post(outgoingUrl, { data: contactMessage(3) })).status(),
  ).toBe(200);

  // Two events stored: before the deletion and after the cancel.
  await page.goto(`/app/${wsSlug}/settings/channels`);
  await expect(page.getByTestId("channel-connection")).toContainText(
    "2 eventos sem agente",
  );

  // The lifecycle runs of the schedule and the cancel finish here.
  expect(await runJobs(request)).toBe(0);
});
