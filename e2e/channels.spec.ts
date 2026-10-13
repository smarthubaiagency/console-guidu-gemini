/**
 * Configurações › Canais (A5a, ADR 0011): the owner connects the Chatwoot
 * double of the rig, sees the inbox, receives a webhook event without an
 * agent, checks and removes the connection. A viewer gets no access.
 */

import { expect, test } from "@playwright/test";

import { FAKE_CHATWOOT_TOKEN } from "./support/fake-chatwoot";
import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { statusBanner } from "./support/status";

const CHATWOOT_URL = `http://127.0.0.1:${RIG.chatwootPort}`;

test("owner connects Chatwoot, receives an event, checks and removes it", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("channels-owner");
  const wsSlug = `ws-channels-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: "Loja Canais",
    orgSlug: `org-channels-${Date.now()}`,
    wsName: "Loja",
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await page.goto(`/app/${wsSlug}/settings/channels`);

  await expect(page.getByRole("heading", { name: "Canais" })).toBeVisible();
  await expect(page.getByTestId("channels-empty")).toBeVisible();

  const form = page.getByTestId("create-chatwoot");
  await form.getByLabel("Nome").fill("Atendimento");
  await form.getByLabel("Endereço do Chatwoot").fill(CHATWOOT_URL);
  await form.getByLabel("ID da conta").fill("1");
  await form.getByLabel("Token de acesso").fill(FAKE_CHATWOOT_TOKEN);
  await form.getByRole("button", { name: "Conectar" }).click();
  await expect(statusBanner(page)).toContainText("Chatwoot conectado.");

  const card = page.getByTestId("channel-connection");
  await expect(card).toContainText("Atendimento");
  await expect(card.getByTestId("channel-health")).toHaveText("Funcionando");
  await expect(card.getByTestId("channel-inboxes")).toContainText(
    "WhatsApp Loja",
  );
  await expect(card).not.toContainText(FAKE_CHATWOOT_TOKEN);

  // Chatwoot calls the webhook of the bot it was given.
  const bots = (await (await request.get(`${CHATWOOT_URL}/__bots`)).json()) as {
    bots: { outgoingUrl: string }[];
  };
  const outgoingUrl = bots.bots.at(-1)!.outgoingUrl;
  const event = {
    event: "message_created",
    id: 1,
    content: "Olá",
    message_type: "incoming",
    private: false,
    sender: { id: 9, name: "Maria", type: "contact" },
    conversation: { id: 55, inbox_id: 3, status: "pending" },
    inbox: { id: 3 },
  };
  const received = await request.post(outgoingUrl, { data: event });
  expect(received.status()).toBe(200);
  expect((await request.post(outgoingUrl, { data: event })).status()).toBe(200);
  expect(
    (
      await request.post(outgoingUrl.replace(/[^/]+$/, "x".repeat(43)), {
        data: event,
      })
    ).status(),
  ).toBe(404);

  await page.reload();
  await expect(card).toContainText("1 evento sem agente");

  await card.getByTestId("check-channel").click();
  await expect(statusBanner(page)).toContainText("Conexão funcionando.");

  await card.getByTestId("delete-channel").click();
  const question = statusBanner(page);
  await expect(question).toHaveAttribute("role", "alertdialog");
  await question.getByRole("checkbox").check();
  await question.getByTestId("smart-status-action").click();
  await expect(statusBanner(page)).toContainText("Conexão removida.");
  await expect(page.getByTestId("channels-empty")).toBeVisible();
  expect((await request.post(outgoingUrl, { data: event })).status()).toBe(404);
});

test("viewer has no access to the channels", async ({ page, request }) => {
  const email = uniqueEmail("channels-viewer");
  const wsSlug = `ws-channels-viewer-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: "Loja Leitura",
    orgSlug: `org-channels-viewer-${Date.now()}`,
    wsName: "Loja Leitura",
    wsSlug,
    role: "viewer",
  });
  await signIn(page, email);
  await page.goto(`/app/${wsSlug}/settings/channels`);
  await expect(
    page.getByText("Você não tem acesso aos canais deste workspace."),
  ).toBeVisible();
  await expect(page.getByTestId("create-chatwoot")).toHaveCount(0);
});
